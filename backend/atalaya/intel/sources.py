"""Source classification, platform mapping, and reference resolution."""

from __future__ import annotations

import csv
import functools
from pathlib import Path
from typing import Any
import urllib.parse

from atalaya.config import SEED_DIR
from atalaya.intel.schemas import Platform, SourceRef, SourceTier

VERIFIABLE_TIERS: set[SourceTier] = {
    "oficial",
    "verificador",
    "academico",
    "medio_reconocido",
    "medio_regional",
}

_SOCIAL_DOMAINS: dict[str, Platform] = {
    "x.com": "x",
    "twitter.com": "x",
    "t.co": "x",
    "facebook.com": "facebook",
    "fb.com": "facebook",
    "fb.watch": "facebook",
    "tiktok.com": "tiktok",
    "instagram.com": "instagram",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
    "whatsapp.com": "whatsapp",
    "wa.me": "whatsapp",
    "t.me": "telegram",
    "telegram.me": "telegram",
    "threads.net": "otro",
}


def _clean_domain(domain: str) -> str:
    """Normalize domain by lowercasing and stripping protocol, port, path, and leading 'www.'."""
    d = domain.strip().lower()
    if "://" in d:
        try:
            parsed = urllib.parse.urlparse(d)
            d = parsed.netloc or parsed.path
        except Exception:
            pass
    if "/" in d:
        d = d.split("/", 1)[0]
    if ":" in d:
        d = d.split(":", 1)[0]
    if d.startswith("www."):
        d = d[4:]
    return d


@functools.lru_cache(maxsize=1)
def _load_seed_catalog() -> dict[str, tuple[SourceTier, str]]:
    """Load news_sources.csv into a mapping: domain -> (tier, outlet)."""
    catalog: dict[str, tuple[SourceTier, str]] = {}
    csv_path = SEED_DIR / "news_sources.csv"
    if not csv_path.is_file():
        return catalog

    try:
        with csv_path.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                dom = _clean_domain(row.get("domain", ""))
                tier = row.get("tier", "").strip()
                outlet = row.get("outlet", "").strip()
                if dom and tier:
                    catalog[dom] = (tier, outlet)  # type: ignore[assignment]
    except Exception:
        pass
    return catalog


def reload_seed_catalog() -> None:
    """Clear cached seed catalog."""
    _load_seed_catalog.cache_clear()


def classify_domain(domain: str) -> SourceTier:
    """Classify a domain into a SourceTier.

    Lookup hierarchy:
    1. Exact or suffix match in the seed catalog.
    2. Heuristic rules for .gob.mx/ine.mx/inegi, .edu.mx/unam.mx/colmex/cide, social platforms.
    3. Default: 'no_reconocido'.
    """
    clean = _clean_domain(domain)
    if not clean:
        return "no_reconocido"

    catalog = _load_seed_catalog()

    # Exact match in catalog
    if clean in catalog:
        return catalog[clean][0]

    # Suffix match (longest matching domain wins)
    best_match: tuple[int, SourceTier] | None = None
    for seed_dom, (tier, _) in catalog.items():
        if clean.endswith("." + seed_dom):
            match_len = len(seed_dom)
            if best_match is None or match_len > best_match[0]:
                best_match = (match_len, tier)

    if best_match is not None:
        return best_match[1]

    # Rule-based fallback
    # Official: .gob.mx, ine.mx, inegi, te.gob.mx, etc.
    if clean.endswith(".gob.mx") or clean == "gob.mx" or clean.endswith(".ine.mx") or clean == "ine.mx" or "inegi" in clean:
        return "oficial"

    # Academic: .edu.mx, unam.mx, colmex, cide, .edu
    if clean.endswith(".edu.mx") or clean.endswith(".unam.mx") or "colmex" in clean or "cide" in clean or clean.endswith(".edu"):
        return "academico"

    # Social platforms
    for soc_dom in _SOCIAL_DOMAINS:
        if clean == soc_dom or clean.endswith("." + soc_dom):
            return "red_social"

    return "no_reconocido"


def outlet_name(domain: str) -> str | None:
    """Return the human outlet name from the seed catalog, if known."""
    clean = _clean_domain(domain)
    if not clean:
        return None

    catalog = _load_seed_catalog()
    if clean in catalog:
        return catalog[clean][1] or None

    best_match: tuple[int, str] | None = None
    for seed_dom, (_, outlet) in catalog.items():
        if clean.endswith("." + seed_dom):
            match_len = len(seed_dom)
            if best_match is None or match_len > best_match[0]:
                best_match = (match_len, outlet)

    if best_match is not None and best_match[1]:
        return best_match[1]
    return None


def platform_of(url: str) -> Platform:
    """Map a URL to a known social/web platform."""
    if not url:
        return "otro"
    clean = _clean_domain(url)
    for soc_dom, plat in _SOCIAL_DOMAINS.items():
        if clean == soc_dom or clean.endswith("." + soc_dom):
            return plat
    if clean:
        return "sitio_web"
    return "otro"


def _fallback_domain_of(url: str) -> str:
    """Fallback domain extractor if atalaya.gemini is not yet present."""
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        if ":" in netloc:
            netloc = netloc.split(":", 1)[0]
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return _clean_domain(url)


def to_source_refs(items: list[dict[str, Any]], start: int = 1) -> list[SourceRef]:
    """Convert raw source dictionaries into deduplicated, classified SourceRefs."""
    try:
        from atalaya.gemini import resolve_source_url, domain_of
    except (ImportError, AttributeError):
        def resolve_source_url(u: str, *, timeout_s: float = 5.0) -> str:
            return u
        domain_of = _fallback_domain_of

    refs: list[SourceRef] = []
    seen_urls: set[str] = set()
    current_id = start

    for item in items:
        raw_url = str(item.get("url") or "").strip()
        if not raw_url:
            continue

        try:
            resolved_url = resolve_source_url(raw_url)
        except Exception:
            resolved_url = raw_url

        if not resolved_url or resolved_url in seen_urls:
            continue
        seen_urls.add(resolved_url)

        try:
            dom = domain_of(resolved_url)
        except Exception:
            dom = _fallback_domain_of(resolved_url)

        tier = classify_domain(dom)
        outlet = outlet_name(dom)
        title = str(item.get("title") or "").strip()
        published = item.get("published")
        if published is not None:
            published = str(published).strip() or None

        refs.append(
            SourceRef(
                id=f"s{current_id}",
                url=resolved_url,
                title=title,
                domain=dom,
                outlet=outlet,
                tier=tier,
                published=published,
            )
        )
        current_id += 1

    return refs
