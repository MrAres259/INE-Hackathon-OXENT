"""Campaign Planning Pipeline for Atalaya Electoral.

Orchestrates:
1. DataSnapshot collection from Atalaya deterministic models & data store.
2. Verified civic research using Gemini Grounded Search with Google Search.
3. Institutional campaign plan drafting via GLM-5.3 (Huawei ModelArts MaaS) or deterministic fallback.
4. Deterministic scenario impact calculation using model.scenarios.simulate.
5. Presentation deck building via intel.deck.build_slides.
6. Caching and retrieval from storage.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import logging
from pathlib import Path
import re
import time
from typing import Any, Callable
import unicodedata
import urllib.parse

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

from atalaya.api import deps
from atalaya.intel.prompts_campaign import (
    build_campaign_fallback_queries,
    build_planner_prompt,
    build_research_prompt,
)
from atalaya.intel.schemas import (
    CampaignPlan,
    CampaignRequest,
    Confidence,
    DataSnapshot,
    DriverBrief,
    Finding,
    FindingCategory,
    ImpactAnalysis,
    ImplementationStep,
    Lever,
    Level,
    LLMInfo,
    Proposal,
    ProposalImpact,
    ResearchBundle,
    RiskItem,
    Slide,
    SourceRef,
    SourceTier,
    TargetGroup,
    Targeting,
)
from atalaya.model import recommend, scenarios
from atalaya.model.risk import category_for
from atalaya.store import get_store

logger = logging.getLogger("atalaya.intel.campaign")

VALID_FINDING_CATEGORIES: set[FindingCategory] = {
    "desconfianza_institucional",
    "inseguridad_violencia",
    "acceso_casillas_distancia",
    "desinformacion",
    "apatia_desafeccion",
    "barreras_documentales_credencial",
    "migracion_movilidad",
    "exclusion_linguistica_cultural",
    "condiciones_socioeconomicas",
    "otra",
}

VALID_LEVERS: list[Lever] = [
    "promocion_jovenes",
    "casillas_rurales",
    "materiales_lengua_indigena",
    "campana_general",
]

DEFAULT_VERIFIABLE_TIERS: set[str] = {
    "oficial",
    "verificador",
    "academico",
    "medio_reconocido",
    "medio_regional",
}


# ---------------------------------------------------------------- helpers


def _val(x: Any, cast: Callable[[Any], Any] | None = None) -> Any:
    """Safely return None if x is None or NaN, else cast(x)."""
    if x is None or pd.isna(x):
        return None
    return cast(x) if cast else x


def _clean_pct(v: Any) -> float | None:
    """Normalize percentage: if in [0, 1] range, convert to [0, 100] scale."""
    if v is None or pd.isna(v):
        return None
    val = float(v)
    if 0.0 < val <= 1.0:
        return round(val * 100.0, 2)
    return round(val, 2)


def _safe_domain(url: str) -> str:
    """Extract lower-case hostname without leading www."""
    try:
        parsed = urllib.parse.urlparse(url)
        netloc = parsed.netloc.lower()
        if ":" in netloc:
            netloc = netloc.split(":")[0]
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def _fallback_classify_domain(domain: str) -> SourceTier:
    """Fallback domain classifier matching sources.py contract when sources module is missing."""
    d = domain.lower()
    if any(d.endswith(suf) for suf in [".gob.mx", ".ine.mx", "inegi.org.mx", "te.gob.mx", "dof.gob.mx"]):
        return "oficial"
    if any(kw in d for kw in ["verificado.com.mx", "animalpolitico.com", "factual.afp.com", "reuters.com"]):
        return "verificador"
    if any(d.endswith(suf) for suf in [".edu.mx", ".unam.mx", "colmex.mx", "cide.edu", "uam.mx", "itesm.mx", ".edu"]):
        return "academico"
    if any(kw in d for kw in ["eluniversal.com.mx", "reforma.com", "milenio.com", "jornada.com.mx", "elfinanciero.com.mx", "eleconomista.com.mx", "proceso.com.mx", "aristeguinoticias.com", "bbcmundo.com", "elpais.com"]):
        return "medio_reconocido"
    if any(kw in d for kw in ["facebook.com", "twitter.com", "x.com", "tiktok.com", "instagram.com", "youtube.com", "t.me", "telegram.org"]):
        return "red_social"
    return "no_reconocido"


# ---------------------------------------------------------------- 1. build_snapshot


def build_snapshot(unit_id: str) -> DataSnapshot:
    """Builds a deterministic DataSnapshot for the given geographic unit.

    Sources:
    - deps.get_units_df(): demographics, historical and predicted participation.
    - store.get_store().drivers(): top 5 drivers sorted by absolute contribution.
    - model.recommend.recommend(): top preventive recommendation titles.

    Raises KeyError if unit_id does not exist.
    """
    uid_str = str(unit_id).strip()
    units_df = deps.get_units_df()

    if units_df.empty:
        raise KeyError(f"Catálogo de unidades vacío; no se encontró la unidad '{unit_id}'")

    id_col = "id" if "id" in units_df.columns else "cvegeo"
    matches = units_df[units_df[id_col].astype(str) == uid_str]

    if matches.empty and len(uid_str) == 2 and "cve_ent" in units_df.columns:
        matches = units_df[(units_df["cve_ent"].astype(str).str.zfill(2) == uid_str) & (units_df.get("level") == "state")]

    if matches.empty:
        raise KeyError(f"Unidad geográfica '{unit_id}' no encontrada en el catálogo")

    row = matches.iloc[0]

    raw_level = row.get("level")
    if raw_level in ["state", "mun"]:
        level: Level = raw_level
    else:
        level = "state" if len(uid_str) == 2 else "mun"

    if level == "state":
        ent = uid_str.zfill(2)
        ent_name = str(row.get("name", ""))
    else:
        ent = str(row.get("cve_ent", row.get("ent", uid_str[:2]))).zfill(2)
        state_rows = units_df[(units_df[id_col].astype(str).str.zfill(2) == ent) & (units_df.get("level") == "state")]
        if not state_rows.empty:
            ent_name = str(state_rows.iloc[0].get("name", ""))
        else:
            ent_name = str(row.get("nom_ent", ent))

    unit_name = str(row.get("name", row.get("nom_mun", f"Unidad {uid_str}")))

    lista_nominal = int(row.get("lista_nominal", 0)) if not pd.isna(row.get("lista_nominal")) else 0

    pred_abs = _val(row.get("pred_abstention"), float)
    if pred_abs is not None:
        pred_abs = round(pred_abs, 4)

    pred_low = _val(row.get("pred_low"), float)
    pred_high = _val(row.get("pred_high"), float)
    category = str(row.get("category", "sin_dato"))
    risk_score = _val(row.get("risk_score"), float)
    last_participation = _val(row.get("last_participation"), float)
    last_year = _val(row.get("last_year"), int)
    trend_pp = _val(row.get("trend_pp"), float)

    abst_esp = _val(row.get("abstencion_esperada"), int)
    if abst_esp is None and pred_abs is not None and lista_nominal > 0:
        abst_esp = int(round(pred_abs * lista_nominal))

    part_18_34 = _val(row.get("part_18_34_last"), float)
    gap_youth = _val(row.get("gap_youth_pp_last"), float)

    pct_18_24 = _clean_pct(row.get("pct_18_24"))
    pct_rural = _clean_pct(row.get("pct_rural"))
    pct_hli = _clean_pct(row.get("pct_hli"))
    pct_internet = _clean_pct(row.get("pct_internet"))
    im_2020 = _val(row.get("im_2020"), float)

    # State-level municipal counts
    municipios: int | None = None
    municipios_rojos: int | None = None
    if level == "state":
        muns_in_st = units_df[(units_df.get("level") == "mun") & (units_df.get("cve_ent", "").astype(str).str.zfill(2) == ent)]
        if not muns_in_st.empty:
            municipios = int(len(muns_in_st))
            municipios_rojos = int((muns_in_st["category"] == "rojo").sum())
        else:
            municipios = 0
            municipios_rojos = 0

    # Drivers
    store = get_store()
    raw_drivers = store.drivers(uid_str)
    sorted_drivers = sorted(
        raw_drivers,
        key=lambda d: abs(float(d.get("contribution_pp") or 0.0)),
        reverse=True,
    )[:5]

    drivers_brief = []
    for d in sorted_drivers:
        lbl = str(d.get("label") or d.get("label_es") or d.get("key") or "Factor")
        contrib = round(float(d.get("contribution_pp") or 0.0), 2)
        drivers_brief.append(DriverBrief(label=lbl, contribution_pp=contrib))

    # Recommendations
    reco_ref = deps.get_reco_reference(level)
    raw_unit_dict = {k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()}
    raw_recos = recommend.recommend(raw_unit_dict, raw_drivers, reco_ref)
    reco_titles = [str(r.get("title", "")) for r in raw_recos if r.get("title")]

    return DataSnapshot(
        unit_id=uid_str,
        name=unit_name,
        level=level,
        ent=ent,
        ent_name=ent_name,
        lista_nominal=lista_nominal,
        pred_abstention=pred_abs,
        pred_low=pred_low,
        pred_high=pred_high,
        category=category,
        risk_score=risk_score,
        last_participation=last_participation,
        last_year=last_year,
        trend_pp=trend_pp,
        abstencion_esperada=abst_esp,
        part_18_34_last=part_18_34,
        gap_youth_pp_last=gap_youth,
        pct_18_24=pct_18_24,
        pct_rural=pct_rural,
        pct_hli=pct_hli,
        pct_internet=pct_internet,
        im_2020=im_2020,
        drivers=drivers_brief,
        recommendations=reco_titles,
        municipios=municipios,
        municipios_rojos=municipios_rojos,
    )


# ---------------------------------------------------------------- 2. research_unit


def research_unit(
    snapshot: DataSnapshot,
    focus: str | None = None,
    *,
    refresh: bool = False,
) -> ResearchBundle:
    """Researches causes of electoral abstention for the snapshot using Gemini Grounded Search.

    Enforces §6.2 post-processing:
    - Filters by verifiable source tiers.
    - Anti-hallucination cross-check against GroundedResult.sources and seed domains.
    - Drops findings without retained sources.
    - Maps findings to unique ids 'f1'..'fN' and evidence to 's1'..'sN'.
    - Returns degraded ResearchBundle on any Gemini error; never raises exceptions.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    # Dynamic imports for monkeypatching in tests
    try:
        from atalaya import gemini
    except Exception:
        gemini = None

    try:
        from atalaya.intel import sources
    except Exception:
        sources = None

    gemini_enabled = False
    if gemini is not None:
        try:
            gemini_enabled = gemini.is_enabled()
        except Exception:
            gemini_enabled = False

    if not gemini_enabled:
        return ResearchBundle(
            unit_id=snapshot.unit_id,
            unit_name=snapshot.name,
            level=snapshot.level,
            findings=[],
            sources=[],
            discarded_sources=0,
            queries=[],
            generated_at=now_iso,
            model="",
            from_cache=False,
            search_mode="sin_internet",
            degraded=True,
            note="No se pudo investigar en internet (Gemini no está configurado). El plan usa solo los datos de Atalaya Electoral.",
        )

    system_prompt, user_prompt = build_research_prompt(snapshot, focus)
    cache_key = f"campaign:{snapshot.unit_id}:{focus or ''}"
    cache_ttl_s = 0 if refresh else 72 * 3600
    fallback_queries = build_campaign_fallback_queries(snapshot, focus)

    try:
        try:
            parsed_json, grounded_res = gemini.grounded_json(
                user_prompt,
                system=system_prompt,
                cache_key=cache_key,
                cache_ttl_s=cache_ttl_s,
                fallback_queries=fallback_queries,
                fallback_days=1460,
            )
        except TypeError as type_err:
            if "fallback_queries" in str(type_err):
                parsed_json, grounded_res = gemini.grounded_json(
                    user_prompt,
                    system=system_prompt,
                    cache_key=cache_key,
                    cache_ttl_s=cache_ttl_s,
                )
            else:
                raise

        # If 1460 days yielded no findings in RSS mode, try 365 days
        raw_f_check = parsed_json.get("findings", []) if isinstance(parsed_json, dict) else []
        if not raw_f_check and getattr(grounded_res, "mode", "grounding") == "rss_url_context":
            try:
                p_365, g_365 = gemini.grounded_json(
                    user_prompt,
                    system=system_prompt,
                    cache_key=f"{cache_key}:365",
                    cache_ttl_s=cache_ttl_s,
                    fallback_queries=fallback_queries,
                    fallback_days=365,
                )
                if isinstance(p_365, dict) and p_365.get("findings"):
                    parsed_json, grounded_res = p_365, g_365
            except Exception:
                pass
    except Exception as exc:
        logger.warning("Gemini grounded_json failed for unit %s: %s", snapshot.unit_id, exc)
        return ResearchBundle(
            unit_id=snapshot.unit_id,
            unit_name=snapshot.name,
            level=snapshot.level,
            findings=[],
            sources=[],
            discarded_sources=0,
            queries=[],
            generated_at=now_iso,
            model="",
            from_cache=False,
            search_mode="sin_internet",
            degraded=True,
            note=f"No se pudo investigar en internet ({exc}). El plan usa solo los datos de Atalaya Electoral.",
        )

    # Grounded sources from Gemini response
    grounded_urls: set[str] = set()
    grounded_domains: set[str] = set()
    for gs in getattr(grounded_res, "sources", []):
        u = getattr(gs, "url", "")
        if u:
            grounded_urls.add(u)
        d = getattr(gs, "domain", "") or _safe_domain(u)
        if d:
            grounded_domains.add(d)

    verifiable_tiers = getattr(sources, "VERIFIABLE_TIERS", DEFAULT_VERIFIABLE_TIERS)

    raw_findings = parsed_json.get("findings", []) if isinstance(parsed_json, dict) else []
    if not isinstance(raw_findings, list):
        raw_findings = []

    discarded_sources_count = 0
    retained_sources_map: dict[str, dict[str, Any]] = {}  # final_url -> dict
    retained_findings_temp: list[dict[str, Any]] = []

    def _match_campaign_candidate(raw_src_dict: dict[str, Any], cand_list: list[Any]) -> Any | None:
        raw_u = str(raw_src_dict.get("url") or "").strip()
        raw_t = unicodedata.normalize("NFKD", str(raw_src_dict.get("title") or "")).lower()
        raw_t = re.sub(r"[^\w\s]", " ", "".join(c for c in raw_t if not unicodedata.combining(c))).strip()

        for cand in cand_list:
            cu = getattr(cand, "url", "")
            ct = unicodedata.normalize("NFKD", str(getattr(cand, "title", ""))).lower()
            ct = re.sub(r"[^\w\s]", " ", "".join(c for c in ct if not unicodedata.combining(c))).strip()

            if raw_u and cu:
                if raw_u == cu or raw_u.rstrip("/") == cu.rstrip("/"):
                    return cand
                if len(raw_u) > 25 and (raw_u in cu or cu in raw_u):
                    return cand

            if raw_t and ct:
                if raw_t == ct or (len(raw_t) >= 20 and (raw_t in ct or ct in raw_t)):
                    return cand
                tokens_r = set(raw_t.split())
                tokens_c = set(ct.split())
                if tokens_r and tokens_c and (len(tokens_r & tokens_c) / len(tokens_r | tokens_c) >= 0.5):
                    return cand
        return None

    candidate_sources = list(getattr(grounded_res, "sources", []))

    for raw_f in raw_findings:
        if not isinstance(raw_f, dict):
            continue

        raw_srcs = raw_f.get("sources", [])
        if not isinstance(raw_srcs, list):
            raw_srcs = []

        valid_src_urls_for_finding: list[str] = []

        for s in raw_srcs:
            if not isinstance(s, dict):
                discarded_sources_count += 1
                continue

            raw_url = str(s.get("url", "")).strip()
            if not raw_url.startswith("http://") and not raw_url.startswith("https://"):
                discarded_sources_count += 1
                continue

            matched_cand = _match_campaign_candidate(s, candidate_sources)

            # Resolve redirect if resolver available
            resolved_url = raw_url
            if hasattr(gemini, "resolve_source_url"):
                try:
                    resolved_url = gemini.resolve_source_url(raw_url)
                except Exception:
                    resolved_url = raw_url

            domain = getattr(gemini, "domain_of", _safe_domain)(resolved_url)

            # Override aggregator domain with candidate's real domain
            cand_domain = getattr(matched_cand, "domain", "") if matched_cand else ""
            if cand_domain and hasattr(sources, "_is_aggregator") and sources._is_aggregator(domain):
                domain = cand_domain
            elif cand_domain and ("news.google.com" in domain or "bing.com" in domain):
                domain = cand_domain

            # Classify domain
            if hasattr(sources, "classify_domain"):
                tier: SourceTier = sources.classify_domain(domain)
            else:
                tier = _fallback_classify_domain(domain)

            # Anti-hallucination check:
            # Must appear in groundingChunks OR resolve to a recognized/seed domain OR match candidate
            is_in_chunks = (raw_url in grounded_urls) or (resolved_url in grounded_urls) or (domain in grounded_domains)
            is_in_seed = (tier != "no_reconocido")
            is_matched_cand = (matched_cand is not None)

            if not is_in_chunks and not is_in_seed and not is_matched_cand:
                discarded_sources_count += 1
                continue

            # Tier check
            if tier not in verifiable_tiers:
                discarded_sources_count += 1
                continue

            outlet = getattr(matched_cand, "outlet", None) or (sources.outlet_name(domain) if hasattr(sources, "outlet_name") else None)
            title = str(s.get("title", "")).strip() or getattr(matched_cand, "title", domain)
            published = str(s.get("published", "")).strip() or getattr(matched_cand, "published", None)

            retained_sources_map[resolved_url] = {
                "url": resolved_url,
                "title": title,
                "domain": domain,
                "outlet": outlet,
                "tier": tier,
                "published": published,
            }
            valid_src_urls_for_finding.append(resolved_url)

        # Discard finding if no retained sources
        if not valid_src_urls_for_finding:
            continue

        retained_findings_temp.append({
            "raw": raw_f,
            "urls": valid_src_urls_for_finding,
        })

    # Build unique SourceRefs s1..sN
    url_to_source_ref: dict[str, SourceRef] = {}
    source_refs_list: list[SourceRef] = []
    for idx, (url, sdict) in enumerate(retained_sources_map.items(), start=1):
        s_id = f"s{idx}"
        s_ref = SourceRef(
            id=s_id,
            url=sdict["url"],
            title=sdict["title"],
            domain=sdict["domain"],
            outlet=sdict["outlet"],
            tier=sdict["tier"],
            published=sdict["published"],
        )
        url_to_source_ref[url] = s_ref
        source_refs_list.append(s_ref)

    # Filter and prioritize findings: favor municipal and state; admit at most 1 national
    local_findings_temp: list[dict[str, Any]] = []
    national_findings_temp: list[dict[str, Any]] = []

    unit_name_norm = snapshot.name.lower()
    ent_name_norm = (snapshot.ent_name or "").lower()

    for f_item in retained_findings_temp:
        raw_f = f_item["raw"]
        raw_scope = str(raw_f.get("scope") or "estado").lower()
        title_summary = (str(raw_f.get("title") or "") + " " + str(raw_f.get("summary") or "")).lower()

        # If mentions unit or entity, promote scope if marked national
        if raw_scope == "nacional" and (unit_name_norm in title_summary or (ent_name_norm and ent_name_norm in title_summary)):
            raw_scope = "municipio" if snapshot.level == "mun" and unit_name_norm in title_summary else "estado"
            raw_f["scope"] = raw_scope

        if raw_scope in ("municipio", "estado"):
            local_findings_temp.append(f_item)
        else:
            national_findings_temp.append(f_item)

    selected_findings_temp: list[dict[str, Any]] = []
    selected_findings_temp.extend(local_findings_temp[:5])
    if national_findings_temp and len(selected_findings_temp) < 6:
        selected_findings_temp.append(national_findings_temp[0])
    if len(selected_findings_temp) < 6 and len(local_findings_temp) > 5:
        selected_findings_temp.append(local_findings_temp[5])
    if not selected_findings_temp and national_findings_temp:
        selected_findings_temp.append(national_findings_temp[0])

    # Build final Findings f1..fM (max 6)
    final_findings: list[Finding] = []
    for idx, f_item in enumerate(selected_findings_temp[:6], start=1):
        raw_f = f_item["raw"]
        f_id = f"f{idx}"
        f_title = str(raw_f.get("title", f"Hallazgo {idx}")).strip()
        f_summary = str(raw_f.get("summary", "")).strip()
        # Enforce summary length <= 60 words
        words = f_summary.split()
        if len(words) > 60:
            f_summary = " ".join(words[:60]) + "..."

        raw_cat = raw_f.get("category")
        category: FindingCategory = raw_cat if raw_cat in VALID_FINDING_CATEGORIES else "otra"

        raw_scope = raw_f.get("scope")
        scope: Any = raw_scope if raw_scope in ["municipio", "estado", "nacional"] else "estado"

        raw_conf = raw_f.get("confidence")
        confidence: Confidence = raw_conf if raw_conf in ["alta", "media", "baja"] else "media"

        evidence_ids = [url_to_source_ref[u].id for u in f_item["urls"] if u in url_to_source_ref]

        final_findings.append(Finding(
            id=f_id,
            title=f_title,
            summary=f_summary,
            category=category,
            evidence=evidence_ids,
            scope=scope,
            confidence=confidence,
        ))

    queries = getattr(grounded_res, "queries", [])
    model_name = getattr(grounded_res, "model", "gemini-3.8-flash")
    from_cache = getattr(grounded_res, "from_cache", False)
    res_mode = getattr(grounded_res, "mode", "grounding")
    search_mode = "respaldo" if res_mode == "rss_url_context" else ("grounding" if res_mode == "grounding" else "sin_internet")

    note: str | None = None
    if res_mode == "rss_url_context":
        note = "Búsqueda de respaldo: noticias indexadas (Google News/Bing) leídas por Gemini; sin búsqueda web completa."

    return ResearchBundle(
        unit_id=snapshot.unit_id,
        unit_name=snapshot.name,
        level=snapshot.level,
        findings=final_findings,
        sources=source_refs_list,
        discarded_sources=discarded_sources_count,
        queries=queries,
        generated_at=now_iso,
        model=model_name,
        from_cache=from_cache,
        search_mode=search_mode,
        degraded=False,
        note=note,
    )


# ---------------------------------------------------------------- 3. plan_campaign models & draft schema


class _ProposalDraft(BaseModel):
    title: str = ""
    description: str = ""
    lever: Lever = "campana_general"
    channels: list[str] = []
    target_group: str = ""
    addresses: list[str] = []
    effect_pp: float = 2.0
    coverage: float = 80.0
    targeting: Targeting = "todos"
    rationale: str = ""


class _StepDraft(BaseModel):
    order: int = 1
    phase: str = ""
    start: str = ""
    end: str = ""
    actions: list[str] = []
    responsible: str = ""
    kpi: str = ""


class _TargetGroupDraft(BaseModel):
    name: str = ""
    description: str = ""


class _RiskDraft(BaseModel):
    risk: str = ""
    mitigation: str = ""


class _PlanDraft(BaseModel):
    objective: str = ""
    target_groups: list[_TargetGroupDraft] = []
    proposals: list[_ProposalDraft] = []
    steps: list[_StepDraft] = []
    risks: list[_RiskDraft] = []
    kpis: list[str] = []


def _generate_deterministic_plan_draft(
    snapshot: DataSnapshot,
    research: ResearchBundle,
    focus: str | None,
) -> _PlanDraft:
    """Builds a complete, deterministic campaign plan draft when LLM is unavailable."""
    cat = snapshot.category
    name = snapshot.name

    if cat == "rojo":
        objective = f"Reducir la abstención electoral crítica en {name} mediante intervenciones territoriales directas, ampliación de infraestructura de casillas y brigadas juveniles focalizadas."
    elif cat == "naranja":
        objective = f"Mitigar los riesgos de abstención moderada-alta en {name} facilitando el acceso a casillas y reforzando la confianza cívica institucional."
    elif cat == "amarillo":
        objective = f"Consolidar la participación electoral en {name} atendiendo rezagos en sectores prioritarios mediante campañas cívicas multicanal."
    else:
        objective = f"Mantener y expandir la participación ciudadana en {name} promoviendo una cultura cívica activa e incluyente para el proceso electoral 2027."

    # Target groups
    tg_list = [
        _TargetGroupDraft(
            name="Jóvenes de 18 a 24 años",
            description="Electores jóvenes en edad universitaria y primer voto con menor participación relativa histórica.",
        ),
        _TargetGroupDraft(
            name="Población rural y localidades distantes",
            description="Ciudadanía que habita en comunidades rurales con mayor distancia física a centros tradicionales de votación.",
        ),
        _TargetGroupDraft(
            name="Ciudadanía en general de la demarcación",
            description="Electorado registrado en la Lista Nominal sujeto a campañas cívicas institucionales de promoción del voto.",
        ),
    ]

    # Proposals from recommendations / drivers
    # Map to available levers
    selected_proposals: list[_ProposalDraft] = []
    used_levers: set[Lever] = set()

    finding_ids = [f.id for f in research.findings[:2]]

    # 1. Youth lever
    if "promocion_jovenes" not in used_levers:
        selected_proposals.append(_ProposalDraft(
            title="Brigadas juveniles y activación cívica universitaria",
            description="Despliegue de módulos interactivos de educación cívica y credencialización en universidades e institutos tecnológicos.",
            lever="promocion_jovenes",
            channels=["módulos universitarios", "redes institucionales", "embajadores cívicos"],
            target_group="Jóvenes de 18 a 24 años",
            addresses=finding_ids,
            effect_pp=2.5,
            coverage=80.0,
            targeting="todos" if snapshot.level == "mun" else "rojo_naranja",
            rationale="Focalización en el segmento con mayor abstención relativa y potencial de movilización.",
        ))
        used_levers.add("promocion_jovenes")

    # 2. Rural or language lever
    if (snapshot.pct_hli or 0) > 10.0 and "materiales_lengua_indigena" not in used_levers:
        selected_proposals.append(_ProposalDraft(
            title="Capacitación y difusión cívica en lenguas originarias",
            description="Traducción de materiales electorales y campañas en radios comunitarias en lenguas indígenas de la región.",
            lever="materiales_lengua_indigena",
            channels=["radios comunitarias", "asambleas ejidales", "perifoneo bilingüe"],
            target_group="Población de comunidades rurales",
            addresses=finding_ids,
            effect_pp=2.0,
            coverage=75.0,
            targeting="todos" if snapshot.level == "mun" else "rojo_naranja",
            rationale="Eliminación de barreras lingüísticas para asegurar inclusión y certeza en el sufragio.",
        ))
        used_levers.add("materiales_lengua_indigena")
    elif "casillas_rurales" not in used_levers:
        selected_proposals.append(_ProposalDraft(
            title="Rutas de transporte cívico y casillas extraordinarias rurales",
            description="Instalación de casillas extraordinarias y esquemas de apoyo al traslado en secciones rurales dispersas.",
            lever="casillas_rurales",
            channels=["módulos itinerantes", "perifoneo comunitario", "autoridades comunales"],
            target_group="Población rural y localidades distantes",
            addresses=finding_ids,
            effect_pp=2.0,
            coverage=70.0,
            targeting="todos" if snapshot.level == "mun" else "rojo_naranja",
            rationale="Reducción de la distancia física a centros de votación en zonas de baja densidad.",
        ))
        used_levers.add("casillas_rurales")

    # 3. General campaign
    if len(selected_proposals) < 3 and "campana_general" not in used_levers:
        selected_proposals.append(_ProposalDraft(
            title="Campaña integral de confianza cívica y localización de casilla",
            description="Campaña masiva institucional informando sobre la ubicación de casillas y los mecanismos de certeza del voto.",
            lever="campana_general",
            channels=["medios locales", "módulos de atención ciudadana", "ferias cívicas"],
            target_group="Ciudadanía en general de la demarcación",
            addresses=finding_ids,
            effect_pp=1.5,
            coverage=85.0,
            targeting="todos",
            rationale="Campaña amplia de certeza para abatir la desinformación y reforzar la participación informada.",
        ))
        used_levers.add("campana_general")

    # Implementation steps
    today = date.today()
    steps_list = [
        _StepDraft(
            order=1,
            phase="Diagnóstico y mesas de coordinación operativa",
            start=today.isoformat(),
            end=(today + timedelta(days=45)).isoformat(),
            actions=["Instalación de mesa de trabajo", "Georreferenciación de secciones de baja participación"],
            responsible="Junta Local Ejecutiva" if snapshot.level == "state" else "Junta Distrital Ejecutiva",
            kpi="100% de secciones prioritarias mapeadas y mesas instaladas.",
        ),
        _StepDraft(
            order=2,
            phase="Producción y adecuación de materiales cívicos",
            start=(today + timedelta(days=50)).isoformat(),
            end=(today + timedelta(days=110)).isoformat(),
            actions=["Diseño de folletería adaptada", "Validación con autoridades y aliados locales"],
            responsible="Vocalía de Capacitación Electoral y Educación Cívica",
            kpi="Materiales distribuidos en todas las sedes operativas.",
        ),
        _StepDraft(
            order=3,
            phase="Despliegue territorial e intervención comunitaria",
            start=(today + timedelta(days=115)).isoformat(),
            end=(today + timedelta(days=210)).isoformat(),
            actions=["Visitas a planteles", "Brigadas en comunidades rurales y difusión local"],
            responsible="Coordinación Nacional de Comunicación Social",
            kpi="Cobertura verificada en al menos 80% de los planteles y comunidades objetivo.",
        ),
        _StepDraft(
            order=4,
            phase="Monitoreo previo a la veda y verificación logística",
            start=(today + timedelta(days=215)).isoformat(),
            end="2027-05-31",
            actions=["Verificación final de rutas de acceso a casillas", "Cierre de actividades antes de veda"],
            responsible="Dirección Ejecutiva de Capacitación Electoral y Educación Cívica (DECEyEC)",
            kpi="Reporte de cobertura al 100% de metas operativas.",
        ),
    ]

    risks_list = [
        _RiskDraft(
            risk="Apatía y desinterés en el electorado juvenil.",
            mitigation="Uso de formatos digitales ágiles, talleres vivenciales y participación de embajadores cívicos pares.",
        ),
        _RiskDraft(
            risk="Dificultad de acceso por factores climáticos o geográficos en zonas rurales.",
            mitigation="Planeación anticipada de rutas alternas y coordinación con autoridades locales para garantizar libre tránsito.",
        ),
    ]

    kpis_list = [
        "Aumento estimado de al menos 1.5 puntos porcentuales en la participación electoral de la unidad.",
        "Cobertura superior al 80% de la Lista Nominal en el ámbito territorial.",
        "100% de actividades de promoción concluidas antes del inicio de la veda electoral del 3 de junio de 2027.",
    ]

    return _PlanDraft(
        objective=objective,
        target_groups=tg_list,
        proposals=selected_proposals,
        steps=steps_list,
        risks=risks_list,
        kpis=kpis_list,
    )


# ---------------------------------------------------------------- 4. compute_impact


def compute_impact(
    snapshot: DataSnapshot,
    proposals: list[Proposal],
) -> ImpactAnalysis:
    """Computes deterministic participation impact using model.scenarios.simulate.

    - Simulates all proposals combined with diminishing returns.
    - Simulates each proposal in isolation for 'votos_solo'.
    - For municipalities: uses the municipality's row directly.
    - For states: aggregates municipal rows weighted by LN.
    - If proposals count is 1: overlap_votos is strictly 0.
    """
    units_df = deps.get_units_df()

    # Build campaigns parameter for simulation
    campaigns: list[dict[str, Any]] = []
    for p in proposals:
        # Enforce targeting: for municipalities always 'todos' per §6.3
        targeting = "todos" if snapshot.level == "mun" else p.targeting
        campaigns.append({
            "lever": p.lever,
            "targeting": targeting,
            "effect_pp": float(p.effect_pp),
            "coverage": float(p.coverage),
            "ents": [snapshot.ent],
        })

    # Run combined simulation
    sim_mun_items, _ = scenarios.simulate(
        units_df,
        scenario="intervencion",
        params={"campaigns": campaigns},
        level="mun",
    )

    CAT_RANK: dict[str, int] = {"rojo": 0, "naranja": 1, "amarillo": 2, "verde": 3}

    if snapshot.level == "mun":
        # Municipal scope
        mun_match = sim_mun_items[sim_mun_items["id"].astype(str) == snapshot.unit_id]
        if mun_match.empty:
            mun_match = sim_mun_items[sim_mun_items["id"].astype(str).str.zfill(5) == snapshot.unit_id.zfill(5)]

        if not mun_match.empty:
            m_row = mun_match.iloc[0]
            abst_scen = float(m_row["pred_abstention"]) if pd.notna(m_row.get("pred_abstention")) else snapshot.pred_abstention
            category_after = str(m_row.get("category", snapshot.category))
        else:
            abst_scen = snapshot.pred_abstention
            category_after = snapshot.category

        abst_base = snapshot.pred_abstention or 0.0
        delta_pp = round((abst_scen - abst_base) * 100.0, 2)
        votos_adicionales = max(0, int(round((abst_base - abst_scen) * snapshot.lista_nominal)))
        category_before = snapshot.category
        municipios_mejoran = None

    else:
        # State scope: aggregate municipal rows for snapshot.ent
        st_mun_sim = sim_mun_items[sim_mun_items["ent"].astype(str).str.zfill(2) == snapshot.ent]
        base_muns = units_df[(units_df.get("level") == "mun") & (units_df.get("cve_ent", "").astype(str).str.zfill(2) == snapshot.ent)]

        # Run state level simulation for state category_after
        sim_state_items, _ = scenarios.simulate(
            units_df,
            scenario="intervencion",
            params={"campaigns": campaigns},
            level="state",
            ent=snapshot.ent,
        )

        st_match = sim_state_items[sim_state_items["id"].astype(str).str.zfill(2) == snapshot.ent]
        if not st_match.empty:
            category_after = str(st_match.iloc[0].get("category", snapshot.category))
        else:
            category_after = snapshot.category

        category_before = snapshot.category

        # Weighted calculation
        if not st_mun_sim.empty and not base_muns.empty:
            merged = pd.merge(
                base_muns[["id", "lista_nominal", "pred_abstention", "category"]],
                st_mun_sim[["id", "pred_abstention", "category"]],
                on="id",
                suffixes=("_base", "_scen"),
            )
            ln = merged["lista_nominal"].fillna(0.0)
            sum_ln = float(ln.sum())
            if sum_ln > 0:
                weights = ln / sum_ln
                b_abs = float((merged["pred_abstention_base"].fillna(0.0) * weights).sum())
                s_abs = float((merged["pred_abstention_scen"].fillna(0.0) * weights).sum())
                abst_base = round(b_abs, 4)
                abst_scen = round(s_abs, 4)
                delta_pp = round((abst_scen - abst_base) * 100.0, 2)
                votos_adicionales = max(0, int(round((abst_base - abst_scen) * sum_ln)))
            else:
                abst_base = snapshot.pred_abstention
                abst_scen = snapshot.pred_abstention
                delta_pp = 0.0
                votos_adicionales = 0

            # Count municipalities that improved
            improved_count = 0
            for _, r in merged.iterrows():
                c_base = str(r["category_base"])
                c_scen = str(r["category_scen"])
                if CAT_RANK.get(c_scen, -1) > CAT_RANK.get(c_base, -1):
                    improved_count += 1
            municipios_mejoran = improved_count
        else:
            abst_base = snapshot.pred_abstention
            abst_scen = snapshot.pred_abstention
            delta_pp = 0.0
            votos_adicionales = 0
            municipios_mejoran = 0

    # Simulate each proposal in isolation for per_proposal & overlap_votos
    per_proposal_impacts: list[ProposalImpact] = []
    for p in proposals:
        single_camp = [{
            "lever": p.lever,
            "targeting": "todos" if snapshot.level == "mun" else p.targeting,
            "effect_pp": float(p.effect_pp),
            "coverage": float(p.coverage),
            "ents": [snapshot.ent],
        }]
        solo_mun_sim, _ = scenarios.simulate(
            units_df,
            scenario="intervencion",
            params={"campaigns": single_camp},
            level="mun",
        )

        if snapshot.level == "mun":
            solo_match = solo_mun_sim[solo_mun_sim["id"].astype(str) == snapshot.unit_id]
            if solo_match.empty:
                solo_match = solo_mun_sim[solo_mun_sim["id"].astype(str).str.zfill(5) == snapshot.unit_id.zfill(5)]
            if not solo_match.empty:
                solo_abs = float(solo_match.iloc[0]["pred_abstention"])
                v_solo = max(0, int(round(((snapshot.pred_abstention or 0.0) - solo_abs) * snapshot.lista_nominal)))
            else:
                v_solo = 0
        else:
            st_solo_muns = solo_mun_sim[solo_mun_sim["ent"].astype(str).str.zfill(2) == snapshot.ent]
            if not st_solo_muns.empty and not base_muns.empty:
                m_solo = pd.merge(
                    base_muns[["id", "lista_nominal", "pred_abstention"]],
                    st_solo_muns[["id", "pred_abstention"]],
                    on="id",
                    suffixes=("_base", "_solo"),
                )
                ln = m_solo["lista_nominal"].fillna(0.0)
                sum_ln = float(ln.sum())
                if sum_ln > 0:
                    weights = ln / sum_ln
                    b_abs = float((m_solo["pred_abstention_base"].fillna(0.0) * weights).sum())
                    s_abs = float((m_solo["pred_abstention_solo"].fillna(0.0) * weights).sum())
                    v_solo = max(0, int(round((b_abs - s_abs) * sum_ln)))
                else:
                    v_solo = 0
            else:
                v_solo = 0

        per_proposal_impacts.append(ProposalImpact(
            proposal_id=p.id,
            lever=p.lever,
            votos_solo=v_solo,
        ))

    # Overlap votos: sum(votos_solo) - votos_adicionales (0 if single proposal)
    if len(proposals) <= 1:
        overlap_votos = 0
    else:
        overlap_votos = max(0, sum(pi.votos_solo for pi in per_proposal_impacts) - votos_adicionales)

    assumptions = [
        "Impacto estimado mediante el simulador determinista de Atalaya Electoral (modelo XGBoost calibrado).",
        "Rendimientos decrecientes en la combinación de múltiples campañas simultáneas.",
        "Cálculo de votos potenciales aplicado a la Lista Nominal de electores vigente.",
        "Escenario hipotético de movilización cívica, no efecto causal definitivo.",
    ]
    if snapshot.level == "mun":
        assumptions.append("Focalización territorial municipal fijada en cobertura total ('todos') para garantizar impacto directo en la demarcación.")

    return ImpactAnalysis(
        campaigns=campaigns,
        abstention_base=abst_base,
        abstention_scenario=abst_scen,
        delta_pp=delta_pp,
        votos_adicionales=votos_adicionales,
        category_before=category_before,
        category_after=category_after,
        municipios_mejoran=municipios_mejoran,
        per_proposal=per_proposal_impacts,
        overlap_votos=overlap_votos,
        assumptions=assumptions,
    )


# ---------------------------------------------------------------- 5. plan_campaign orchestrator


def plan_campaign(
    req: CampaignRequest,
    report: Callable[[str, int], None] = lambda s, p: None,
) -> CampaignPlan:
    """Orchestrates the complete campaign planning pipeline:

    1. DataSnapshot collection (5%)
    2. Gemini Grounded Research (15-55%)
    3. GLM-5.3 Plan generation (60-85%)
    4. Deterministic scenario impact calculation (90%)
    5. Slide deck assembly (95%)
    6. Persistence and return (100%)
    """
    now_dt = datetime.now(timezone.utc)
    now_iso = now_dt.isoformat()
    today_str = date.today().isoformat()

    # Step 1: Snapshot
    report("Leyendo datos de Atalaya", 5)
    snapshot = build_snapshot(req.unit_id)

    # Step 2: Research
    report("Investigando con Gemini en fuentes verificadas", 15)
    research = research_unit(snapshot, req.focus, refresh=req.refresh)
    report("Investigando con Gemini en fuentes verificadas", 55)

    # Step 3: GLM-5.3 Plan drafting
    report("Planeando la campaña con GLM-5.3", 60)

    try:
        from atalaya import llm
    except Exception:
        llm = None

    plan_draft: _PlanDraft | None = None
    llm_info = LLMInfo(model="", effort="", degraded=True)

    if llm is not None:
        try:
            if getattr(llm, "is_enabled", lambda: True)():
                planner_messages = build_planner_prompt(snapshot, research, req.focus)
                desc = llm.describe() if hasattr(llm, "describe") else {}
                model_name = desc.get("model", "glm-5.3")
                effort = desc.get("reasoning_effort", "high")

                draft_obj = llm.chat_json(
                    planner_messages,
                    schema=_PlanDraft,
                    reasoning_effort="high",
                    max_tokens=3000,
                    timeout_s=120.0,
                )
                if isinstance(draft_obj, _PlanDraft):
                    plan_draft = draft_obj
                    llm_info = LLMInfo(model=model_name, effort=effort, degraded=False)
        except Exception as exc:
            logger.warning("GLM chat_json plan generation failed: %s; using deterministic fallback", exc)
            plan_draft = None

    if plan_draft is None:
        # Deterministic plan fallback
        plan_draft = _generate_deterministic_plan_draft(snapshot, research, req.focus)
        desc = llm.describe() if (llm is not None and hasattr(llm, "describe")) else {}
        llm_info = LLMInfo(
            model=desc.get("model", ""),
            effort=desc.get("reasoning_effort", ""),
            degraded=True,
        )

    # Post-process & validate proposals (§6.3)
    # Deduplicate levers: if repeated, keep the one with larger effect_pp
    lever_proposals: dict[Lever, _ProposalDraft] = {}
    for p in plan_draft.proposals:
        lever = p.lever if p.lever in VALID_LEVERS else "campana_general"
        p.lever = lever
        if lever not in lever_proposals or p.effect_pp > lever_proposals[lever].effect_pp:
            lever_proposals[lever] = p

    # Ensure at least 2 proposals
    if len(lever_proposals) < 2:
        for fallback_lev in VALID_LEVERS:
            if fallback_lev not in lever_proposals:
                lever_proposals[fallback_lev] = _ProposalDraft(
                    title=f"Acciones de {fallback_lev.replace('_', ' ')}",
                    description="Acciones focalizadas de promoción institucional y certeza electoral.",
                    lever=fallback_lev,
                    channels=["módulos de atención", "medios locales"],
                    target_group="Ciudadanía en general",
                    effect_pp=2.0,
                    coverage=80.0,
                )
            if len(lever_proposals) >= 2:
                break

    # Build validated proposals list (2 to 4)
    valid_finding_ids = {f.id for f in research.findings}
    final_proposals: list[Proposal] = []
    for idx, (lev, pdraft) in enumerate(list(lever_proposals.items())[:4], start=1):
        eff = max(0.5, min(4.0, float(pdraft.effect_pp)))
        cov = max(30.0, min(100.0, float(pdraft.coverage)))
        # Targetings: for municipalities must be "todos"
        targ: Targeting = "todos" if snapshot.level == "mun" else (
            pdraft.targeting if pdraft.targeting in ["rojo", "rojo_naranja", "todos"] else "todos"
        )
        filtered_addresses = [fid for fid in pdraft.addresses if fid in valid_finding_ids]

        final_proposals.append(Proposal(
            id=f"p{idx}",
            title=pdraft.title or f"Propuesta {idx}",
            description=pdraft.description[:180] if pdraft.description else "Acción institucional de participación.",
            lever=lev,
            channels=pdraft.channels or ["módulos de atención"],
            target_group=pdraft.target_group or "Ciudadanía general",
            addresses=filtered_addresses,
            effect_pp=eff,
            coverage=cov,
            targeting=targ,
            rationale=pdraft.rationale or "Intervención cívica orientada a reducir la abstención.",
        ))

    # Population census estimates for target groups
    # Look up pob_18ymas from units_df
    units_df = deps.get_units_df()
    id_col = "id" if "id" in units_df.columns else "cvegeo"
    m_unit = units_df[units_df[id_col].astype(str) == snapshot.unit_id]
    pob_18ymas: float | None = None
    if not m_unit.empty and "pob_18ymas" in m_unit.columns and pd.notna(m_unit.iloc[0]["pob_18ymas"]):
        pob_18ymas = float(m_unit.iloc[0]["pob_18ymas"])
    elif snapshot.lista_nominal > 0:
        pob_18ymas = float(snapshot.lista_nominal)

    final_target_groups: list[TargetGroup] = []
    raw_tgs = plan_draft.target_groups if plan_draft.target_groups else [
        _TargetGroupDraft(name="Ciudadanía en general", description="Electorado de la demarcación"),
    ]

    for tg in raw_tgs[:3]:
        name_lower = tg.name.lower()
        desc_lower = tg.description.lower()
        full_text = f"{name_lower} {desc_lower}"

        size_est: int | None = None
        size_basis: str = ""

        if pob_18ymas and any(kw in full_text for kw in ["joven", "juventud", "18-24", "18 a 24", "universitari"]):
            pct = snapshot.pct_18_24 or 18.0
            size_est = int(round((pct / 100.0) * pob_18ymas))
            size_basis = f"Estimación con Censo 2020: {pct:.1f}% de jóvenes (18-24 años) sobre población adulta ({int(pob_18ymas):,} hab.)."
        elif pob_18ymas and any(kw in full_text for kw in ["rural", "comunidades rurales", "campo", "dispers"]):
            pct = snapshot.pct_rural or 0.0
            size_est = int(round((pct / 100.0) * pob_18ymas))
            size_basis = f"Estimación con Censo 2020: {pct:.1f}% de población rural sobre población adulta ({int(pob_18ymas):,} hab.)."
        elif pob_18ymas and any(kw in full_text for kw in ["indígena", "indigena", "lengua", "originari", "hli"]):
            pct = snapshot.pct_hli or 0.0
            size_est = int(round((pct / 100.0) * pob_18ymas))
            size_basis = f"Estimación con Censo 2020: {pct:.1f}% de hablantes de lengua indígena sobre población adulta ({int(pob_18ymas):,} hab.)."
        else:
            size_est = None
            size_basis = "Grupo objetivo cualitativo; no derivado directamente de variables censales agregadas."

        final_target_groups.append(TargetGroup(
            name=tg.name or "Grupo objetivo",
            description=tg.description or "Población objetivo de la estrategia cívica.",
            size_estimate=size_est,
            size_basis=size_basis,
        ))

    # Implementation steps normalization
    raw_steps = plan_draft.steps if plan_draft.steps else []
    if len(raw_steps) < 4:
        # Fallback to deterministic steps if too few
        raw_steps = _generate_deterministic_plan_draft(snapshot, research, req.focus).steps

    normalized_steps: list[ImplementationStep] = []
    for s in raw_steps[:6]:
        s_start = s.start if (s.start and s.start >= today_str) else today_str
        s_end = s.end if (s.end and s.end <= "2027-05-31") else "2027-05-31"
        if s_end < s_start:
            s_end = s_start

        resp = s.responsible if s.responsible else "Vocalía de Capacitación Electoral y Educación Cívica"
        kpi_text = s.kpi if s.kpi else "Actividad ejecutada en tiempo y forma."

        normalized_steps.append(ImplementationStep(
            order=s.order,
            phase=s.phase or f"Etapa {s.order}",
            start=s_start,
            end=s_end,
            actions=s.actions or ["Ejecución de actividades cívicas."],
            responsible=resp,
            kpi=kpi_text,
        ))

    # Sort steps by start date and fix order 1..N
    normalized_steps.sort(key=lambda st: st.start)
    for idx, st in enumerate(normalized_steps, start=1):
        st.order = idx

    # Risks normalization (2 to 4)
    raw_risks = plan_draft.risks if plan_draft.risks else []
    if len(raw_risks) < 2:
        raw_risks = _generate_deterministic_plan_draft(snapshot, research, req.focus).risks

    final_risks = [
        RiskItem(risk=r.risk or "Riesgo operativo", mitigation=r.mitigation or "Mitigación institucional")
        for r in raw_risks[:4]
    ]

    # KPIs normalization (3 to 5)
    final_kpis = [k for k in plan_draft.kpis if k][:5]
    if len(final_kpis) < 3:
        final_kpis = _generate_deterministic_plan_draft(snapshot, research, req.focus).kpis

    report("Planeando la campaña con GLM-5.3", 85)

    # Step 4: Compute Impact
    report("Calculando impacto con el simulador", 90)
    impact = compute_impact(snapshot, final_proposals)

    # Step 5: Deck & Slides
    report("Armando diapositivas", 95)
    plan_id = hashlib.sha1(f"{snapshot.unit_id}{req.focus or ''}{now_iso}".encode("utf-8")).hexdigest()[:12]

    plan = CampaignPlan(
        id=plan_id,
        unit=snapshot,
        research=research,
        focus=req.focus,
        objective=plan_draft.objective or f"Plan de campaña de participación ciudadana para {snapshot.name}.",
        target_groups=final_target_groups,
        proposals=final_proposals,
        impact=impact,
        steps=normalized_steps,
        risks=final_risks,
        kpis=final_kpis,
        slides=[],
        generated_at=now_iso,
        llm=llm_info,
    )

    try:
        from atalaya.intel import deck
        plan.slides = deck.build_slides(plan)
    except Exception as exc:
        logger.warning("Could not build slides via deck module: %s", exc)
        plan.slides = []

    # Save to storage
    try:
        from atalaya.intel import storage
        save_path = storage.campaign_result_path(snapshot.unit_id, req.focus)
        storage.write_json_atomic(save_path, plan.model_dump())
    except Exception as exc:
        logger.warning("Could not persist plan to storage: %s", exc)

    report("Listo", 100)
    return plan


# ---------------------------------------------------------------- 6. cached_plan & find_plan


def cached_plan(
    unit_id: str,
    focus: str | None = None,
    *,
    max_age_h: float | None = None,
) -> CampaignPlan | None:
    """Retrieves a cached CampaignPlan from storage if valid and within max_age_h."""
    uid_str = str(unit_id).strip()

    try:
        from atalaya.intel import storage
        path = storage.campaign_result_path(uid_str, focus)
    except Exception:
        cache_dir = Path("data/cache/intel/results/campaign")
        h = hashlib.sha1((focus or "").encode("utf-8")).hexdigest()[:8]
        path = cache_dir / f"{uid_str}__{h}.json"

    if not path.is_file():
        return None

    if max_age_h is not None:
        try:
            mtime = path.stat().st_mtime
            age_h = (time.time() - mtime) / 3600.0
            if age_h > max_age_h:
                return None
        except Exception:
            return None

    try:
        from atalaya.intel import storage
        raw_data = storage.read_json(path)
    except Exception:
        try:
            raw_data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    if not isinstance(raw_data, dict):
        return None

    try:
        return CampaignPlan.model_validate(raw_data)
    except Exception as exc:
        logger.warning("Corrupted campaign plan cache at %s: %s", path, exc)
        return None


def find_plan(plan_id: str) -> CampaignPlan | None:
    """Scans results/campaign/*.json to find a plan matching the given plan_id."""
    target_id = str(plan_id).strip()
    if not target_id:
        return None

    try:
        from atalaya.intel import storage
        camp_dir = storage.intel_dir() / "results" / "campaign"
    except Exception:
        camp_dir = Path("data/cache/intel/results/campaign")

    if not camp_dir.is_dir():
        return None

    for fpath in camp_dir.glob("*.json"):
        try:
            raw_data = json.loads(fpath.read_text(encoding="utf-8"))
            if raw_data.get("id") == target_id:
                return CampaignPlan.model_validate(raw_data)
        except Exception:
            continue

    return None
