"""Deterministic corpus fetching and quotation verification (anti-hallucination) without LLM."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import html as html_module
import logging
import re
import time
from typing import TYPE_CHECKING
import unicodedata

import httpx

if TYPE_CHECKING:
    from atalaya.websearch import NewsCandidate

logger = logging.getLogger("atalaya.explain.verify")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

SPANISH_STOPWORDS: set[str] = {
    "sobre", "entre", "desde", "hasta", "donde", "quien", "quienes",
    "cual", "cuales", "estos", "estas", "estan", "haber", "hacer",
    "tener", "estar", "todos", "todas", "municipio", "estado", "mexico",
    "para", "como", "cuando", "porque", "pero", "este", "esta", "aquel",
    "aquella", "aquellos", "aquellas", "hacia", "durante", "mediante",
    "segun", "contra", "ademas", "despues", "antes", "mientras",
}


@dataclass
class CorpusDoc:
    id: str
    url: str
    title: str
    domain: str
    outlet: str | None
    published: str | None
    tier: str
    text: str
    from_page: bool


def fold(text: str) -> str:
    """Normalize text: NFKD without accents, lowercase, normalized quotes/dashes, [a-z0-9 ], collapsed spaces."""
    if not text:
        return ""
    nfkd = unicodedata.normalize("NFKD", str(text))
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    low = no_accents.lower()
    normalized = re.sub(r"[«»“„”’'`\"]+", " ", low)
    normalized = re.sub(r"[–—−-]+", " ", normalized)
    clean = re.sub(r"[^a-z0-9 ]+", " ", normalized)
    return " ".join(clean.split())


def html_to_text(html: str) -> str:
    """Extract plain text from HTML, stripping script/style/nav/footer/aside/header and collapsing whitespace."""
    if not html:
        return ""
    text = html
    strip_tags = ["script", "style", "nav", "footer", "aside", "header", "noscript"]
    for tag in strip_tags:
        text = re.sub(rf"<{tag}\b[^>]*>.*?</{tag}>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html_module.unescape(text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    paras: list[str] = []
    current: list[str] = []
    for line in lines:
        if not line:
            if current:
                paras.append(" ".join(current))
                current = []
        else:
            current.append(line)
    if current:
        paras.append(" ".join(current))
    return "\n\n".join(paras).strip()


ELECTORAL_TERMS_PATTERN = re.compile(
    r"\b("
    r"vot[a-z]*|"
    r"elecci[a-z]*|"
    r"electoral[a-z]*|"
    r"casilla[a-z]*|"
    r"abstenc[a-z]*|"
    r"participacion ciudadana|"
    r"participacion electoral|"
    r"ine|"
    r"credencial[a-z]*|"
    r"padron[a-z]*|"
    r"lista nominal|"
    r"jornada electoral|"
    r"comicios[a-z]*|"
    r"urnas?"
    r")\b",
    re.IGNORECASE,
)


def count_zone_mentions(text: str, zone_names: list[str]) -> int:
    """Count how many times any of zone_names appears in folded text."""
    if not text or not zone_names:
        return 0
    f_text = fold(text)
    if not f_text:
        return 0
    total = 0
    for z in zone_names:
        fz = fold(z)
        if not fz:
            continue
        pattern = rf"\b{re.escape(fz)}\b"
        total += len(re.findall(pattern, f_text))
    return total


def mentions_zone(
    text_or_doc: str | CorpusDoc,
    zone_names: list[str],
    doc_title: str | None = None,
    min_mentions: int = 2,
) -> bool:
    """Return True if zone is mentioned >= min_mentions in body text or >= 1 in title."""
    if not text_or_doc or not zone_names:
        return False

    if isinstance(text_or_doc, CorpusDoc):
        text = text_or_doc.text
        if doc_title is None:
            doc_title = text_or_doc.title
    else:
        text = text_or_doc

    if doc_title:
        title_count = count_zone_mentions(doc_title, zone_names)
        if title_count >= 1:
            return True

    text_count = count_zone_mentions(text, zone_names)
    return text_count >= min_mentions


def is_electoral_relevant(
    finding: dict | Any,
    doc: CorpusDoc | str | None = None,
) -> bool:
    """Check if both finding (title + summary + quote) AND doc contain >= 1 folded electoral term."""
    if finding is None or doc is None:
        return False

    if isinstance(finding, dict):
        title = str(finding.get("title") or "")
        summary = str(finding.get("summary") or "")
        quote = str(finding.get("quote") or "")
    else:
        title = str(getattr(finding, "title", "") or "")
        summary = str(getattr(finding, "summary", "") or "")
        quote = str(getattr(finding, "quote", "") or "")

    finding_text = fold(f"{title} {summary} {quote}")
    if not ELECTORAL_TERMS_PATTERN.search(finding_text):
        return False

    if isinstance(doc, CorpusDoc):
        doc_text = fold(f"{doc.title} {doc.text}")
    elif isinstance(doc, str):
        doc_text = fold(doc)
    else:
        doc_text = fold(str(doc))

    return bool(ELECTORAL_TERMS_PATTERN.search(doc_text))


def quote_in_text(quote: str, text: str) -> bool:
    """Check if quote is in text (6-60 words; exact substring or >=90% 4-grams in text)."""
    if not quote or not text:
        return False
    q_words = fold(quote).split()
    if len(q_words) < 6 or len(q_words) > 60:
        return False
    f_quote = " ".join(q_words)
    f_text = fold(text)
    if f_quote in f_text:
        return True
    quote_4grams = [" ".join(q_words[i : i + 4]) for i in range(len(q_words) - 3)]
    if not quote_4grams:
        return False
    matches = sum(1 for g in quote_4grams if g in f_text)
    return (matches / len(quote_4grams)) >= 0.90


def fetch_corpus(
    candidates: list[NewsCandidate],
    *,
    zone_names: list[str],
    max_pages: int = 8,
    timeout_s: float = 8.0,
    client: httpx.Client | None = None,
) -> list[CorpusDoc]:
    """Fetch and extract text from verifiable news candidates, prioritizing zone mentions."""
    from atalaya import gemini
    from atalaya.intel import sources

    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    usable_cands: list[tuple[NewsCandidate, str, str, str, bool]] = []

    for c in candidates:
        raw_u = c.url.strip()
        norm_u = raw_u.rstrip("/")
        norm_t = fold(c.title)
        if not norm_u or norm_u in seen_urls:
            continue
        if norm_t and norm_t in seen_titles:
            continue
        seen_urls.add(norm_u)
        if norm_t:
            seen_titles.add(norm_t)

        dom = c.domain or gemini.domain_of(raw_u)
        is_agg = ("news.google.com" in dom or "bing.com" in dom or "/url" in raw_u)
        resolved_u = gemini.resolve_source_url(raw_u) if is_agg else raw_u
        resolved_dom = gemini.domain_of(resolved_u) or dom

        is_still_agg = ("news.google.com" in resolved_dom or "bing.com" in resolved_dom)
        tier = sources.classify_domain(resolved_dom)

        if not is_still_agg and tier not in sources.VERIFIABLE_TIERS:
            continue

        usable_cands.append((c, resolved_u, resolved_dom, tier, is_still_agg))

    selected = usable_cands[:max_pages]
    docs: list[CorpusDoc] = []
    own_client = client is None
    http_client = client or httpx.Client(
        timeout=timeout_s,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"},
        follow_redirects=True,
    )

    budget_deadline = time.monotonic() + 30.0

    def _fetch_single(cand_info: tuple[NewsCandidate, str, str, str, bool]) -> CorpusDoc:
        cand, url, dom, tier, is_agg = cand_info
        fallback_text = f"{cand.title}. {cand.snippet}".strip()

        if is_agg:
            if "news.google.com" in url or "news.google.com" in dom:
                from atalaya.websearch import decode_google_news_url, domain_of
                try:
                    time_left = budget_deadline - time.monotonic()
                    if time_left > 0.5:
                        per_call_timeout = min(timeout_s, time_left)
                        decoded = decode_google_news_url(url, client=http_client, timeout_s=per_call_timeout)
                        if decoded and "news.google.com" not in decoded:
                            url = decoded
                            dom = domain_of(decoded) or dom
                            tier = sources.classify_domain(dom)
                            if tier not in sources.VERIFIABLE_TIERS:
                                tier = "medio_reconocido"
                            is_agg = ("news.google.com" in dom or "bing.com" in dom)
                except Exception as exc:
                    logger.debug("Failed decoding Google News URL in fetch_corpus: %s", exc)

        if is_agg:
            return CorpusDoc(
                id="",
                url=url,
                title=cand.title,
                domain=dom,
                outlet=cand.outlet,
                published=cand.published,
                tier=tier if tier in sources.VERIFIABLE_TIERS else "medio_reconocido",
                text=fallback_text,
                from_page=False,
            )

        time_left = budget_deadline - time.monotonic()
        if time_left <= 0.5:
            return CorpusDoc(
                id="",
                url=url,
                title=cand.title,
                domain=dom,
                outlet=cand.outlet,
                published=cand.published,
                tier=tier,
                text=fallback_text,
                from_page=False,
            )

        per_call_timeout = min(timeout_s, time_left)

        try:
            resp = http_client.get(url, timeout=per_call_timeout)
            ct = resp.headers.get("content-type", "").lower()
            if "text/html" not in ct:
                logger.info("URL %s rejected: content-type %s is not text/html", url, ct)
                return CorpusDoc(
                    id="",
                    url=url,
                    title=cand.title,
                    domain=dom,
                    outlet=cand.outlet,
                    published=cand.published,
                    tier=tier,
                    text=fallback_text,
                    from_page=False,
                )

            # Limit reading to 2 MB
            html_content = resp.text[:2_000_000]
            clean_text = html_to_text(html_content)

            paras = [p.strip() for p in clean_text.split("\n\n") if p.strip()]
            zone_paras = [p for p in paras if mentions_zone(p, zone_names, min_mentions=1)]
            other_paras = [p for p in paras if not mentions_zone(p, zone_names, min_mentions=1)]
            reordered = "\n\n".join(zone_paras + other_paras)[:12000]

            if not reordered.strip():
                reordered = fallback_text

            return CorpusDoc(
                id="",
                url=url,
                title=cand.title or dom,
                domain=dom,
                outlet=cand.outlet or (sources.outlet_name(dom) if hasattr(sources, "outlet_name") else None),
                published=cand.published,
                tier=tier,
                text=reordered,
                from_page=True,
            )
        except Exception as exc:
            logger.info("Download failed for %s (%s); using snippet fallback", url, exc)
            return CorpusDoc(
                id="",
                url=url,
                title=cand.title or dom,
                domain=dom,
                outlet=cand.outlet,
                published=cand.published,
                tier=tier,
                text=fallback_text,
                from_page=False,
            )

    try:
        if len(selected) <= 1:
            for item in selected:
                docs.append(_fetch_single(item))
        else:
            with ThreadPoolExecutor(max_workers=min(4, len(selected))) as pool:
                futures = [pool.submit(_fetch_single, item) for item in selected]
                for fut in as_completed(futures):
                    try:
                        docs.append(fut.result())
                    except Exception as err:
                        logger.warning("Error fetching candidate doc: %s", err)
    finally:
        if own_client:
            http_client.close()

    # Sort: documents that mention the zone first
    docs.sort(key=lambda d: (not mentions_zone(d, zone_names), not d.from_page))

    # Assign IDs s1..sN
    for idx, d in enumerate(docs, start=1):
        d.id = f"s{idx}"

    return docs


def verify_finding(
    raw: dict,
    docs: dict[str, CorpusDoc],
    zone_names: list[str],
) -> tuple[str, str | None]:
    """Verify a finding against corpus docs and zone names.

    Returns: (verification, quote_or_None).
    verification in ("cita_verificada", "fuente_verificada", "sin_verificar").
    """
    raw_evidence = raw.get("evidence", [])
    if isinstance(raw_evidence, str):
        raw_evidence = [raw_evidence]
    elif not isinstance(raw_evidence, list):
        raw_evidence = []

    cited_docs = [docs[sid] for sid in raw_evidence if sid in docs]
    if not cited_docs:
        return "sin_verificar", None

    title = str(raw.get("title") or "").strip()
    summary = str(raw.get("summary") or "").strip()
    full_text_to_check = f"{title} {summary}"

    # Regla de cifras: si summary o title contienen números que no aparecen en ninguno de sus docs => sin_verificar
    raw_nums = re.findall(r"\d[\d.,]*", full_text_to_check)
    nums = [n.rstrip(".,") for n in raw_nums if n.rstrip(".,")]
    if nums:
        for num in nums:
            if not any(num in d.text for d in cited_docs):
                return "sin_verificar", None

    # Check 1: cita_verificada
    quote = raw.get("quote")
    if quote and isinstance(quote, str) and quote.strip():
        q_clean = quote.strip()
        for d in cited_docs:
            if d.from_page and mentions_zone(d, zone_names) and quote_in_text(q_clean, d.text):
                if is_electoral_relevant(raw, d):
                    return "cita_verificada", q_clean

    # Check 2: fuente_verificada (snippet de agregador/from_page=False con la cita)
    if quote and isinstance(quote, str) and quote.strip():
        q_clean = quote.strip()
        for d in cited_docs:
            if not d.from_page:
                f_q = fold(q_clean)
                f_doc = fold(d.text)
                if (f_q in f_doc) or quote_in_text(q_clean, d.text):
                    if is_electoral_relevant(raw, d):
                        return "fuente_verificada", q_clean

    # Check 3: fuente_verificada (doc menciona zona y contiene >= 2 terminos clave del titulo)
    folded_title = fold(title)
    words = folded_title.split()
    key_terms = [w for w in set(words) if len(w) >= 5 and w not in SPANISH_STOPWORDS]

    if len(key_terms) >= 2:
        for d in cited_docs:
            if mentions_zone(d, zone_names):
                f_doc = fold(d.text)
                matches = sum(1 for term in key_terms if term in f_doc)
                if matches >= 2:
                    if is_electoral_relevant(raw, d):
                        return "fuente_verificada", None

    return "sin_verificar", None
