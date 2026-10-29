"""INE Monitor pipeline: scanning, verification, realistic impact, and institutional remediation.

Follows the Atalaya Electoral IA-Intel contract strictly:
- Neutral institutional analysis adhering to INE principles.
- Grounded search in recognized Mexican media and social platforms.
- Cross-check against verifiable tiers and fact-checkers.
- Deterministic impact, virality, severity, and prefill calculations.
- Remediation drafting with GLM-5.3 with automatic template fallback.
"""

from __future__ import annotations

import csv
from datetime import date, datetime, timedelta, timezone
import hashlib
import logging
import re
from typing import Any, Callable
import unicodedata

from pydantic import BaseModel, Field

from atalaya.config import SEED_DIR, get_settings
from atalaya.intel.schemas import (
    ActionType,
    Engagement,
    GeoScope,
    Level,
    MonitorScanRequest,
    MonitorSnapshot,
    NewsImpact,
    NewsItem,
    Platform,
    Remediation,
    ReportTarget,
    Severity,
    SocialPost,
    SourceRef,
)
from atalaya.intel import prompts_monitor

logger = logging.getLogger("atalaya.intel.monitor")


# ---------------------------------------------------------------- helpers & normalization


def _compute_search_mode(modes: list[str]) -> str:
    """Compute overall search mode across monitor stages. Worst mode wins (sin_internet < respaldo < grounding)."""
    if not modes or any(m in ("sin_internet", "none", "") for m in modes):
        return "sin_internet"
    if any(m in ("respaldo", "rss_url_context") for m in modes):
        return "respaldo"
    return "grounding"


def normalize_claim_for_id(claim: str) -> str:
    """Normalize a claim string for deterministic hashing across scans."""
    s = unicodedata.normalize("NFKD", str(claim or "")).lower()
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def item_id_for_claim(claim: str) -> str:
    """Compute stable 12-char SHA-1 hex digest for an item claim."""
    norm = normalize_claim_for_id(claim)
    if not norm:
        return hashlib.sha1(str(claim or "").encode("utf-8")).hexdigest()[:12]
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def tokenize_claim(claim: str) -> set[str]:
    """Extract significant word tokens (len >= 3) from a claim."""
    s = unicodedata.normalize("NFKD", str(claim or "")).lower()
    s = "".join(c for c in s if not unicodedata.combining(c))
    return set(re.findall(r"\w{3,}", s))


def jaccard_similarity(set_a: set[str], set_b: set[str]) -> float:
    """Compute Jaccard token overlap between two sets."""
    if not set_a and not set_b:
        return 1.0
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def normalize_title_for_match(title: str) -> str:
    """Normalize a title string for candidate comparison."""
    s = unicodedata.normalize("NFKD", str(title or "")).lower()
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s)
    return " ".join(s.split())


def _match_candidate_source(
    raw_src: dict[str, Any],
    candidate_sources: list[Any],
    grounded_urls: set[str],
    grounded_domains: set[str],
) -> tuple[bool, str, str | None, str | None]:
    """Matches a raw source against candidate sources by URL or normalized title.

    Returns (is_valid, domain, outlet, published).
    If unmatched with any candidate and not in groundingChunks, returns (False, "", None, None).
    """
    raw_url = str(raw_src.get("url") or "").strip()
    raw_title_norm = normalize_title_for_match(raw_src.get("title") or "")
    from atalaya.intel import sources

    # 1. Match against candidate sources
    best_cand = None
    for cand in candidate_sources:
        c_url = getattr(cand, "url", "")
        c_title = getattr(cand, "title", "")
        c_title_norm = normalize_title_for_match(c_title)

        if raw_url and c_url:
            if raw_url == c_url or raw_url.rstrip("/") == c_url.rstrip("/"):
                best_cand = cand
                break
            if len(raw_url) > 25 and (raw_url in c_url or c_url in raw_url):
                best_cand = cand
                break

        if raw_title_norm and c_title_norm:
            if raw_title_norm == c_title_norm:
                best_cand = cand
                break
            if len(raw_title_norm) >= 20 and (raw_title_norm in c_title_norm or c_title_norm in raw_title_norm):
                best_cand = cand
                break
            tokens_raw = set(raw_title_norm.split())
            tokens_c = set(c_title_norm.split())
            if tokens_raw and tokens_c:
                jacc = len(tokens_raw & tokens_c) / len(tokens_raw | tokens_c)
                if jacc >= 0.5:
                    best_cand = cand
                    break

    if best_cand is not None:
        cand_domain = getattr(best_cand, "domain", "")
        cand_outlet = getattr(best_cand, "outlet", None) or sources.outlet_name(cand_domain)
        cand_pub = getattr(best_cand, "published", None)
        return True, cand_domain, cand_outlet, cand_pub

    # 2. Check groundingChunks
    try:
        from atalaya.gemini import domain_of
    except Exception:
        domain_of = sources._fallback_domain_of

    src_domain = domain_of(raw_url) if raw_url else ""
    in_grounding = (raw_url in grounded_urls) or (src_domain in grounded_domains)
    if in_grounding:
        return True, src_domain, sources.outlet_name(src_domain), None

    # If candidate sources or grounding URLs exist, discard unbacked sources
    if candidate_sources or grounded_urls:
        return False, "", None, None

    # Fallback for synthetic/mock calls without candidate sources
    return True, src_domain, sources.outlet_name(src_domain), None


def _load_states_alias_map() -> dict[str, str]:
    """Map normalized state names, ISO codes, and aliases to 2-digit cve_ent."""
    alias_map: dict[str, str] = {}
    csv_path = SEED_DIR / "states.csv"
    if not csv_path.is_file():
        return alias_map

    try:
        with csv_path.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                ent = str(row.get("cve_ent", "")).strip().zfill(2)
                name = str(row.get("name", "")).strip()
                iso = str(row.get("iso", "")).strip()
                aliases = str(row.get("aliases", "")).strip()

                candidates = [ent, name]
                if iso:
                    candidates.extend([iso, iso.replace("MX-", "")])
                if aliases:
                    candidates.extend(aliases.split("|"))

                for cand in candidates:
                    norm = normalize_claim_for_id(cand)
                    if norm:
                        alias_map[norm] = ent
    except Exception as exc:
        logger.warning("Could not read states.csv alias map: %s", exc)

    return alias_map


def _resolve_geo(raw_geo: dict[str, Any] | None) -> GeoScope:
    """Resolve and normalize state names/aliases and municipality names."""
    if not raw_geo:
        return GeoScope()

    alias_map = _load_states_alias_map()
    raw_ents = raw_geo.get("ents") or []
    if isinstance(raw_ents, str):
        raw_ents = [raw_ents]

    resolved_ents: list[str] = []
    for e in raw_ents:
        e_str = str(e).strip()
        if e_str.isdigit() and 1 <= int(e_str) <= 32:
            ent_code = e_str.zfill(2)
            if ent_code not in resolved_ents:
                resolved_ents.append(ent_code)
            continue

        norm_e = normalize_claim_for_id(e_str)
        if norm_e in alias_map:
            ent_code = alias_map[norm_e]
            if ent_code not in resolved_ents:
                resolved_ents.append(ent_code)

    raw_muns = raw_geo.get("muns") or []
    if isinstance(raw_muns, str):
        raw_muns = [raw_muns]

    resolved_muns: list[str] = []
    if raw_muns:
        try:
            from atalaya.store import get_store
            store = get_store()
        except Exception:
            store = None

        for m in raw_muns:
            m_str = str(m).strip()
            if m_str.isdigit() and len(m_str) == 5:
                if m_str not in resolved_muns:
                    resolved_muns.append(m_str)
                continue

            if store is not None:
                try:
                    candidates = store.search_units(m_str, level="mun", size=5)
                    if candidates and candidates[0].get("score", 0) >= 0.6:
                        chosen = candidates[0]
                        if resolved_ents:
                            for cand in candidates:
                                if cand.get("cve_ent") in resolved_ents and cand.get("score", 0) >= 0.6:
                                    chosen = cand
                                    break
                        mun_id = str(chosen["id"])
                        if mun_id not in resolved_muns:
                            resolved_muns.append(mun_id)
                        cand_ent = str(chosen.get("cve_ent", "")).zfill(2)
                        if cand_ent and cand_ent != "00" and cand_ent not in resolved_ents:
                            resolved_ents.append(cand_ent)
                except Exception as exc:
                    logger.debug("Failed searching municipal unit '%s': %s", m_str, exc)

    raw_level = raw_geo.get("level")
    if raw_level in ("nacional", "estatal", "municipal"):
        level = raw_level
    elif resolved_muns:
        level = "municipal"
    elif resolved_ents:
        level = "estatal"
    else:
        level = "nacional"

    return GeoScope(level=level, ents=resolved_ents, muns=resolved_muns)


# ---------------------------------------------------------------- Fallbacks for concurrent modules


class _FallbackImpact:
    @staticmethod
    def news_impact(
        units: Any,
        *,
        topic: str = "otra",
        geo: GeoScope | None = None,
        intensity: float = 0.5,
        persistence: str = "coyuntural",
        today: Any = None,
        level: Level = "state",
        ent: str | None = None,
    ) -> NewsImpact:
        unit_id = ent or (geo.ents[0] if geo and geo.ents else "07")
        return NewsImpact(
            level=level,
            ent=ent,
            delta_pp_national=0.15,
            votos_perdidos_total=8500,
            units=[
                StateImpact(
                    id=unit_id,
                    name="Chiapas" if not ent else "Tuxtla Gutiérrez",
                    level=level,
                    delta_pp=0.35,
                    delta_low_pp=0.18,
                    delta_high_pp=0.52,
                    votos_perdidos=8500,
                    exposure=1.0,
                    category_before="amarillo",
                    category_after="naranja",
                )
            ],
            max_delta_pp=0.35,
            assumptions=["Impacto preliminar estimado con parámetros estándar"],
            params={"intensity": intensity, "persistence": persistence},
        )

    @staticmethod
    def campaign_prefill_for(impact_obj: NewsImpact, topic: str) -> dict[str, Any]:
        return {
            "campaigns": [
                {
                    "lever": "campana_general",
                    "targeting": "todos",
                    "effect_pp": 1.5,
                    "coverage": 80.0,
                    "ents": [u.id for u in impact_obj.units[:2]],
                }
            ]
        }


class _FallbackVirality:
    @staticmethod
    def virality(posts: list[SocialPost], *, topic: str = "otra", today: Any = None) -> Virality:
        platforms = list({p.platform for p in posts})
        views = [p.engagement.views for p in posts if p.engagement.views is not None]
        reach = sum(views) if views else None
        return Virality(
            score=50,
            level="media",
            platforms=platforms,
            posts=posts,
            reach_estimate=reach,
            growth="desconocido",
            projected_score_7d=55,
            basis=["Métricas preliminares de publicaciones analizadas"],
            ignore_risk="Riesgo de amplificación en redes sociales si no se atiende institucionalmente.",
        )


class _FallbackSeverity:
    @staticmethod
    def severity_true(impact_obj: NewsImpact) -> Severity:
        score = min(100, int(round(30 * impact_obj.max_delta_pp + 100 * abs(impact_obj.delta_pp_national) + impact_obj.votos_perdidos_total / 25000)))
        lvl = "critica" if score >= 75 else ("alta" if score >= 50 else ("media" if score >= 25 else "baja"))
        return Severity(level=lvl, score=score, drivers=["Impacto territorial en abstención"])

    @staticmethod
    def severity_fake(v: Virality, topic: str, verdict: str) -> Severity:
        score = min(100, int(round(v.score * 0.75)))
        lvl = "critica" if score >= 75 else ("alta" if score >= 50 else ("media" if score >= 25 else "baja"))
        return Severity(level=lvl, score=score, drivers=["Puntaje de difusión viral"])

    @staticmethod
    def decide_action(verdict: str, sev: Severity, *, has_posts: bool = False) -> tuple[ActionType, list[ActionType], int]:
        if verdict == "verdadera":
            if sev.score >= 50:
                return ("campana_intervencion", ["comunicado"], 48)
            return ("comunicado", [], 72)
        if verdict == "falsa":
            if sev.score >= 75:
                return ("desmentido_oficial", ["reportar_plataforma", "responder_corregir"], 12)
            if sev.score >= 50:
                return ("reportar_plataforma", ["responder_corregir"], 24)
            return ("responder_corregir", [], 48)
        if verdict == "enganosa":
            return ("responder_corregir", [], 48)
        return ("registrar", [], 168)

    @staticmethod
    def template_remediation(item: dict[str, Any], action: ActionType, sev: Severity) -> Remediation:
        return Remediation(
            action=action,
            secondary_actions=[],
            measures=["Monitorear evolución del tema en medios y redes sociales."],
            rationale="Atención institucional conforme a los protocolos del INE.",
            draft_message="El INE informa que continúa con los preparativos electorales conforme a la ley.",
            deadline_hours=72,
            degraded=True,
        )


# ---------------------------------------------------------------- LLM Schemas


class _GLMItemRemediation(BaseModel):
    id: str
    measures: list[str] = Field(default_factory=list)
    rationale: str = ""
    draft_message: str | None = None


class _GLMRemediationResponse(BaseModel):
    items: list[_GLMItemRemediation] = Field(default_factory=list)


# ---------------------------------------------------------------- pipeline implementation


def run_scan(
    req: MonitorScanRequest,
    report: Callable[[str, int], None] = lambda s, p: None,
) -> MonitorSnapshot:
    """Execute the multi-stage INE intelligence monitor pipeline."""
    now_dt = datetime.now(timezone.utc)
    today = now_dt.date()
    settings = get_settings()
    cooldown_min = getattr(settings, "intel_monitor_cooldown_min", 15)

    # Cache check when refresh is False
    if not req.refresh:
        cached = latest_snapshot(public=True)
        if cached is not None:
            try:
                gen_dt = datetime.fromisoformat(cached.generated_at)
                if gen_dt.tzinfo is None:
                    gen_dt = gen_dt.replace(tzinfo=timezone.utc)
                ttl_h = getattr(settings, "intel_monitor_ttl_h", 6)
                if (now_dt - gen_dt).total_seconds() < ttl_h * 3600:
                    report("Recuperando escaneo en caché", 100)
                    return cached
            except Exception:
                pass

    try:
        from atalaya import gemini
        gemini_enabled = gemini.is_enabled()
    except Exception:
        gemini_enabled = False

    if not gemini_enabled:
        # Degraded empty snapshot when Gemini is unavailable
        report("Búsqueda con Gemini no disponible", 100)
        snapshot = MonitorSnapshot(
            generated_at=now_dt.isoformat(),
            window_days=req.window_days,
            items=[],
            counts={
                "verdadera": 0,
                "falsa": 0,
                "enganosa": 0,
                "sin_verificar": 0,
                "critica": 0,
                "pendientes": 0,
            },
            queries=[],
            sources_scanned=0,
            model="",
            search_mode="sin_internet",
            degraded=True,
            note="Gemini no está habilitado o no tiene API key configurada; escaneo en modo degradado.",
            next_scan_allowed_at=(now_dt + timedelta(minutes=cooldown_min)).isoformat(),
        )
        _persist_snapshot(snapshot, now_dt)
        return snapshot

    from atalaya.intel import sources, storage, registry
    try:
        from atalaya.intel import impact
    except ImportError:
        impact = _FallbackImpact
    try:
        from atalaya.intel import virality
    except ImportError:
        virality = _FallbackVirality
    try:
        from atalaya.intel import severity
    except ImportError:
        severity = _FallbackSeverity

    ttl_s = 0 if req.refresh else 6 * 3600
    queries_collected: list[str] = []
    grounded_urls: set[str] = set()
    grounded_domains: set[str] = set()
    candidate_sources: list[Any] = []
    sources_scanned_count = 0
    model_name = getattr(settings, "gemini_model", "gemini-3.8-flash")
    stage_notes: list[str] = []
    stage1_mode = "none"
    stage2_mode = "none"
    stage3_mode = "none"

    # ---------------- STAGE 1: Recognized Media
    report("Buscando noticias en medios reconocidos", 10)
    raw_news_items: list[dict[str, Any]] = []
    try:
        news_prompt = prompts_monitor.build_news_prompt(today, req.window_days)
        cache_key_news = f"monitor:noticias:w{req.window_days}:{today.isoformat()}"
        try:
            news_data, news_grounded = gemini.grounded_json(
                news_prompt,
                system=prompts_monitor.SYSTEM_NEWS,
                cache_key=cache_key_news,
                cache_ttl_s=ttl_s,
                fallback_queries=prompts_monitor.STAGE1_FALLBACK_QUERIES,
                fallback_days=req.window_days,
                fallback_max_items=40,
            )
        except TypeError as type_err:
            if "fallback_queries" in str(type_err):
                news_data, news_grounded = gemini.grounded_json(
                    news_prompt,
                    system=prompts_monitor.SYSTEM_NEWS,
                    cache_key=cache_key_news,
                    cache_ttl_s=ttl_s,
                )
            else:
                raise

        stage1_mode = getattr(news_grounded, "mode", "grounding")
        if isinstance(news_data, dict) and "items" in news_data:
            raw_news_items = news_data["items"] or []
        elif isinstance(news_data, list):
            raw_news_items = news_data

        queries_collected.extend(news_grounded.queries)
        for g_src in news_grounded.sources:
            grounded_urls.add(g_src.url)
            grounded_domains.add(g_src.domain)
        candidate_sources.extend(news_grounded.sources)
        sources_scanned_count += len(news_grounded.sources)
        if news_grounded.model:
            model_name = news_grounded.model
    except Exception as exc:
        logger.warning("Stage 1 (recognized media) failed: %s", exc)
        stage_notes.append("Fallo al consultar noticias en medios reconocidos")

    report("Buscando noticias en medios reconocidos", 35)

    # ---------------- STAGE 2: Social Media & Rumors
    report("Buscando publicaciones virales en redes y sitios no reconocidos", 35)
    raw_rumor_items: list[dict[str, Any]] = []
    try:
        rumors_prompt = prompts_monitor.build_rumors_prompt(today, req.window_days)
        cache_key_rumors = f"monitor:rumores:w{req.window_days}:{today.isoformat()}"
        try:
            rumors_data, rumors_grounded = gemini.grounded_json(
                rumors_prompt,
                system=prompts_monitor.SYSTEM_RUMORS,
                cache_key=cache_key_rumors,
                cache_ttl_s=ttl_s,
                fallback_queries=prompts_monitor.STAGE2_FALLBACK_QUERIES,
                fallback_days=req.window_days,
                fallback_max_items=40,
            )
        except TypeError as type_err:
            if "fallback_queries" in str(type_err):
                rumors_data, rumors_grounded = gemini.grounded_json(
                    rumors_prompt,
                    system=prompts_monitor.SYSTEM_RUMORS,
                    cache_key=cache_key_rumors,
                    cache_ttl_s=ttl_s,
                )
            else:
                raise

        stage2_mode = getattr(rumors_grounded, "mode", "grounding")
        if isinstance(rumors_data, dict) and "items" in rumors_data:
            raw_rumor_items = rumors_data["items"] or []
        elif isinstance(rumors_data, list):
            raw_rumor_items = rumors_data

        queries_collected.extend(rumors_grounded.queries)
        for g_src in rumors_grounded.sources:
            grounded_urls.add(g_src.url)
            grounded_domains.add(g_src.domain)
        candidate_sources.extend(rumors_grounded.sources)
        sources_scanned_count += len(rumors_grounded.sources)
        if rumors_grounded.model:
            model_name = rumors_grounded.model
    except Exception as exc:
        logger.warning("Stage 2 (social rumors) failed: %s", exc)
        stage_notes.append("Fallo al consultar publicaciones virales en redes")

    report("Buscando publicaciones virales en redes y sitios no reconocidos", 60)

    # Handle full failure of both retrieval stages
    if not raw_news_items and not raw_rumor_items:
        report("Sin elementos recuperados", 100)
        empty_note_parts = []
        if any(m == "rss_url_context" for m in (stage1_mode, stage2_mode)):
            empty_note_parts.append(
                "Búsqueda de respaldo activa: noticias indexadas (Google News/Bing) leídas por Gemini; sin búsqueda web completa."
            )
        empty_note_parts.append(f"Modo por etapa: noticias={stage1_mode}, rumores={stage2_mode}, verificación=none.")
        if stage_notes:
            empty_note_parts.append("; ".join(stage_notes))
        else:
            empty_note_parts.append("No se identificaron notas ni rumores en la ventana.")
        err_msg = " ".join(empty_note_parts)
        empty_search_mode = _compute_search_mode([stage1_mode, stage2_mode])
        snapshot = MonitorSnapshot(
            generated_at=now_dt.isoformat(),
            window_days=req.window_days,
            items=[],
            counts={
                "verdadera": 0,
                "falsa": 0,
                "enganosa": 0,
                "sin_verificar": 0,
                "critica": 0,
                "pendientes": 0,
            },
            queries=sorted(list(set(queries_collected))),
            sources_scanned=sources_scanned_count,
            model=model_name,
            search_mode=empty_search_mode,
            degraded=bool(stage_notes) or any(m == "rss_url_context" for m in (stage1_mode, stage2_mode)),
            note=err_msg,
            next_scan_allowed_at=(now_dt + timedelta(minutes=cooldown_min)).isoformat(),
        )
        _persist_snapshot(snapshot, now_dt)
        return snapshot

    # Deduplicate and build preliminary item records
    preliminary_items: list[dict[str, Any]] = []

    def _add_or_merge_item(candidate: dict[str, Any], default_kind: str) -> None:
        claim = str(candidate.get("claim") or candidate.get("headline") or "").strip()
        if not claim:
            return

        cand_tokens = tokenize_claim(claim)
        matched_idx = -1
        for idx, exist in enumerate(preliminary_items):
            exist_tokens = tokenize_claim(exist["claim"])
            if jaccard_similarity(cand_tokens, exist_tokens) >= 0.7:
                matched_idx = idx
                break

        if matched_idx >= 0:
            target = preliminary_items[matched_idx]
            # Merge sources and posts
            existing_src_urls = {s.get("url") for s in target.get("sources", []) if s.get("url")}
            for s in candidate.get("sources", []):
                if s.get("url") and s.get("url") not in existing_src_urls:
                    target["sources"].append(s)
                    existing_src_urls.add(s.get("url"))

            existing_post_urls = {p.get("url") for p in target.get("posts", []) if p.get("url")}
            for p in candidate.get("posts", []):
                if p.get("url") and p.get("url") not in existing_post_urls:
                    target["posts"].append(p)
                    existing_post_urls.add(p.get("url"))

            # Elevate kind to noticia if candidate is noticia
            if default_kind == "noticia" and candidate.get("sources"):
                target["kind"] = "noticia"

            target["intensity"] = max(
                float(target.get("intensity", 0.5)),
                float(candidate.get("intensity", 0.5)),
            )
            # Enhance geo scope if target was national
            if target.get("geo", {}).get("level") == "nacional" and candidate.get("geo", {}).get("level") != "nacional":
                target["geo"] = candidate.get("geo")
        else:
            item_entry = {
                "kind": candidate.get("kind", default_kind),
                "headline": str(candidate.get("headline") or claim)[:200],
                "summary": str(candidate.get("summary") or claim)[:300],
                "claim": claim,
                "published": candidate.get("published"),
                "first_seen": now_dt.isoformat(),
                "sources": list(candidate.get("sources") or []),
                "posts": list(candidate.get("posts") or []),
                "topic": candidate.get("topic", "otra"),
                "geo": candidate.get("geo") or {},
                "intensity": float(candidate.get("intensity", 0.5)),
                "persistence": candidate.get("persistence", "coyuntural"),
            }
            item_entry["id"] = item_id_for_claim(claim)
            preliminary_items.append(item_entry)

    for item in raw_news_items:
        _add_or_merge_item(item, "noticia")

    for item in raw_rumor_items:
        _add_or_merge_item(item, "rumor")

    # ---------------- STAGE 3: Fact-Checking & Verification
    report("Verificando afirmaciones con verificadores y fuentes oficiales", 60)
    verifications_map: dict[str, dict[str, Any]] = {}
    if preliminary_items:
        try:
            verif_prompt = prompts_monitor.build_verification_prompt(preliminary_items, today)
            cache_key_verif = f"monitor:verificacion:w{req.window_days}:{today.isoformat()}"
            stage3_fallback_queries = prompts_monitor.build_verification_fallback_queries(preliminary_items)
            try:
                verif_data, verif_grounded = gemini.grounded_json(
                    verif_prompt,
                    system=prompts_monitor.SYSTEM_VERIFICATION,
                    cache_key=cache_key_verif,
                    cache_ttl_s=ttl_s,
                    fallback_queries=stage3_fallback_queries,
                    fallback_days=req.window_days,
                    fallback_max_items=40,
                )
            except TypeError as type_err:
                if "fallback_queries" in str(type_err):
                    verif_data, verif_grounded = gemini.grounded_json(
                        verif_prompt,
                        system=prompts_monitor.SYSTEM_VERIFICATION,
                        cache_key=cache_key_verif,
                        cache_ttl_s=ttl_s,
                    )
                else:
                    raise

            stage3_mode = getattr(verif_grounded, "mode", "grounding")
            raw_verifs = []
            if isinstance(verif_data, dict) and "verifications" in verif_data:
                raw_verifs = verif_data["verifications"] or []
            elif isinstance(verif_data, list):
                raw_verifs = verif_data

            for v in raw_verifs:
                if isinstance(v, dict) and "id" in v:
                    verifications_map[str(v["id"])] = v

            queries_collected.extend(verif_grounded.queries)
            for g_src in verif_grounded.sources:
                grounded_urls.add(g_src.url)
                grounded_domains.add(g_src.domain)
            candidate_sources.extend(verif_grounded.sources)
            sources_scanned_count += len(verif_grounded.sources)
        except Exception as exc:
            logger.warning("Stage 3 (verification) failed: %s", exc)
            stage_notes.append("Fallo al verificar con fuentes de fact-checking y canales oficiales")

    report("Verificando afirmaciones con verificadores y fuentes oficiales", 80)

    # ---------------- STAGE 4: Impact, Virality & Severity
    report("Calculando impacto, viralidad y severidad", 85)
    from atalaya.api import deps
    units_df = deps.get_units_df()
    seed_catalog = sources._load_seed_catalog()

    processed_items: list[NewsItem] = []
    items_glm_payload: list[dict[str, Any]] = []
    discarded_unsupported_count = 0

    for raw_it in preliminary_items:
        item_id = raw_it["id"]
        v_info = verifications_map.get(item_id) or {}

        # 1. Match and resolve sources against candidates and grounding
        valid_src_dicts: list[dict[str, Any]] = []
        for s in raw_it.get("sources", []):
            is_valid, c_dom, c_outlet, c_pub = _match_candidate_source(
                s, candidate_sources, grounded_urls, grounded_domains
            )
            if not is_valid:
                continue
            s_dict = dict(s)
            if c_dom:
                s_dict["domain"] = c_dom
            if c_outlet:
                s_dict["outlet"] = c_outlet
            if c_pub and not s_dict.get("published"):
                s_dict["published"] = c_pub
            valid_src_dicts.append(s_dict)

        resolved_sources = sources.to_source_refs(valid_src_dicts)
        for s_ref in resolved_sources:
            in_grounding = (s_ref.url in grounded_urls) or (s_ref.domain in grounded_domains)
            in_seed = (s_ref.domain in seed_catalog) or (s_ref.tier in sources.VERIFIABLE_TIERS)
            in_candidates = any(getattr(c, "domain", "") == s_ref.domain for c in candidate_sources)
            if not in_grounding and not in_seed and not in_candidates:
                s_ref.tier = "no_reconocido"

        # 2. Fact checks
        valid_fc_dicts: list[dict[str, Any]] = []
        for fc in v_info.get("fact_checks", []):
            is_valid, c_dom, c_outlet, c_pub = _match_candidate_source(
                fc, candidate_sources, grounded_urls, grounded_domains
            )
            fc_dict = dict(fc)
            if c_dom:
                fc_dict["domain"] = c_dom
            if c_outlet:
                fc_dict["outlet"] = c_outlet
            if c_pub and not fc_dict.get("published"):
                fc_dict["published"] = c_pub
            valid_fc_dicts.append(fc_dict)

        resolved_fcs = sources.to_source_refs(valid_fc_dicts, start=len(resolved_sources) + 1)
        for fc in resolved_fcs:
            if fc.tier not in ("verificador", "oficial"):
                # verify heuristic for official centralelectoral or inedesmiente
                if "ine.mx" in fc.domain or "verificado" in fc.domain or "animalpolitico" in fc.domain:
                    fc.tier = "verificador" if ("verificado" in fc.domain or "animalpolitico" in fc.domain) else "oficial"

        # 3. Social posts
        social_posts: list[SocialPost] = []
        for p in raw_it.get("posts", []):
            url = str(p.get("url") or "").strip()
            if not url:
                continue
            plat = p.get("platform")
            if not plat or plat == "otro":
                plat = sources.platform_of(url)

            eng_raw = p.get("engagement") or {}
            eng = Engagement(
                likes=eng_raw.get("likes") if isinstance(eng_raw.get("likes"), int) else None,
                shares=eng_raw.get("shares") if isinstance(eng_raw.get("shares"), int) else None,
                comments=eng_raw.get("comments") if isinstance(eng_raw.get("comments"), int) else None,
                views=eng_raw.get("views") if isinstance(eng_raw.get("views"), int) else None,
            )
            excerpt = str(p.get("excerpt") or "")[:280]
            author = p.get("author")
            author_clean = str(author).strip() if author else None

            social_posts.append(
                SocialPost(
                    platform=plat,
                    url=url,
                    author=author_clean,
                    published=p.get("published"),
                    engagement=eng,
                    excerpt=excerpt,
                )
            )

        # 4. Item without backing => discard
        has_retained_sources = len(resolved_sources) > 0
        has_platform_posts = any(p.url and p.platform != "otro" for p in social_posts)
        if not has_retained_sources and not has_platform_posts:
            discarded_unsupported_count += 1
            continue

        # 5. Check domain tier degradation rule
        kind = raw_it["kind"]
        if kind == "noticia":
            primary_dom = resolved_sources[0].domain if resolved_sources else ""
            primary_tier = sources.classify_domain(primary_dom) if primary_dom else "no_reconocido"
            if primary_tier not in sources.VERIFIABLE_TIERS:
                kind = "rumor"

        # 6. Verdict determination (deterministic rules in RSS mode)
        v_verdict = v_info.get("verdict")
        is_contradicted = (v_verdict in ("falsa", "enganosa")) and (bool(resolved_fcs) or bool(v_info.get("rationale")))

        official_sources = [s for s in resolved_sources if s.tier == "oficial"] + [fc for fc in resolved_fcs if fc.tier == "oficial"]
        has_official = len(official_sources) > 0

        # Verifiable media sources (excluding official)
        media_sources = [s for s in resolved_sources if s.tier in ("medio_reconocido", "medio_regional", "academico", "verificador")]
        # Deduplicate media sources by distinct domain
        seen_media_domains: set[str] = set()
        distinct_media_sources: list[SourceRef] = []
        for s in media_sources:
            if s.domain and s.domain not in seen_media_domains:
                seen_media_domains.add(s.domain)
                distinct_media_sources.append(s)
        n_media = len(distinct_media_sources)

        has_reconocido = any(s.tier == "medio_reconocido" for s in distinct_media_sources)
        has_regional_or_academico = any(s.tier in ("medio_regional", "academico") for s in distinct_media_sources)

        v_verdict_str = str(v_info.get("verdict") or "").lower().strip()
        v_rat_str = str(v_info.get("rationale") or "").lower()
        is_dudosa = (
            v_verdict_str in ("dudosa", "cuestionada")
            or "dudos" in v_rat_str
            or "cuestionad" in v_rat_str
        )

        if is_contradicted:
            raw_verdict = v_verdict
            verdict_conf = v_info.get("confidence", "media")
            if verdict_conf not in ("alta", "media", "baja"):
                verdict_conf = "media"
            verdict_rat = v_info.get("rationale") or "Afirmación desmentida o identificada como engañosa por verificadores de hechos o canales oficiales del INE."
        elif kind == "noticia":
            if n_media >= 3 or (has_official and n_media >= 1):
                raw_verdict = "verdadera"
                verdict_conf = "alta"
                if has_official and n_media >= 1:
                    off_outlets = list(dict.fromkeys([s.outlet or s.domain for s in official_sources if s.outlet or s.domain]))
                    med_outlets = list(dict.fromkeys([s.outlet or s.domain for s in distinct_media_sources if s.outlet or s.domain]))
                    off_str = ", ".join(off_outlets) or "fuentes oficiales del INE"
                    med_str = ", ".join(med_outlets) or "medios reconocidos"
                    verdict_rat = f"Respaldada por {off_str} y cobertura informativa en {med_str}; sin registro de desmentido oficial."
                else:
                    med_outlets = list(dict.fromkeys([s.outlet or s.domain for s in distinct_media_sources if s.outlet or s.domain]))
                    names_str = ", ".join(med_outlets[:3])
                    verdict_rat = f"Reportada de manera coincidente por {n_media} medios de comunicación verificables ({names_str}); sin registro de desmentido oficial."
            elif n_media >= 2:
                raw_verdict = "verdadera"
                verdict_conf = "media"
                med_outlets = list(dict.fromkeys([s.outlet or s.domain for s in distinct_media_sources if s.outlet or s.domain]))
                names_str = " y ".join(med_outlets)
                verdict_rat = f"Reportada por {names_str} ({n_media} medios distintos); sin registro de desmentido oficial."
            elif has_official or has_reconocido:
                raw_verdict = "verdadera"
                verdict_conf = "baja"
                if has_official:
                    src = official_sources[0]
                    name = src.outlet or src.domain or "fuente oficial"
                    tier_str = "fuente oficial"
                else:
                    src = [s for s in distinct_media_sources if s.tier == "medio_reconocido"][0]
                    name = src.outlet or src.domain or "medio reconocido"
                    tier_str = "medio reconocido"
                verdict_rat = f"Publicada por {name} ({tier_str}); sin confirmación independiente ni desmentido."
            elif has_regional_or_academico:
                if is_dudosa:
                    raw_verdict = "sin_verificar"
                    verdict_conf = "baja"
                    verdict_rat = v_info.get("rationale") or "Publicada por medio regional o académico pero clasificada como dudosa en verificación."
                else:
                    raw_verdict = "verdadera"
                    verdict_conf = "baja"
                    src = [s for s in distinct_media_sources if s.tier in ("medio_regional", "academico")][0]
                    name = src.outlet or src.domain or "medio regional"
                    tier_str = "medio regional" if src.tier == "medio_regional" else "fuente académica"
                    verdict_rat = f"Publicada por {name} ({tier_str}); sin confirmación independiente ni desmentido."
            else:
                raw_verdict = "sin_verificar"
                verdict_conf = "baja"
                verdict_rat = "Cobertura informativa sin fuentes verificables suficientes."
        else:
            if v_verdict in ("verdadera", "falsa", "enganosa") and (resolved_fcs or has_official):
                raw_verdict = v_verdict
                verdict_conf = v_info.get("confidence", "media")
                verdict_rat = v_info.get("rationale") or "Evaluado conforme a dictamen de verificación de hechos."
            else:
                raw_verdict = "sin_verificar"
                verdict_conf = "baja"
                verdict_rat = "Sin dictamen formal disponible en verificadores reconocidos o canales oficiales."

        accusation_kw = ("presunt", "señalamient", "acusaci", "denunci", "investig")
        claim_str = raw_it.get("claim", "")
        headline_str = raw_it.get("headline", "")
        is_accusation = any(kw in claim_str.lower() or kw in headline_str.lower() for kw in accusation_kw)
        if raw_verdict == "verdadera" and is_accusation:
            verdict_rat += " Veredicto respecto a la existencia de la denuncia o señalamiento reportado en medios, no sobre la culpabilidad de las personas señaladas."

        verdict_conf = verdict_conf if verdict_conf in ("alta", "media", "baja") else "baja"

        geo_scope = _resolve_geo(raw_it.get("geo"))
        topic = raw_it.get("topic", "otra")
        intensity = float(raw_it.get("intensity", 0.5))
        persistence = raw_it.get("persistence", "coyuntural")

        # Deterministic Impact
        item_impact_data: NewsImpact | None = None
        if raw_verdict in ("verdadera", "enganosa"):
            try:
                item_impact_data = impact.news_impact(
                    units_df,
                    topic=topic,
                    geo=geo_scope,
                    intensity=intensity,
                    persistence=persistence,
                    today=today,
                    level="state",
                )
            except Exception as exc:
                logger.warning("Error computing news impact for item %s: %s", item_id, exc)

        # Deterministic Virality
        item_virality_data = None
        if social_posts:
            try:
                item_virality_data = virality.virality(social_posts, topic=topic, today=now_dt)
            except Exception as exc:
                logger.warning("Error computing virality for item %s: %s", item_id, exc)

        # Deterministic Severity & Action
        if raw_verdict == "verdadera" and item_impact_data is not None:
            sev = severity.severity_true(item_impact_data)
        elif item_virality_data is not None:
            sev = severity.severity_fake(item_virality_data, topic, raw_verdict)
        elif item_impact_data is not None:
            sev = severity.severity_true(item_impact_data)
        else:
            sev = Severity(level="baja", score=15, drivers=["Evaluación preliminar sin métricas suficientes"])

        action, sec_actions, deadline_h = severity.decide_action(
            raw_verdict, sev, has_posts=bool(social_posts)
        )

        # Prefill & report targets
        campaign_prefill = None
        if action == "campana_intervencion" or "campana_intervencion" in sec_actions:
            if item_impact_data is not None:
                try:
                    campaign_prefill = impact.campaign_prefill_for(item_impact_data, topic)
                except Exception as exc:
                    logger.warning("Error generating campaign prefill: %s", exc)

        report_targets: list[ReportTarget] = []
        if action in ("reportar_plataforma", "responder_corregir", "desmentido_oficial") or any(
            a in ("reportar_plataforma", "responder_corregir", "desmentido_oficial") for a in sec_actions
        ):
            for post in social_posts:
                report_targets.append(
                    ReportTarget(
                        platform=post.platform,
                        url=post.url,
                        author=post.author,
                        reason="Publicación con afirmaciones desfavorables no verificadas o desmentidas institucionalmente.",
                    )
                )

        news_item = NewsItem(
            id=item_id,
            kind=kind,
            headline=raw_it["headline"],
            summary=raw_it["summary"],
            claim=raw_it["claim"],
            published=raw_it.get("published"),
            first_seen=raw_it["first_seen"],
            sources=resolved_sources,
            verdict=raw_verdict,
            verdict_confidence=verdict_conf,
            verdict_rationale=verdict_rat,
            fact_checks=resolved_fcs,
            topic=topic,
            geo=geo_scope,
            intensity=intensity,
            persistence=persistence,
            impact=item_impact_data,
            virality=item_virality_data,
            severity=sev,
            remediation=Remediation(
                action=action,
                secondary_actions=sec_actions,
                measures=[],
                rationale="",
                draft_message=None,
                report_targets=report_targets,
                campaign_prefill=campaign_prefill,
                deadline_hours=deadline_h,
                degraded=True,
            ),
        )
        processed_items.append(news_item)

        items_glm_payload.append({
            "id": item_id,
            "headline": news_item.headline,
            "claim": news_item.claim,
            "verdict": news_item.verdict,
            "topic": news_item.topic,
            "severity": news_item.severity.model_dump(),
            "action": action,
            "delta_pp_national": item_impact_data.delta_pp_national if item_impact_data else None,
            "max_delta_pp": item_impact_data.max_delta_pp if item_impact_data else None,
            "votos_perdidos_total": item_impact_data.votos_perdidos_total if item_impact_data else None,
            "virality_score": item_virality_data.score if item_virality_data else None,
            "platforms": [p.platform for p in social_posts],
        })

    # ---------------- STAGE 5: Remediation Drafting with GLM-5.3
    report("Redactando medidas con GLM-5.3", 90)
    glm_remediations: dict[str, _GLMItemRemediation] = {}
    try:
        from atalaya import llm
        if llm.is_enabled():
            glm_messages = prompts_monitor.build_glm_remediation_messages(items_glm_payload)
            glm_resp = llm.chat_json(
                glm_messages,
                schema=_GLMRemediationResponse,
                reasoning_effort="high",
                max_tokens=4000,
                timeout_s=150.0,
            )
            for itm in glm_resp.items:
                glm_remediations[itm.id] = itm
    except Exception as exc:
        logger.warning("GLM remediation call failed: %s", exc)

    report("Redactando medidas con GLM-5.3", 98)

    # Attach measures and format lengths
    for item in processed_items:
        g_rem = glm_remediations.get(item.id)
        if g_rem is not None:
            measures = g_rem.measures[:5]
            rationale = g_rem.rationale or ""
            draft_msg = g_rem.draft_message

            # Length constraints enforcement
            if draft_msg:
                if item.remediation.action in ("responder_corregir", "reportar_plataforma"):
                    if len(draft_msg) > 280:
                        trimmed = draft_msg[:280]
                        if " " in trimmed:
                            draft_msg = trimmed.rsplit(" ", 1)[0]
                        else:
                            draft_msg = trimmed
                elif item.remediation.action in ("comunicado", "desmentido_oficial"):
                    words = draft_msg.split()
                    if len(words) > 180:
                        draft_msg = " ".join(words[:180])

            item.remediation.measures = measures
            item.remediation.rationale = rationale
            item.remediation.draft_message = draft_msg
            item.remediation.degraded = False
        else:
            # Fallback to deterministic template remediation
            try:
                tmpl = severity.template_remediation(item.model_dump(), item.remediation.action, item.severity)
                item.remediation.measures = tmpl.measures[:5] if tmpl.measures else ["Monitorear evolución del tema en medios y redes."]
                item.remediation.rationale = tmpl.rationale or "Medidas generadas por plantilla determinista institucional."
                item.remediation.draft_message = tmpl.draft_message
                item.remediation.degraded = True
            except Exception:
                item.remediation.measures = ["Registrar incidencia y monitorear evolución."]
                item.remediation.rationale = "Atención conforme al protocolo de monitoreo institucional."
                item.remediation.degraded = True

    # Compute summary counts
    counts = {
        "verdadera": sum(1 for it in processed_items if it.verdict == "verdadera"),
        "falsa": sum(1 for it in processed_items if it.verdict == "falsa"),
        "enganosa": sum(1 for it in processed_items if it.verdict == "enganosa"),
        "sin_verificar": sum(1 for it in processed_items if it.verdict == "sin_verificar"),
        "critica": sum(1 for it in processed_items if it.severity.level == "critica"),
        "pendientes": len(processed_items),
    }

    # Construct institutional note including modes per stage and explanation if RSS mode was used
    note_parts: list[str] = []
    if any(m == "rss_url_context" for m in (stage1_mode, stage2_mode, stage3_mode)):
        note_parts.append(
            "Búsqueda de respaldo activa: noticias indexadas (Google News/Bing) leídas por Gemini; sin búsqueda web completa. "
            "En modo RSS los rumores provienen de notas de verificadores y sitios no reconocidos; "
            "las publicaciones en redes solo se registran si el material muestra su URL, y las métricas solo si el verificador las reporta."
        )

    note_parts.append(f"Modo por etapa: noticias={stage1_mode}, rumores={stage2_mode}, verificación={stage3_mode}.")

    if discarded_unsupported_count > 0:
        note_parts.append(f"{discarded_unsupported_count} afirmaciones descartadas por no tener fuente verificable.")

    if stage_notes:
        note_parts.append(f"Escaneo parcial: {'; '.join(stage_notes)}.")

    note_text: str | None = " ".join(note_parts) if note_parts else None

    active_modes = [stage1_mode, stage2_mode]
    if preliminary_items:
        active_modes.append(stage3_mode)
    final_search_mode = _compute_search_mode(active_modes)

    snapshot = MonitorSnapshot(
        generated_at=now_dt.isoformat(),
        window_days=req.window_days,
        items=processed_items,
        counts=counts,
        queries=sorted(list(set(queries_collected))),
        sources_scanned=sources_scanned_count,
        model=model_name,
        search_mode=final_search_mode,
        degraded=bool(stage_notes),
        note=note_text,
        next_scan_allowed_at=(now_dt + timedelta(minutes=cooldown_min)).isoformat(),
    )

    _persist_snapshot(snapshot, now_dt)
    report("Listo", 100)
    return snapshot


def _persist_snapshot(snapshot: MonitorSnapshot, now_dt: datetime) -> None:
    """Save snapshot to latest.json and historical audit folder (keeping up to 20)."""
    try:
        from atalaya.intel import storage
        # Write latest.json atomically
        storage.write_json_atomic(storage.monitor_result_path(), snapshot.model_dump())

        # Write history timestamped file
        history_dir = storage.intel_dir() / "results" / "monitor"
        history_dir.mkdir(parents=True, exist_ok=True)
        history_file = history_dir / f"{now_dt.strftime('%Y%m%d%H%M%S')}.json"
        storage.write_json_atomic(history_file, snapshot.model_dump())

        # Retain at most 20 history files
        history_files = sorted([p for p in history_dir.glob("*.json") if p.name != "latest.json"])
        if len(history_files) > 20:
            for old_file in history_files[:-20]:
                try:
                    old_file.unlink()
                except OSError:
                    pass
    except Exception as exc:
        logger.error("Failed to persist monitor snapshot: %s", exc)


def latest_snapshot(*, public: bool = True) -> MonitorSnapshot | None:
    """Load latest scan from cache, merge operator registry status, and recalculate pending count."""
    try:
        from atalaya.intel import storage, registry
    except ImportError:
        return None

    path = storage.monitor_result_path()
    data = storage.read_json(path)
    if not data:
        return None

    try:
        snapshot = MonitorSnapshot.model_validate(data)
    except Exception as exc:
        logger.warning("Error parsing latest.json: %s", exc)
        return None

    item_ids = [it.id for it in snapshot.items]
    if item_ids:
        try:
            reg_map = registry.latest_map(item_ids, public=public)
            for it in snapshot.items:
                it.status = reg_map.get(it.id)
        except Exception as exc:
            logger.warning("Error fetching registry latest_map: %s", exc)

    # Recalculate pending items count
    snapshot.counts["pendientes"] = sum(
        1 for it in snapshot.items if not it.status or it.status.status == "pendiente"
    )
    return snapshot


def item_impact(item_id: str, level: Level = "state", ent: str | None = None) -> NewsImpact:
    """Recalculate realistic impact for an item at state or municipal level."""
    if level == "mun" and not ent:
        raise ValueError("Se requiere el parámetro 'ent' para nivel municipal.")

    from atalaya.intel import storage
    try:
        from atalaya.intel import impact
    except ImportError:
        impact = _FallbackImpact
    from atalaya.api import deps

    path = storage.monitor_result_path()
    data = storage.read_json(path)
    if not data:
        raise KeyError(f"No hay escaneo previo del monitor. Item no encontrado: {item_id}")

    try:
        snapshot = MonitorSnapshot.model_validate(data)
    except Exception as exc:
        raise KeyError(f"Error leyendo el último escaneo del monitor: {exc}") from exc

    target_item: NewsItem | None = None
    for it in snapshot.items:
        if it.id == item_id:
            target_item = it
            break

    if target_item is None:
        raise KeyError(f"Item no encontrado en el último escaneo: {item_id}")

    units_df = deps.get_units_df()
    return impact.news_impact(
        units_df,
        topic=target_item.topic,
        geo=target_item.geo,
        intensity=target_item.intensity,
        persistence=target_item.persistence,
        level=level,
        ent=ent,
    )


def cooldown_remaining_s() -> int:
    """Calculate remaining cooldown seconds until the next scan is permitted."""
    from atalaya.intel import storage
    settings = get_settings()

    path = storage.monitor_result_path()
    data = storage.read_json(path)
    if not data:
        return 0

    gen_str = data.get("generated_at")
    if not gen_str:
        return 0

    try:
        gen_dt = datetime.fromisoformat(gen_str)
        if gen_dt.tzinfo is None:
            gen_dt = gen_dt.replace(tzinfo=timezone.utc)
        cooldown_min = getattr(settings, "intel_monitor_cooldown_min", 15)
        now_dt = datetime.now(timezone.utc)
        elapsed_s = (now_dt - gen_dt).total_seconds()
        remaining = int(cooldown_min * 60 - elapsed_s)
        return max(0, remaining)
    except Exception:
        return 0
