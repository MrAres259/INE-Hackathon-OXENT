"""Smoke test script for Campaign Planning pipeline.

Usage:
    python -m scripts.smoke_intel_campaign <unit_id> [--focus "..."] [--refresh]
or from backend:
    python scripts/smoke_intel_campaign.py <unit_id> [--focus "..."]
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

# Add backend directory to sys.path if not present
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from atalaya.intel.campaign import plan_campaign
from atalaya.intel.schemas import CampaignRequest


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test for Atalaya Electoral Campaign Planner")
    parser.add_argument("unit_id", help="Unit ID (e.g. '32' for Zacatecas, '08037' for Guachochi)")
    parser.add_argument("--focus", default=None, help="Optional focus hint (e.g. 'jóvenes universitarios')")
    parser.add_argument("--refresh", action="store_true", help="Bypass cache and force re-generation")
    args = parser.parse_args()

    print(f"\n{'='*70}")
    print(f"ATALAYA ELECTORAL · SMOKE TEST PLAN DE CAMPAÑA")
    print(f"Unidad: {args.unit_id} | Enfoque: {args.focus or '(ninguno)'} | Refresh: {args.refresh}")
    print(f"{'='*70}\n")

    stage_times: dict[str, float] = {}
    last_stage_time = time.time()
    t_start = time.time()

    def report_progress(stage: str, pct: int) -> None:
        nonlocal last_stage_time
        now = time.time()
        elapsed = now - last_stage_time
        last_stage_time = now
        stage_times[stage] = stage_times.get(stage, 0.0) + elapsed
        print(f"  [{pct:3d}%] {stage:<50} (+{elapsed:.2f}s)")

    req = CampaignRequest(
        unit_id=args.unit_id,
        focus=args.focus,
        refresh=args.refresh,
    )

    try:
        plan = plan_campaign(req, report=report_progress)
    except Exception as exc:
        print(f"\n[ERROR] plan_campaign falló con excepción: {exc}")
        import traceback
        traceback.print_exc()
        return 1

    total_time = time.time() - t_start

    print(f"\n{'-'*70}")
    print(f"RESULTADOS DEL PLAN (Tiempo total: {total_time:.2f}s):")
    print(f"{'-'*70}")
    print(f"  Plan ID:           {plan.id}")
    print(f"  Unidad:            {plan.unit.name} ({plan.unit.level.upper()}, ID: {plan.unit.unit_id})")
    print(f"  Entidad:           {plan.unit.ent_name} ({plan.unit.ent})")
    print(f"  Lista Nominal:     {plan.unit.lista_nominal:,}")
    print(f"  Abstención base:   {plan.unit.pred_abstention * 100:.1f}% (Categoría: {plan.unit.category})")
    print(f"  Objetivo del plan: {plan.objective}")

    print(f"\n  --- INVESTIGACIÓN DOCUMENTAL (Gemini) ---")
    print(f"  Degradado:         {plan.research.degraded} ({plan.research.note or 'OK'})")
    print(f"  Modelo usado:      {plan.research.model or '(ninguno)'}")
    print(f"  Desde caché:       {plan.research.from_cache}")
    print(f"  Hallazgos:         {len(plan.research.findings)}")
    print(f"  Fuentes retenidas: {len(plan.research.sources)}")
    print(f"  Fuentes descart.:  {plan.research.discarded_sources}")
    for f in plan.research.findings[:3]:
        print(f"    * [{f.id}] ({f.category}) {f.title} (evidencia: {', '.join(f.evidence)})")

    print(f"\n  --- PLANEACIÓN INSTITUCIONAL (GLM-5.3 / Fallback) ---")
    print(f"  Degradado:         {plan.llm.degraded}")
    print(f"  Modelo:            {plan.llm.model or '(template)'} (esfuerzo: {plan.llm.effort})")
    print(f"  Grupos objetivo:   {len(plan.target_groups)}")
    for tg in plan.target_groups:
        sz_str = f"{tg.size_estimate:,} hab." if tg.size_estimate else "cualitativo"
        print(f"    * {tg.name}: {sz_str} ({tg.size_basis})")

    print(f"\n  --- PROPUESTAS DE INTERVENCIÓN ({len(plan.proposals)}) ---")
    for p in plan.proposals:
        print(f"    * [{p.id}] Palanca: {p.lever:<28} Efecto: {p.effect_pp:.1f} pp | Cobertura: {p.coverage:.0f}% | Target: {p.targeting}")
        print(f"      Título: {p.title}")

    print(f"\n  --- IMPACTO ESTIMADO (Simulador Atalaya) ---")
    print(f"  Abstención sim.:   {plan.impact.abstention_scenario * 100:.2f}% (Delta: {plan.impact.delta_pp:+.2f} pp)")
    print(f"  Votos adicionales: {plan.impact.votos_adicionales:,}")
    print(f"  Categoría:         {plan.impact.category_before} -> {plan.impact.category_after}")
    if plan.impact.municipios_mejoran is not None:
        print(f"  Muns. que mejoran: {plan.impact.municipios_mejoran}")
    print(f"  Overlap votos:     {plan.impact.overlap_votos:,}")
    for pi in plan.impact.per_proposal:
        print(f"    - Solo {pi.proposal_id} ({pi.lever}): +{pi.votos_solo:,} votos")

    print(f"\n  --- DIAPOSITIVAS Y CRONOGRAMA ---")
    print(f"  Diapositivas:      {len(plan.slides)}")
    print(f"  Etapas cronograma: {len(plan.steps)} (del {plan.steps[0].start} al {plan.steps[-1].end})")
    print(f"  Riesgos:           {len(plan.risks)}")
    print(f"  KPIs:              {len(plan.kpis)}")

    if args.unit_id == "32":
        if len(plan.research.findings) >= 3 and len(plan.research.sources) >= 3:
            print(f"\n  [OK] Verificación Zacatecas: {len(plan.research.findings)} hallazgos y {len(plan.research.sources)} fuentes reales (cumple >= 3).")
        else:
            print(f"\n  [AVISO] Verificación Zacatecas: {len(plan.research.findings)} hallazgos y {len(plan.research.sources)} fuentes (esperado >= 3).")

    print(f"\n{'='*70}")
    print(f"PRUEBA DE HUMO CONCLUIDA EXITOSAMENTE")
    print(f"{'='*70}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
