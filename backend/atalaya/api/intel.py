"""FastAPI router for Atalaya intelligence features (/api/intel)."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import FileResponse

from atalaya.api.security import (
    check_intel_rate_limit,
    get_operator_token,
    verify_operator,
)
from atalaya.config import get_settings
from atalaya.intel import storage
from atalaya.intel.schemas import (
    CampaignPlan,
    CampaignRequest,
    IntelStatus,
    Job,
    Level,
    MonitorScanRequest,
    MonitorSnapshot,
    NewsImpact,
    RegistryEntry,
    Slide,
    SlidesOverride,
)

router = APIRouter(prefix="/api/intel", tags=["intel"])


def _validate_unit_id(unit_id: str) -> None:
    """Validate that unit_id exists in the model units dataset if loaded."""
    try:
        from atalaya.api import deps
        df = deps.get_units_df()
        if df is not None and not df.empty and "unit_id" in df.columns:
            valid_ids = set(df["unit_id"].astype(str))
            if unit_id not in valid_ids:
                raise HTTPException(status_code=404, detail="Zona no encontrada.")
    except HTTPException:
        raise
    except Exception:
        pass


@router.get("/status", response_model=IntelStatus)
def get_intel_status() -> IntelStatus:
    """Return status of LLM, Gemini grounding, operator auth, and budget."""
    settings = get_settings()

    gemini_enabled = False
    budget_used = 0
    budget_limit = getattr(settings, "intel_gemini_daily_limit", int(os.getenv("INTEL_GEMINI_DAILY_LIMIT", "40")))
    gemini_model = getattr(settings, "gemini_model", os.getenv("GEMINI_MODEL", "gemini-3.8-flash"))

    search_mode = "sin_internet"
    gemini_last_model = None

    try:
        from atalaya import gemini
        if hasattr(gemini, "is_enabled"):
            gemini_enabled = bool(gemini.is_enabled())
        if hasattr(gemini, "budget_status"):
            bs = gemini.budget_status()
            budget_used = int(bs.get("used", 0))
            budget_limit = int(bs.get("limit", budget_limit))
            gemini_last_model = bs.get("last_model")
            if gemini_enabled:
                search_mode = "grounding" if bs.get("grounding_available", True) else "respaldo"
    except Exception:
        pass

    llm_enabled = bool(getattr(settings, "llm_enabled", True))
    llm_model = getattr(settings, "maas_model", "glm-5.2")
    llm_effort = getattr(settings, "maas_reasoning_effort", os.getenv("MAAS_REASONING_EFFORT", "high"))

    try:
        from atalaya import llm
        if hasattr(llm, "describe"):
            desc = llm.describe()
            if isinstance(desc, dict):
                llm_model = desc.get("model", llm_model)
                llm_effort = desc.get("reasoning_effort", llm_effort)
    except Exception:
        pass

    operator_configured = bool(get_operator_token())
    monitor_cooldown = getattr(
        settings,
        "intel_monitor_cooldown_min",
        int(os.getenv("INTEL_MONITOR_COOLDOWN_MIN", "15")),
    )

    return IntelStatus(
        gemini_enabled=gemini_enabled,
        gemini_model=gemini_model,
        search_mode=search_mode,
        gemini_last_model=gemini_last_model,
        llm_enabled=llm_enabled,
        llm_model=llm_model,
        llm_effort=llm_effort,
        operator_configured=operator_configured,
        budget_used=budget_used,
        budget_limit=budget_limit,
        monitor_cooldown_min=monitor_cooldown,
    )


@router.post("/operator/check", status_code=status.HTTP_204_NO_CONTENT)
def check_operator(request: Request) -> Response:
    """Verify that the supplied operator key in X-Operator-Token is valid."""
    check_intel_rate_limit(request)
    verify_operator(request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/campaign")
def request_campaign(
    req: CampaignRequest,
    request: Request,
    response: Response,
) -> Any:
    """Request campaign generation: returns 200 with cached plan if present, or 202 Job for operator."""
    _validate_unit_id(req.unit_id)

    from atalaya.intel import jobs
    import sys
    campaign = sys.modules.get("atalaya.intel.campaign")
    if campaign is None:
        try:
            import atalaya.intel.campaign as campaign
        except ImportError:
            campaign = None  # type: ignore

    settings = get_settings()

    if not req.refresh and campaign is not None:
        ttl_h = getattr(settings, "intel_campaign_ttl_h", float(os.getenv("INTEL_CAMPAIGN_TTL_H", "72")))
        cached = campaign.cached_plan(req.unit_id, focus=req.focus, max_age_h=ttl_h)
        if cached is not None:
            return {"status": "done", "plan": cached}

    # Require operator credentials and rate limit to launch background job
    check_intel_rate_limit(request)
    verify_operator(request)

    if campaign is None:
        raise HTTPException(status_code=503, detail="Módulo de planeación de campañas no disponible.")

    job = jobs.submit(
        "campaign",
        f"{req.unit_id}|{req.focus or ''}",
        lambda report: campaign.plan_campaign(req, report),
    )
    response.status_code = status.HTTP_202_ACCEPTED
    return job


@router.get("/campaign/{unit_id}", response_model=CampaignPlan)
def get_campaign(unit_id: str, focus: str | None = None) -> CampaignPlan:
    """Retrieve cached campaign plan for a unit, regardless of age (or 404)."""
    import sys
    campaign = sys.modules.get("atalaya.intel.campaign")
    if campaign is None:
        try:
            from atalaya.intel import campaign as _c
            campaign = _c
        except (ImportError, AttributeError):
            campaign = None

    plan = campaign.cached_plan(unit_id, focus=focus, max_age_h=None) if campaign else None

    if plan is None:
        raise HTTPException(status_code=404, detail="Plan de campaña no encontrado para esta zona.")
    return plan


@router.post("/campaign/export")
def export_campaign(body: SlidesOverride, request: Request) -> FileResponse:
    """Export campaign slides to PDF or PPTX with optional user edits applied."""
    check_intel_rate_limit(request)

    # Validate slide content edits
    if body.slides:
        for s in body.slides:
            if len(s.bullets) > 8:
                raise HTTPException(status_code=422, detail="Las diapositivas admiten un máximo de 8 viñetas.")
            for b in s.bullets:
                if len(b) > 300:
                    raise HTTPException(status_code=422, detail="Cada viñeta admite un máximo de 300 caracteres.")

    import sys
    campaign = sys.modules.get("atalaya.intel.campaign")
    deck = sys.modules.get("atalaya.intel.deck")
    if campaign is None or deck is None:
        try:
            from atalaya.intel import campaign as _c, deck as _d
            campaign = campaign or _c
            deck = deck or _d
        except ImportError:
            raise HTTPException(status_code=503, detail="Módulo de exportación no disponible.")

    plan = campaign.find_plan(body.plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan no encontrado.")

    # Apply overrides only to allowed fields: title, subtitle, bullets, notes
    applied_slides: list[Slide] = [s.model_copy() for s in plan.slides]
    if body.slides:
        slides_map = {s.id: s for s in applied_slides}
        for o_slide in body.slides:
            if o_slide.id in slides_map:
                target = slides_map[o_slide.id]
                target.title = o_slide.title
                target.subtitle = o_slide.subtitle
                target.bullets = list(o_slide.bullets)
                target.notes = o_slide.notes

    # Cache export by plan_id, format, and override payload
    override_dict = body.model_dump()
    override_json = json.dumps(override_dict, sort_keys=True)
    cache_hash = hashlib.sha1(f"{body.plan_id}_{body.format}_{override_json}".encode("utf-8")).hexdigest()

    export_path = storage.exports_dir() / f"export_{cache_hash}.{body.format}"
    filename = deck.export_filename(plan, body.format)

    if not export_path.is_file() or export_path.stat().st_size == 0:
        if body.format == "pdf":
            deck.export_pdf(plan, export_path, applied_slides)
        else:
            deck.export_pptx(plan, export_path, applied_slides)

    media_type = (
        "application/pdf"
        if body.format == "pdf"
        else "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    return FileResponse(
        path=export_path,
        media_type=media_type,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/jobs/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    """Check the status and progress of an asynchronous intelligence job."""
    from atalaya.intel import jobs

    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Tarea no encontrada.")
    return job


@router.get("/monitor", response_model=MonitorSnapshot)
def get_monitor() -> MonitorSnapshot:
    """Retrieve the latest monitor scan snapshot (public view without operator notes)."""
    import sys
    monitor = sys.modules.get("atalaya.intel.monitor")
    if monitor is None:
        try:
            from atalaya.intel import monitor as _m
            monitor = _m
        except (ImportError, AttributeError):
            monitor = None

    snapshot = monitor.latest_snapshot(public=True) if monitor else None

    if snapshot is None:
        raise HTTPException(status_code=404, detail="No se ha realizado ningún escaneo aún.")
    return snapshot


@router.post("/monitor/scan")
def scan_monitor(
    body: MonitorScanRequest,
    request: Request,
    response: Response,
) -> Any:
    """Trigger a news and rumors scan: returns cached snapshot or 202 Job."""
    check_intel_rate_limit(request)
    verify_operator(request)

    from atalaya.intel import jobs
    import sys
    monitor = sys.modules.get("atalaya.intel.monitor")
    if monitor is None:
        try:
            from atalaya.intel import monitor as _m
            monitor = _m
        except ImportError:
            raise HTTPException(status_code=503, detail="Módulo de monitoreo no disponible.")

    settings = get_settings()
    ttl_h = getattr(settings, "intel_monitor_ttl_h", float(os.getenv("INTEL_MONITOR_TTL_H", "6")))

    if not body.refresh:
        latest = monitor.latest_snapshot(public=False)
        if latest is not None:
            try:
                gen_dt = datetime.fromisoformat(latest.generated_at)
                age_h = (datetime.now(timezone.utc) - gen_dt).total_seconds() / 3600.0
                if age_h < ttl_h:
                    return {"status": "done", "snapshot": latest}
            except Exception:
                pass

    if body.refresh:
        cooldown_s = monitor.cooldown_remaining_s()
        if cooldown_s > 0:
            mins = max(1, math.ceil(cooldown_s / 60.0))
            raise HTTPException(
                status_code=429,
                detail=f"Espera {mins} min antes de forzar un nuevo escaneo.",
                headers={"Retry-After": str(cooldown_s)},
            )

    job = jobs.submit(
        "monitor",
        f"w{body.window_days}",
        lambda report: monitor.run_scan(body, report),
    )
    response.status_code = status.HTTP_202_ACCEPTED
    return job


@router.get("/monitor/items/{item_id}/impact", response_model=NewsImpact)
def get_item_impact(
    item_id: str,
    level: Level = "state",
    ent: str | None = None,
) -> NewsImpact:
    """Calculate territorial turnout impact of a news item on state or municipal level."""
    if level == "mun" and not ent:
        raise HTTPException(
            status_code=422,
            detail="El parámetro 'ent' es obligatorio cuando level='mun'.",
        )

    import sys
    monitor = sys.modules.get("atalaya.intel.monitor")
    if monitor is None:
        try:
            from atalaya.intel import monitor as _m
            monitor = _m
        except (ImportError, AttributeError):
            raise HTTPException(status_code=503, detail="Módulo de monitoreo no disponible.")

    try:
        return monitor.item_impact(item_id, level=level, ent=ent)
    except KeyError:
        raise HTTPException(status_code=404, detail="Elemento no encontrado en el monitor.")
    except Exception:
        raise HTTPException(status_code=503, detail="Módulo de monitoreo no disponible.")


@router.post("/registry", response_model=RegistryEntry)
def create_registry_entry(entry: RegistryEntry, request: Request) -> RegistryEntry:
    """Record an operator decision or acknowledgement for a news or campaign item."""
    check_intel_rate_limit(request)
    verify_operator(request)

    from atalaya.intel import registry

    return registry.append(entry)


@router.get("/registry/{item_id}", response_model=list[RegistryEntry])
def get_registry_history(item_id: str, request: Request) -> list[RegistryEntry]:
    """Retrieve full audit history (including private notes) for a given item."""
    check_intel_rate_limit(request)
    verify_operator(request)

    from atalaya.intel import registry

    return registry.history(item_id)
