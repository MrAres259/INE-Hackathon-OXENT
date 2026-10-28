"""Web search module using Google News RSS and Bing News RSS with caching and deduplication."""

from __future__ import annotations

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
    except Exception as exc:
        logger.error("Unexpected error in search_news: %s", exc)
        return []

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
    return unique_candidates[:max_items]
