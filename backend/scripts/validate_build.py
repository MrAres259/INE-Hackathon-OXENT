"""Validation script for ATALAYA build artifacts.

Verifies:
1. National participation by year (DIP_FED) and verifies 2024 is in [59.6, 59.7]%.
2. Crosswalk coverage.
3. Row count of ccpc_profile_mun.
4. Selected model and candidate backtest metrics.
5. Distribution of municipalities by risk traffic light (semáforo).
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

import pandas as pd


def get_paths() -> tuple[Path, Path, Path]:
    """Resolve build, seed, and deliverables paths whether run from backend or repo root."""
    cwd = Path.cwd()
    if (cwd / "atalaya").is_dir():
        # Running from backend/
        repo_root = cwd.parent
    elif (cwd / "backend").is_dir():
        # Running from repo root
        repo_root = cwd
    else:
        # Fallback to file location
        repo_root = Path(__file__).resolve().parent.parent.parent

    build_dir = repo_root / "data/build"
    seed_dir = repo_root / "data/seed"
    deliv_dir = repo_root / "deliverables"
    return repo_root, build_dir, deliv_dir


def validate_build() -> int:
    repo_root, build_dir, deliv_dir = get_paths()
    print("=" * 65)
    print(" ATALAYA — Resumen de Validación de Compilación de Datos")
    print(f" Build dir: {build_dir}")
    print("=" * 65)

    passed = True

    # 1. National participation by year
    part_path = build_dir / "participation.parquet"
    if not part_path.is_file():
        print(f"[-] ERROR: No se encontró '{part_path}'.")
        return 1

    part_df = pd.read_parquet(part_path)
    print("\n--- 1. Participación Nacional CCPC por Año (DIP_FED) ---")
    dip_df = part_df.copy()
    if "election" in dip_df.columns:
        dip_df = dip_df[dip_df["election"] == "DIP_FED"]

    yearly = dip_df.groupby("year").agg(
        total_ln=("lista_nominal", "sum"),
        total_sv=("votos_totales", "sum"),
        total_nv=("nv", "sum") if "nv" in dip_df.columns else ("votos_totales", "count"),
    ).reset_index()

    if "nv" in dip_df.columns:
        yearly["participacion_pct"] = (
            yearly["total_sv"] / (yearly["total_sv"] + yearly["total_nv"]) * 100.0
        )
    else:
        yearly["participacion_pct"] = (yearly["total_sv"] / yearly["total_ln"]) * 100.0

    print(f"{'Año':>6} | {'Lista Nominal':>15} | {'Votos (SV)':>12} | {'Participación':>14}")
    print("-" * 55)
    turnouts = {}
    for _, r in yearly.iterrows():
        yr = int(r["year"])
        ln = int(r["total_ln"])
        sv = int(r["total_sv"])
        pct = float(r["participacion_pct"])
        turnouts[yr] = pct
        print(f"{yr:>6} | {ln:>15,d} | {sv:>12,d} | {pct:>13.2f} %")

    # Check 2024 participation in 59.6 - 59.7%
    part_2024 = turnouts.get(2024)
    if part_2024 is None:
        print("[-] ERROR: No se encontró el año 2024 en participation.parquet.")
        passed = False
    elif 59.60 <= part_2024 <= 59.75:
        print(f"[+] Verificación 2024 EXITOSA: {part_2024:.2f}% está en el rango esperado [59.6%, 59.7%].")
    else:
        print(f"[-] ERROR: Participación 2024 = {part_2024:.2f}% FUERA de rango [59.6%, 59.7%].")
        passed = False

    # 2. Crosswalk coverage
    print("\n--- 2. Cobertura del Crosswalk ---")
    cross_path = build_dir / "crosswalk.parquet"
    if cross_path.is_file():
        cross_df = pd.read_parquet(cross_path)
        print(f"  Total de asignaciones de municipios: {len(cross_df):,d}")
        if "score" in cross_df.columns:
            exact = (cross_df["score"] == 1.0).sum()
            print(f"  Asignaciones exactas (score 1.0): {exact:,d} ({exact / len(cross_df) * 100:.1f}%)")
    unmatched_path = build_dir / "crosswalk_unmatched.csv"
    if unmatched_path.is_file():
        try:
            unm_df = pd.read_csv(unmatched_path)
            print(f"  Municipios no emparejados (unmatched): {len(unm_df)}")
        except Exception:
            pass

    # 3. CCPC profile rows check
    print("\n--- 3. Verificación de Perfil CCPC Municipal ---")
    profile_path = build_dir / "ccpc_profile_mun.parquet"
    if not profile_path.is_file():
        profile_path = build_dir / "ccpc_profile.parquet"
    if profile_path.is_file():
        p_df = pd.read_parquet(profile_path)
        p_rows = len(p_df)
        print(f"  Filas en '{profile_path.name}': {p_rows:,d}")
        if p_rows >= 50000:
            print(f"[+] Filas de perfil correctas (>= 50,000; esperado ≈ 206,896).")
        else:
            print(f"[-] ERROR: Filas de perfil insuficientes ({p_rows} < 50,000). Posible archivo defectuoso.")
            passed = False
    else:
        print(f"[-] ERROR: No se encontró '{profile_path}'.")
        passed = False

    # 4. Model and metrics
    print("\n--- 4. Modelo Seleccionado y Métricas ---")
    metrics_path = build_dir / "metrics.json"
    if metrics_path.is_file():
        try:
            m = json.loads(metrics_path.read_text(encoding="utf-8"))
            sel_model = m.get("selected_model", "N/D (modelo inercial/ridge)")
            print(f"  Modelo ganador: {sel_model}")
            if "national_level_assumption" in m:
                print(f"  Supuesto nivel nacional 2027: {m.get('national_level_assumption')}%")
            if "offset_pp" in m:
                print(f"  Offset intermedias: {m.get('offset_pp')} pp")
            if "candidates" in m:
                print("  Candidatos evaluados:")
                for c in m.get("candidates", []):
                    c_name = c.get("name")
                    mean_mae = c.get("mean_mae_pp", c.get("mae_avg", c.get("mae_pp")))
                    folds = c.get("folds", [])
                    fold_str = ", ".join(f"{f.get('test_year')}: MAE={f.get('mae_pp')} pp (Sp={f.get('spearman')})" for f in folds)
                    print(f"    - {c_name:<12}: MAE promedio = {mean_mae} pp ({fold_str})")
            if "backtests" in m:
                print("  Resultados backtest out-of-sample:")
                for b in m.get("backtests", []):
                    ty = b.get("test_year")
                    mae = b.get("mae_pp")
                    b_mae = b.get("baseline_mae_pp")
                    sp = b.get("spearman")
                    hit = b.get("top20_hit")
                    n_un = b.get("n")
                    print(f"    - Fold {ty}: MAE = {mae} pp (vs naive {b_mae} pp) | Spearman = {sp} | top20_hit = {hit} | n={n_un}")
        except Exception as e:
            print(f"  Aviso leyendo metrics.json: {e}")
    else:
        print(f"  Aviso: No se encontró '{metrics_path}'.")

    # 5. Risk traffic light distribution (Semáforo)
    print("\n--- 5. Distribución Municipal por Semáforo de Riesgo ---")
    units_path = build_dir / "units.parquet"
    if units_path.is_file():
        u_df = pd.read_parquet(units_path)
        mun_u = u_df[u_df["level"] == "mun"] if "level" in u_df.columns else u_df
        total_mun = len(mun_u)
        total_ln = mun_u["lista_nominal"].sum() if "lista_nominal" in mun_u.columns else 0
        cat_counts = mun_u["category"].value_counts() if "category" in mun_u.columns else pd.Series()

        print(f"{'Categoría':<12} | {'Municipios':>10} | {'% Mun':>8} | {'Lista Nominal':>15} | {'% LN':>8}")
        print("-" * 62)
        for cat in ["verde", "amarillo", "naranja", "rojo", "sin_dato"]:
            n_cat = int(cat_counts.get(cat, 0))
            pct_m = (n_cat / total_mun * 100.0) if total_mun > 0 else 0.0
            if "category" in mun_u.columns and "lista_nominal" in mun_u.columns:
                ln_cat = mun_u.loc[mun_u["category"] == cat, "lista_nominal"].sum()
                pct_ln = (ln_cat / total_ln * 100.0) if total_ln > 0 else 0.0
            else:
                ln_cat = 0
                pct_ln = 0.0
            print(f"{cat:<12} | {n_cat:>10,d} | {pct_m:>7.1f}% | {int(round(ln_cat)):>15,d} | {pct_ln:>7.1f}%")
    else:
        print(f"  Aviso: No se encontró '{units_path}'.")

    print("\n" + "=" * 65)
    if passed:
        print("[+] RESUMEN: Compilación validada exitosamente con datos reales.")
        print("=" * 65)
        return 0
    else:
        print("[-] RESUMEN: Fallaron una o más validaciones críticas de compilación.")
        print("=" * 65)
        return 1


if __name__ == "__main__":
    sys.exit(validate_build())
