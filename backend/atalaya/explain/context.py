"""Public verified context research and caching for zone explanations."""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from pathlib import Path
import time
from typing import Any, Callable

from atalaya.explain.schemas import (
    ContextFinding,
    ContextResult,
    ContextSource,
    Level,
    Verification,
)
from atalaya.intel.schemas import ResearchBundle

logger = logging.getLogger(__name__)

CATEGORY_LABELS: dict[str, str] = {
    "desconfianza_institucional": "Desconfianza en instituciones",
    "inseguridad_violencia": "Inseguridad y violencia",
    "acceso_casillas_distancia": "Distancia o acceso a la casilla",
    "desinformacion": "Desinformación",
    "apatia_desafeccion": "Desinterés o desencanto",
    "barreras_documentales_credencial": "Credencial y trámites",
    "migracion_movilidad": "Migración y cambio de domicilio",
    "exclusion_linguistica_cultural": "Barreras de lengua o cultura",
    "condiciones_socioeconomicas": "Condiciones económicas",
    "otra": "Otro motivo",
}

_VERIFICATION_RANK: dict[str, int] = {
    "cita_verificada": 0,
    "fuente_verificada": 1,
    "sin_verificar": 2,
}


def _context_file_path(unit_id: str) -> Path:
    from atalaya.intel import storage
    return storage.intel_dir() / "results" / "explain" / f"{unit_id}.json"


def to_context_result(bundle: ResearchBundle, *, level: str) -> ContextResult:
    """Convert an intel ResearchBundle into a user-facing ContextResult."""
    # Build source lookup by source ID
    sources_map: dict[str, ContextSource] = {}
    for s in getattr(bundle, "sources", []) or []:
        sid = getattr(s, "id", "")
        if sid:
            sources_map[sid] = ContextSource(
                url=getattr(s, "url", ""),
                title=getattr(s, "title", "") or "",
                domain=getattr(s, "domain", "") or "",
                outlet=getattr(s, "outlet", None),
                tier=str(getattr(s, "tier", "no_reconocido") or "no_reconocido"),
                published=getattr(s, "published", None),
            )

    findings: list[ContextFinding] = []
    for f in getattr(bundle, "findings", []) or []:
        fid = str(getattr(f, "id", "") or "")
        title = str(getattr(f, "title", "") or "")
        summary = str(getattr(f, "summary", "") or "")
        cat_key = str(getattr(f, "category", "otra") or "otra")
        cat_lbl = CATEGORY_LABELS.get(cat_key, "Otro motivo")

        raw_scope = getattr(f, "scope", "estado")
        scope = raw_scope if raw_scope in ("municipio", "estado", "nacional") else "estado"

        raw_verif = getattr(f, "verification", "sin_verificar") or "sin_verificar"
        verification: Verification = (
            raw_verif if raw_verif in ("cita_verificada", "fuente_verificada", "sin_verificar") else "sin_verificar"
        )
        quote = getattr(f, "quote", None)

        matched_sources: list[ContextSource] = []
        evidence_ids = getattr(f, "evidence", []) or []
        for eid in evidence_ids:
            if eid in sources_map:
                matched_sources.append(sources_map[eid])

        # If evidence was empty, fall back to any direct sources on the finding
        if not matched_sources and hasattr(f, "sources") and f.sources:
            for raw_src in f.sources:
                if isinstance(raw_src, ContextSource):
                    matched_sources.append(raw_src)
                elif isinstance(raw_src, dict):
                    matched_sources.append(ContextSource.model_validate(raw_src))
                elif hasattr(raw_src, "url"):
                    matched_sources.append(ContextSource(
                        url=getattr(raw_src, "url", ""),
                        title=getattr(raw_src, "title", "") or "",
                        domain=getattr(raw_src, "domain", "") or "",
                        outlet=getattr(raw_src, "outlet", None),
                        tier=str(getattr(raw_src, "tier", "no_reconocido") or "no_reconocido"),
                        published=getattr(raw_src, "published", None),
                    ))

        findings.append(ContextFinding(
            id=fid,
            title=title,
            summary=summary,
            category=cat_key,
            category_label=cat_lbl,
            scope=scope,
            verification=verification,
            quote=quote,
            sources=matched_sources,
        ))

    # Stable sort by verification tier: cita_verificada -> fuente_verificada -> sin_verificar
    findings.sort(key=lambda cf: _VERIFICATION_RANK.get(cf.verification, 3))

    degraded = bool(getattr(bundle, "degraded", False))
    unit_name = str(getattr(bundle, "unit_name", "") or "")
    if len(findings) == 0 and not degraded:
        note = (
            f"No encontramos noticias verificables recientes sobre la participación en {unit_name}. "
            "Eso no significa que no existan causas locales."
        )
    else:
        note = getattr(bundle, "note", None)

    raw_mode = getattr(bundle, "search_mode", "respaldo")
    search_mode = raw_mode if raw_mode in ("grounding", "respaldo", "sin_internet") else "respaldo"
    model = str(getattr(bundle, "model", "") or "")
    from_cache = bool(getattr(bundle, "from_cache", False))
    generated_at = str(getattr(bundle, "generated_at", "") or datetime.now(timezone.utc).isoformat())

    level_val: Level = "mun" if level == "mun" else "state"

    return ContextResult(
        unit_id=str(getattr(bundle, "unit_id", "")),
        name=unit_name,
        level=level_val,
        findings=findings,
        search_mode=search_mode,
        model=model,
        generated_at=generated_at,
        from_cache=from_cache,
        degraded=degraded,
        note=note,
    )


def get_cached_context(unit_id: str, *, max_age_h: float = 72) -> ContextResult | None:
    """Retrieve cached context result from disk if present and younger than max_age_h."""
    from atalaya.intel import storage

    path = _context_file_path(unit_id)
    if not path.is_file():
        return None

    now_ts = time.time()
    try:
        mtime = path.stat().st_mtime
        if (now_ts - mtime) > max_age_h * 3600:
            return None
    except Exception:
        return None

    data = storage.read_json(path)
    if not isinstance(data, dict):
        return None

    try:
        result = ContextResult.model_validate(data)
        if result.generated_at:
            try:
                gen_dt = datetime.fromisoformat(result.generated_at)
                if gen_dt.tzinfo is None:
                    gen_dt = gen_dt.replace(tzinfo=timezone.utc)
                age_s = (datetime.now(timezone.utc) - gen_dt).total_seconds()
                if age_s > max_age_h * 3600:
                    return None
            except Exception:
                return None
        return result.model_copy(update={"from_cache": True})
    except Exception:
        return None


def run_context_research(
    unit_id: str,
    report: Callable[[str, int], None],
    *,
    refresh: bool = False,
) -> ContextResult:
    """Execute public news context research for a geographic unit and cache the result."""
    report("Preparando datos de la zona", 10)
    from atalaya.intel import campaign, storage

    try:
        snapshot = campaign.build_snapshot(unit_id)
    except KeyError as exc:
        raise KeyError(f"No encontramos la zona con clave '{unit_id}'.") from exc
    except Exception as exc:
        raise RuntimeError(f"Error al recopilar datos de la zona: {exc}") from exc

    report("Buscando noticias y fuentes (puede tardar 1–3 min)", 30)
    bundle = campaign.research_unit(snapshot, None, refresh=refresh)

    report("Ordenando lo encontrado", 90)
    result = to_context_result(bundle, level=snapshot.level)

    # Save to disk cache atomically
    path = _context_file_path(unit_id)
    storage.write_json_atomic(path, result.model_dump())

    return result
