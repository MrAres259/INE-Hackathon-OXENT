"""Web search module using Google News RSS and Bing News RSS with caching and deduplication."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import email.utils
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import tempfile
import time
from typing import Any
import urllib.parse
import xml.etree.ElementTree as ET

import httpx

from atalaya.config import CACHE_DIR

logger = logging.getLogger("atalaya.websearch")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

_client_factory: Any = None


@dataclass
class NewsCandidate:
    title: str
    url: str
    domain: str
    outlet: str | None
    published: str | None
    snippet: str
    provider: str


def domain_of(url: str) -> str:
    """Extract lower-case hostname without leading 'www.' from a URL."""
    if not url:
        return ""
    clean = url.strip()
    if "://" not in clean:
        clean = "https://" + clean
    try:
        parsed = urllib.parse.urlparse(clean)
        host = (parsed.hostname or "").lower().strip()
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return ""


def _create_httpx_client(timeout: float, **kwargs) -> httpx.Client:
    """Create httpx.Client, allowing test factory overrides."""
    if _client_factory is not None:
        return _client_factory(timeout=timeout, **kwargs)
    return httpx.Client(timeout=timeout, **kwargs)


def _get_cache_dir() -> Path:
    d = CACHE_DIR / "intel" / "websearch"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _strip_html(raw_html: str) -> str:
    """Remove HTML tags and clean up whitespace."""
    if not raw_html:
        return ""
    clean = re.sub(r"<[^>]+>", " ", raw_html)
    return " ".join(clean.split())


def _parse_pubdate(pub_str: str | None) -> tuple[datetime | None, str | None]:
    """Parse RFC 2822 / 822 pubDate string to datetime and ISO date string."""
    if not pub_str or not pub_str.strip():
        return None, None
    try:
        dt = email.utils.parsedate_to_datetime(pub_str.strip())
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        iso_date = dt.strftime("%Y-%m-%d")
        return dt, iso_date
    except Exception:
        return None, None


def _normalize_title(title: str) -> str:
    """Normalize title for fuzzy deduplication."""
    clean = title
    if " - " in clean:
        clean = clean.rsplit(" - ", 1)[0]
    clean = re.sub(r"[^\w\s]", "", clean.lower())
    return " ".join(clean.split())


def _fetch_google_news(
    query: str,
    days: int,
    cutoff: datetime,
    client: httpx.Client,
) -> list[NewsCandidate]:
    """Query Google News RSS for query + when:{days}d."""
    q_str = f"{query} when:{days}d"
    url = f"https://news.google.com/rss/search?q={urllib.parse.quote_plus(q_str)}&hl=es-419&gl=MX&ceid=MX:es-419"
    headers = {"User-Agent": USER_AGENT}

    candidates: list[NewsCandidate] = []
    try:
        resp = client.get(url, headers=headers)
        if resp.status_code != 200:
            logger.warning("Google News RSS returned HTTP %d for query %r", resp.status_code, query)
            return []

        root = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            return []

        for item in channel.findall("item"):
            title_el = item.find("title")
            link_el = item.find("link")
            pub_el = item.find("pubDate")
            desc_el = item.find("description")
            source_el = item.find("source")

            title = (title_el.text or "").strip() if title_el is not None else ""
            link = (link_el.text or "").strip() if link_el is not None else ""
            if not title or not link:
                continue

            pub_str = pub_el.text if pub_el is not None else None
            dt, iso_date = _parse_pubdate(pub_str)
            if dt is not None and dt < cutoff:
                continue

            outlet = (source_el.text or "").strip() if source_el is not None else None
            source_url = source_el.attrib.get("url", "") if source_el is not None else ""
            domain = domain_of(source_url) if source_url else domain_of(link)

            snippet = _strip_html(desc_el.text or "") if desc_el is not None else ""

            candidates.append(
                NewsCandidate(
                    title=title,
                    url=link,
                    domain=domain,
                    outlet=outlet,
                    published=iso_date,
                    snippet=snippet,
                    provider="google_news",
                )
            )
    except Exception as exc:
        logger.warning("Error fetching/parsing Google News RSS for %r: %s", query, exc)

    return candidates


def _fetch_bing_news(
    query: str,
    days: int,
    cutoff: datetime,
    client: httpx.Client,
) -> list[NewsCandidate]:
    """Query Bing News RSS and extract target destination from apiclick.aspx."""
    url = f"https://www.bing.com/news/search?q={urllib.parse.quote_plus(query)}&format=rss&setlang=es-MX&cc=MX"
    headers = {"User-Agent": USER_AGENT}

    candidates: list[NewsCandidate] = []
    try:
        resp = client.get(url, headers=headers)
        if resp.status_code != 200:
            logger.warning("Bing News RSS returned HTTP %d for query %r", resp.status_code, query)
            return []

        root = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            return []

        for item in channel.findall("item"):
            title_el = item.find("title")
            link_el = item.find("link")
            pub_el = item.find("pubDate")
            desc_el = item.find("description")

            title = (title_el.text or "").strip() if title_el is not None else ""
            raw_link = (link_el.text or "").strip() if link_el is not None else ""
            if not title or not raw_link:
                continue

            pub_str = pub_el.text if pub_el is not None else None
            dt, iso_date = _parse_pubdate(pub_str)
            if dt is not None and dt < cutoff:
                continue

            # Extract destination url from apiclick.aspx
            real_url = raw_link
            try:
                parsed_link = urllib.parse.urlparse(raw_link)
                qs = urllib.parse.parse_qs(parsed_link.query)
                if "url" in qs and qs["url"]:
                    real_url = qs["url"][0]
            except Exception:
                real_url = raw_link

            domain = domain_of(real_url)
            snippet = _strip_html(desc_el.text or "") if desc_el is not None else ""

            candidates.append(
                NewsCandidate(
                    title=title,
                    url=real_url,
                    domain=domain,
                    outlet=None,
                    published=iso_date,
                    snippet=snippet,
                    provider="bing_news",
                )
            )
    except Exception as exc:
        logger.warning("Error fetching/parsing Bing News RSS for %r: %s", query, exc)

    return candidates


def _search_query_cached(
    query: str,
    days: int,
    cutoff: datetime,
    client: httpx.Client,
) -> list[NewsCandidate]:
    """Search for a single query checking/saving 1-hour disk cache."""
    cache_dir = _get_cache_dir()
    cache_key = hashlib.sha1(f"{query.strip().lower()}_{days}".encode("utf-8")).hexdigest()
    cache_file = cache_dir / f"{cache_key}.json"

    # Check cache (1 hour TTL)
    if cache_file.is_file():
        try:
            mtime = cache_file.stat().st_mtime
            if (datetime.now().timestamp() - mtime) < 3600:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                return [NewsCandidate(**item) for item in data]
        except Exception as exc:
            logger.warning("Failed to read websearch cache %s: %s", cache_file, exc)

    # Perform searches
    google_items = _fetch_google_news(query, days, cutoff, client)
    bing_items = _fetch_bing_news(query, days, cutoff, client)
    combined = google_items + bing_items

    # Save to cache
    try:
        serialized = [asdict(c) for c in combined]
        with tempfile.NamedTemporaryFile("w", dir=str(cache_dir), delete=False, encoding="utf-8") as tf:
            json.dump(serialized, tf, ensure_ascii=False, indent=2)
            tmp_name = tf.name
        os.replace(tmp_name, str(cache_file))
    except Exception as exc:
        logger.warning("Failed to write websearch cache %s: %s", cache_file, exc)

    return combined


_DECODE_MEM_CACHE: dict[str, tuple[str, float]] = {}
DECODE_CACHE_TTL_S = 30 * 86400.0  # 30 days


def clear_decode_cache() -> None:
    """Clear memory decode cache (useful for testing)."""
    _DECODE_MEM_CACHE.clear()


def _extract_google_news_id(url: str) -> str | None:
    """Extract article ID from a Google News article/read URL."""
    if not url:
        return None
    try:
        clean = url.strip()
        parsed = urllib.parse.urlparse(clean)
        host = (parsed.hostname or "").lower()
        if host != "news.google.com":
            return None
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 3 and parts[0] == "rss" and parts[1] == "articles":
            return parts[2]
        if len(parts) >= 2 and parts[0] in ("articles", "read"):
            return parts[1]
        return None
    except Exception:
        return None


def _get_cached_decoded_url(gid: str) -> str | None:
    """Retrieve decoded URL from memory or disk cache if not older than 30 days."""
    now = time.time()
    if gid in _DECODE_MEM_CACHE:
        real_url, ts = _DECODE_MEM_CACHE[gid]
        if now - ts < DECODE_CACHE_TTL_S:
            return real_url
        del _DECODE_MEM_CACHE[gid]

    try:
        cache_dir = _get_cache_dir() / "decoded"
        h = hashlib.sha1(gid.encode("utf-8")).hexdigest()
        cache_file = cache_dir / f"{h}.json"
        if cache_file.is_file():
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            ts = float(data.get("timestamp") or cache_file.stat().st_mtime)
            if now - ts < DECODE_CACHE_TTL_S:
                real_url = data.get("url")
                if real_url:
                    _DECODE_MEM_CACHE[gid] = (real_url, ts)
                    return real_url
    except Exception as exc:
        logger.debug("Failed reading decoded URL disk cache: %s", exc)
    return None


def _save_cached_decoded_url(gid: str, real_url: str) -> None:
    """Save decoded URL to memory and disk cache (30-day TTL)."""
    now = time.time()
    _DECODE_MEM_CACHE[gid] = (real_url, now)
    try:
        cache_dir = _get_cache_dir() / "decoded"
        cache_dir.mkdir(parents=True, exist_ok=True)
        h = hashlib.sha1(gid.encode("utf-8")).hexdigest()
        cache_file = cache_dir / f"{h}.json"
        with tempfile.NamedTemporaryFile("w", dir=str(cache_dir), delete=False, encoding="utf-8") as tf:
            json.dump({"id": gid, "url": real_url, "timestamp": now}, tf, ensure_ascii=False)
            tmp_name = tf.name
        os.replace(tmp_name, str(cache_file))
    except Exception as exc:
        logger.debug("Failed writing decoded URL disk cache: %s", exc)


def decode_google_news_url(
    url: str,
    *,
    client: httpx.Client | None = None,
    timeout_s: float = 8.0,
) -> str | None:
    """Decode a Google News redirect URL to its destination publisher URL.

    Only applies to news.google.com/rss/articles/<id>, /articles/<id>, or /read/<id>.
    Returns the original url unchanged if not a matching Google News article URL.
    Returns None on failure without raising.
    """
    if not url:
        return url

    gid = _extract_google_news_id(url)
    if gid is None:
        return url

    cached = _get_cached_decoded_url(gid)
    if cached:
        return cached

    headers = {"User-Agent": USER_AGENT}
    own_client = client is None
    http_client = client or _create_httpx_client(timeout=timeout_s, follow_redirects=True)

    try:
        # Step 2: Fetch article redirect page to get signature and timestamp
        article_url = f"https://news.google.com/rss/articles/{gid}"
        resp1 = http_client.get(article_url, headers=headers, timeout=timeout_s)
        if resp1.status_code != 200:
            return None

        sg_match = re.search(r'data-n-a-sg="([^"]+)"', resp1.text)
        ts_match = re.search(r'data-n-a-ts="([^"]+)"', resp1.text)
        if not (sg_match and ts_match):
            return None

        sg = sg_match.group(1)
        ts = int(ts_match.group(1))

        # Step 3: Call batchexecute RPC
        inner = [
            "garturlreq",
            [
                ["X", "X", ["X", "X"], None, None, 1, 1, "US:en", None, 1, None, None, None, None, None, 0, 1],
                "X",
                "X",
                1,
                [1, 1, 1],
                1,
                1,
                None,
                0,
                0,
                None,
                0,
            ],
            gid,
            ts,
            sg,
        ]
        payload = [[["Fbv4je", json.dumps(inner), None, "generic"]]]
        post_data = {"f.req": json.dumps(payload)}
        post_headers = {
            **headers,
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        }
        resp2 = http_client.post(
            "https://news.google.com/_/DotsSplashUi/data/batchexecute",
            data=post_data,
            headers=post_headers,
            timeout=timeout_s,
        )
        if resp2.status_code != 200:
            return None

        # Step 4: Parse response
        if "\n\n" not in resp2.text:
            return None
        body = resp2.text.split("\n\n", 1)[1]
        arr = json.loads(body)
        inner_val = arr[0][2]
        inner_arr = json.loads(inner_val) if isinstance(inner_val, str) else inner_val
        real_url = inner_arr[1]

        if not isinstance(real_url, str):
            return None
        real_url = real_url.strip()
        if not (real_url.startswith("http://") or real_url.startswith("https://")):
            return None

        dom = domain_of(real_url)
        if not dom or "google.com" in dom or dom.endswith("google.com"):
            return None

        _save_cached_decoded_url(gid, real_url)
        return real_url
    except Exception as exc:
        logger.debug("Failed decoding Google News URL %s: %s", url, exc)
        return None
    finally:
        if own_client:
            http_client.close()


def search_news(
    queries: list[str],
    *,
    days: int = 30,
    max_items: int = 25,
    timeout_s: float = 15.0,
) -> list[NewsCandidate]:
    """Search Google and Bing News RSS for candidate articles across given queries.

    Deduplicates by normalized title and URL, filters out items older than days,
    orders descending by publication date, and returns up to max_items.
    Never raises an exception; errors return empty list with warning logged.
    """
    if not queries:
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    all_candidates: list[NewsCandidate] = []

    try:
        client = _create_httpx_client(timeout=timeout_s)
        with client:
            for q in queries:
                q_clean = q.strip()
                if not q_clean:
                    continue
                items = _search_query_cached(q_clean, days, cutoff, client)
                all_candidates.extend(items)

            # Deduplicate by normalized title and URL
            seen_titles: set[str] = set()
            seen_urls: set[str] = set()
            unique_candidates: list[NewsCandidate] = []

            for c in all_candidates:
                norm_url = c.url.strip().rstrip("/").lower()
                norm_title = _normalize_title(c.title)

                if norm_url in seen_urls:
                    continue
                if norm_title and norm_title in seen_titles:
                    continue

                seen_urls.add(norm_url)
                if norm_title:
                    seen_titles.add(norm_title)
                unique_candidates.append(c)

            # Sort descending by published date (newest first, None at the end)
            def _sort_key(c: NewsCandidate) -> tuple[int, str]:
                if c.published:
                    return (1, c.published)
                return (0, "")

            unique_candidates.sort(key=_sort_key, reverse=True)

            # Decode Google News candidates (up to 12)
            google_cands = [
                c for c in unique_candidates
                if _extract_google_news_id(c.url) is not None
            ][:12]

            if google_cands:
                deadline = time.monotonic() + 20.0

                def _decode_candidate(cand: NewsCandidate) -> None:
                    try:
                        time_left = deadline - time.monotonic()
                        if time_left <= 0.5:
                            return
                        gid = _extract_google_news_id(cand.url)
                        if gid and _get_cached_decoded_url(gid) is None:
                            time.sleep(0.2)
                        per_call_timeout = min(8.0, max(0.5, time_left))
                        real_url = decode_google_news_url(cand.url, client=client, timeout_s=per_call_timeout)
                        if real_url and real_url != cand.url:
                            cand.url = real_url
                            real_dom = domain_of(real_url)
                            if real_dom:
                                cand.domain = real_dom
                    except Exception as exc:
                        logger.debug("Failed candidate decoding in search_news: %s", exc)

                with ThreadPoolExecutor(max_workers=min(4, len(google_cands))) as pool:
                    futures = [pool.submit(_decode_candidate, c) for c in google_cands]
                    for fut in futures:
                        try:
                            time_left = deadline - time.monotonic()
                            fut.result(timeout=max(0.1, time_left))
                        except Exception:
                            pass

            return unique_candidates[:max_items]
    except Exception as exc:
        logger.error("Unexpected error in search_news: %s", exc)
        return []

