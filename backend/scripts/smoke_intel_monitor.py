"""Smoke test for INE Monitor intelligence pipeline.

Can be run with or without real Gemini/LLM API credentials.
Usage:
    python -m atalaya.scripts.smoke_intel_monitor [--days 14] [--refresh]
or:
    python scripts/smoke_intel_monitor.py [--days 14] [--refresh]
"""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
import time
from typing import Any

# Ensure backend root is on sys.path
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from atalaya.intel.schemas import MonitorScanRequest
from atalaya.intel import monitor


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke test for INE Intelligence Monitor")
    parser.add_argument("--days", type=int, choices=[7, 14, 30], default=14, help="Window days to scan")
    parser.add_argument("--refresh", action="store_true", help="Force new scan bypassing cache")
    args = parser.parse_args()

    print("=" * 70)
    print("ATALAYA ELECTORAL · MONITOR INE (SMOKE TEST)")
    print(f"Ventana de análisis: {args.days} días | Forzar actualización: {args.refresh}")
    print("=" * 70)

    stage_timings: list[tuple[str, int, float]] = []
    start_all = time.perf_counter()

    def report_stage(stage_name: str, pct: int) -> None:
        now = time.perf_counter()
        elapsed = now - start_all
        stage_timings.append((stage_name, pct, elapsed))
        print(f"[{elapsed:6.2f}s] [{pct:3d}%] {stage_name}")

    try:
        req = MonitorScanRequest(window_days=args.days, refresh=args.refresh)
        snapshot = monitor.run_scan(req, report=report_stage)
    except Exception as exc:
        print(f"\n[ERROR] Falló la ejecución del escaneo: {exc}")
        sys.exit(1)

    total_time = time.perf_counter() - start_all
    print("\n" + "=" * 70)
    print(f"RESULTADO DEL ESCANEO (Tiempo total: {total_time:.2f} s)")
    print("=" * 70)

    print(f"Fecha generación:      {snapshot.generated_at}")
    print(f"Modo degradado:        {snapshot.degraded}")
    if snapshot.note:
        print(f"Nota institucional:    {snapshot.note}")
    print(f"Modelo utilizado:      {snapshot.model or 'N/A'}")
    print(f"Consultas ejecutadas:  {len(snapshot.queries)}")
    print(f"Fuentes escaneadas:    {snapshot.sources_scanned}")
    print(f"Total items hallados:  {len(snapshot.items)}")
    print(f"Conteos:               {snapshot.counts}")

    if not snapshot.items:
        print("\nNo se identificaron elementos adversos o el escaneo corrió en modo degradado sin llaves.")
        return

    # Aggregate summaries
    verdicts_count: dict[str, int] = {}
    platforms_seen: set[str] = set()
    tiers_count: dict[str, int] = {}

    for itm in snapshot.items:
        verdicts_count[itm.verdict] = verdicts_count.get(itm.verdict, 0) + 1
        for p in itm.posts if hasattr(itm, "posts") and itm.posts else (itm.virality.posts if itm.virality else []):
            platforms_seen.add(p.platform)
        for s in itm.sources:
            tiers_count[s.tier] = tiers_count.get(s.tier, 0) + 1

    print("\n" + "-" * 70)
    print(f"Veredictos:    {verdicts_count}")
    print(f"Plataformas:   {sorted(list(platforms_seen)) or 'Ninguna'}")
    print(f"Tiers fuentes: {tiers_count}")

    print("\n" + "-" * 70)
    print("DETALLE POR ELEMENTO:")
    print("-" * 70)

    for idx, itm in enumerate(snapshot.items, 1):
        print(f"\n[{idx}] {itm.headline.upper()}")
        print(f"    ID:         {itm.id} ({itm.kind})")
        print(f"    Afirmación: {itm.claim}")
        print(f"    Veredicto:  {itm.verdict} (confianza: {itm.verdict_confidence})")
        print(f"    Tema/Ámbito:{itm.topic} | Geo: {itm.geo.level} (ents={itm.geo.ents})")
        print(f"    Severidad:  {itm.severity.level} (score: {itm.severity.score})")
        print(f"    Acción:     {itm.remediation.action} (plazo: {itm.remediation.deadline_hours}h)")

        if itm.impact:
            print(f"    Impacto:    Δ nacional = +{itm.impact.delta_pp_national:.2f} pp | Votos = {itm.impact.votos_perdidos_total:,}")
            top_units = itm.impact.units[:3]
            top_str = ", ".join([f"{u.name} (+{u.delta_pp:.2f}pp)" for u in top_units])
            print(f"    Top estados: {top_str}")

        if itm.virality:
            print(f"    Viralidad:  Score {itm.virality.score}/100 ({itm.virality.level}) | Crecimiento: {itm.virality.growth}")

        if itm.remediation.draft_message:
            msg_snippet = itm.remediation.draft_message[:140].replace("\n", " ")
            print(f"    Mensaje:    \"{msg_snippet}...\"")

    # Sample URL verification
    print("\n" + "-" * 70)
    print("MUESTRA DE VERIFICACIÓN DE URLs:")
    sample_urls: list[str] = []
    for itm in snapshot.items:
        for s in itm.sources:
            if s.url not in sample_urls:
                sample_urls.append(s.url)
        for fc in itm.fact_checks:
            if fc.url not in sample_urls:
                sample_urls.append(fc.url)
        if len(sample_urls) >= 5:
            break

    try:
        from atalaya import gemini
        resolve_fn = getattr(gemini, "resolve_source_url", lambda u: u)
    except Exception:
        resolve_fn = lambda u: u

    for u in sample_urls[:5]:
        try:
            resolved = resolve_fn(u)
            print(f"  • {u} -> {resolved}")
        except Exception as exc:
            print(f"  • {u} -> Error ({exc})")

    print("\n" + "=" * 70)
    print("SMOKE TEST COMPLETADO EXITOSAMENTE")
    print("=" * 70)


if __name__ == "__main__":
    main()
