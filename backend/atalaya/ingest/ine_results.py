"""Ingestion of INE election results into municipality-level participation dataset."""

from __future__ import annotations

import argparse
import csv
import logging
from pathlib import Path
import re
import sys
from typing import Sequence

import numpy as np
import pandas as pd

from atalaya.config import BUILD_DIR, RAW_DIR, SEED_DIR
from atalaya.ingest.common import (
    norm_col,
    norm_name,
    pick_col,
    read_table,
    to_num,
    write_parquet,
    zpad,
)

logger = logging.getLogger(__name__)

# Column aliases according to specification
ENTIDAD_ID_ALIASES = [
    "ID_ESTADO",
    "ID_ENTIDAD",
    "CVE_ENT",
    "CLAVE_ENTIDAD",
    "ESTADO_ID",
    "ENTIDAD_ID",
    "ID_EDO",
]
ENTIDAD_NOMBRE_ALIASES = [
    "ESTADO",
    "ENTIDAD",
    "NOMBRE_ESTADO",
    "NOMBRE_ENTIDAD",
    "NOM_ENT",
]
MUNICIPIO_ID_ALIASES = [
    "ID_MUNICIPIO",
    "CVE_MUN",
    "CLAVE_MUNICIPIO",
    "MUNICIPIO_ID",
    "ID_MUN",
]
MUNICIPIO_NOMBRE_ALIASES = [
    "MUNICIPIO",
    "NOMBRE_MUNICIPIO",
    "NOM_MUN",
    "DESCRIPCION_MUNICIPIO",
]
LISTA_NOMINAL_ALIASES = [
    "LISTA_NOMINAL",
    "LISTA_NOMINAL_CASILLA",
    "LN",
    "LISTA_NOMINAL_TOTAL",
    "TOTAL_LISTA_NOMINAL",
]
VOTOS_TOTALES_ALIASES = [
    "TOTAL_VOTOS",
    "TOTAL_VOTOS_CALCULADOS",
    "TOTAL_VOTOS_SUM",
    "VOTACION_TOTAL",
    "VOTACION_TOTAL_EMITIDA",
    "TOTAL_VOTACION",
    "TOTAL",
]

ALL_ALIASES = (
    ENTIDAD_ID_ALIASES
    + ENTIDAD_NOMBRE_ALIASES
    + MUNICIPIO_ID_ALIASES
    + MUNICIPIO_NOMBRE_ALIASES
    + LISTA_NOMINAL_ALIASES
    + VOTOS_TOTALES_ALIASES
)

COLUMNS_ORDER = [
    "cve_ent",
    "ine_mun",
    "mun_name",
    "mun_norm",
    "year",
    "election",
    "lista_nominal",
    "votos_totales",
    "participacion",
    "source_file",
]

VALID_EXTENSIONS = {".csv", ".txt", ".xlsx", ".xls", ".zip"}

# CONTRACT-NOTE: states.csv in data/seed/ is the preferred source; falling back to hardcoded 32 entity mapping.
FALLBACK_STATES = {
    "AGUASCALIENTES": "01", "AGS": "01",
    "BAJA CALIFORNIA": "02", "BC": "02", "BAJA CALIFORNIA NORTE": "02",
    "BAJA CALIFORNIA SUR": "03", "BCS": "03",
    "CAMPECHE": "04", "CAMP": "04",
    "COAHUILA DE ZARAGOZA": "05", "COAHUILA": "05", "COAH": "05",
    "COLIMA": "06", "COL": "06",
    "CHIAPAS": "07", "CHIS": "07",
    "CHIHUAHUA": "08", "CHIH": "08",
    "CIUDAD DE MEXICO": "09", "CDMX": "09", "DISTRITO FEDERAL": "09", "DF": "09",
    "DURANGO": "10", "DGO": "10",
    "GUANAJUATO": "11", "GTO": "11",
    "GUERRERO": "12", "GRO": "12",
    "HIDALGO": "13", "HGO": "13",
    "JALISCO": "14", "JAL": "14",
    "MEXICO": "15", "ESTADO DE MEXICO": "15", "EDOMEX": "15", "EDO MEX": "15",
    "MICHOACAN DE OCAMPO": "16", "MICHOACAN": "16", "MICH": "16",
    "MORELOS": "17", "MOR": "17",
    "NAYARIT": "18", "NAY": "18",
    "NUEVO LEON": "19", "NL": "19",
    "OAXACA": "20", "OAX": "20",
    "PUEBLA": "21", "PUE": "21",
    "QUERETARO DE ARTEAGA": "22", "QUERETARO": "22", "QRO": "22",
    "QUINTANA ROO": "23", "QROO": "23", "Q ROO": "23",
    "SAN LUIS POTOSI": "24", "SLP": "24",
    "SINALOA": "25", "SIN": "25",
    "SONORA": "26", "SON": "26",
    "TABASCO": "27", "TAB": "27",
    "TAMAULIPAS": "28", "TAMPS": "28",
    "TLAXCALA": "29", "TLAX": "29",
    "VERACRUZ DE IGNACIO DE LA LLAVE": "30", "VERACRUZ": "30", "VER": "30",
    "YUCATAN": "31", "YUC": "31",
    "ZACATECAS": "32", "ZAC": "32",
}


def load_state_lookup(seed_dir: Path | None = None) -> dict[str, str]:
    """Build a mapping from normalized state names, aliases, and numbers to 2-digit cve_ent.
    
    Prefers data/seed/states.csv if available; otherwise falls back to FALLBACK_STATES.
    """
    lookup: dict[str, str] = {}
    states_file = (seed_dir or SEED_DIR) / "states.csv"

    if states_file.is_file():
        try:
            with open(states_file, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cve = zpad(row.get("cve_ent", ""), 2)
                    name = row.get("name", "")
                    lookup[norm_name(name)] = cve
                    aliases = row.get("aliases", "")
                    for alias in aliases.split("|"):
                        a_clean = alias.strip()
                        if a_clean:
                            lookup[norm_name(a_clean)] = cve
                    lookup[cve] = cve
                    try:
                        lookup[str(int(cve))] = cve
                    except ValueError:
                        pass
            return lookup
        except Exception as e:
            logger.warning("Could not read states.csv from %s: %s; using fallback.", states_file, e)

    # Fallback mapping
    for k, v in FALLBACK_STATES.items():
        cve = zpad(v, 2)
        lookup[norm_name(k)] = cve
        lookup[cve] = cve
        try:
            lookup[str(int(cve))] = cve
        except ValueError:
            pass

    return lookup


def create_empty_df() -> pd.DataFrame:
    """Create an empty DataFrame with exact §4.2 columns and dtypes."""
    return pd.DataFrame({
        "cve_ent": pd.Series(dtype="object"),
        "ine_mun": pd.Series(dtype="Int64"),
        "mun_name": pd.Series(dtype="object"),
        "mun_norm": pd.Series(dtype="object"),
        "year": pd.Series(dtype="int64"),
        "election": pd.Series(dtype="object"),
        "lista_nominal": pd.Series(dtype="int64"),
        "votos_totales": pd.Series(dtype="int64"),
        "participacion": pd.Series(dtype="float64"),
        "source_file": pd.Series(dtype="object"),
    })


def is_mostly_numeric(series: pd.Series, threshold: float = 0.9) -> bool:
    """Check if at least threshold fraction of non-empty values can be parsed as numbers."""
    s = series.dropna().astype(str).str.strip()
    s = s[~s.isin(["", "nan", "NaN", "None", "*", "N/D", "ND", "-", "N.D."])]
    if len(s) == 0:
        return False
    num = to_num(s)
    return float(num.notna().sum() / len(s)) >= threshold


def resolve_municipio_columns(
    df: pd.DataFrame,
    file_name: str,
) -> tuple[str | None, str | None]:
    """Identify the municipio ID column and municipio Name column in df.
    
    Rule:
    If candidate for municipio name is >= 90% numeric, treat it as ID and look
    for another name column. If none found, mun_name is empty string.
    If no municipio column is found, raises ValueError.
    """
    mun_id_candidate = pick_col(df, MUNICIPIO_ID_ALIASES, required=False)

    name_candidates = []
    for alias in MUNICIPIO_NOMBRE_ALIASES:
        c = pick_col(df, [alias], required=False)
        if c is not None and c not in name_candidates:
            name_candidates.append(c)

    mun_id_col = mun_id_candidate
    mun_name_col = None

    if name_candidates:
        first_name_col = name_candidates[0]
        if is_mostly_numeric(df[first_name_col]):
            if mun_id_col is None:
                mun_id_col = first_name_col
            remaining = [c for c in name_candidates[1:] if c != mun_id_col]
            for rem_col in remaining:
                if not is_mostly_numeric(df[rem_col]):
                    mun_name_col = rem_col
                    break
        else:
            mun_name_col = first_name_col

    if mun_id_col is None and mun_name_col is None:
        raise ValueError(
            f"{file_name}: no trae columna de municipio; descargue el nivel municipio/sección desde SICEE"
        )

    return mun_id_col, mun_name_col


def get_entity_series(df: pd.DataFrame, lookup: dict[str, str], file_name: str) -> pd.Series:
    """Resolve cve_ent ('01'..'32') from table columns using ID or Name aliases and state lookup."""
    def _resolve(val):
        if val is None or pd.isna(val):
            return None
        s = str(val).strip()
        if not s or s.lower() in ("nan", "none", "null"):
            return None
        norm = norm_name(s)
        if norm in lookup:
            return lookup[norm]
        try:
            f = float(s)
            if not np.isnan(f):
                i = int(f)
                if 1 <= i <= 32:
                    return f"{i:02d}"
        except (ValueError, TypeError):
            pass
        return None

    id_col = pick_col(df, ENTIDAD_ID_ALIASES, required=False)
    if id_col is not None:
        resolved = df[id_col].map(_resolve)
        if resolved.notna().any():
            return resolved

    name_col = pick_col(df, ENTIDAD_NOMBRE_ALIASES, required=False)
    if name_col is not None:
        resolved = df[name_col].map(_resolve)
        if resolved.notna().any():
            return resolved

    raise ValueError(f"{file_name}: no se encontró columna válida de entidad/estado")


def is_excluded_mun_name(norm_str: str) -> bool:
    """Check if municipality name indicates subtotals, totals, or foreign voting."""
    if not norm_str:
        return False
    words = set(norm_str.split())
    if words.intersection({"TOTAL", "TOTALES", "SUBTOTAL", "SUBTOTALES", "EXTRANJERO"}):
        return True
    for prefix in ("TOTAL", "SUBTOTAL", "EXTRANJERO"):
        if norm_str.startswith(prefix) or norm_str.endswith(prefix):
            return True
    return False


def process_file(
    file_path: Path,
    election: str,
    year: int,
    seed_dir: Path | None = None,
) -> pd.DataFrame:
    """Process a single INE election file into municipality rows conforming to §4.2."""
    lookup = load_state_lookup(seed_dir)
    df = read_table(file_path, expect_any=ALL_ALIASES)
    if df.empty:
        return create_empty_df()

    # Find required columns
    mun_id_col, mun_name_col = resolve_municipio_columns(df, file_path.name)

    votos_col = pick_col(df, VOTOS_TOTALES_ALIASES, required=False)
    if votos_col is None:
        raise ValueError(
            f"{file_path.name}: no trae columna de votos totales; no se calculan sumas de partidos para evitar inconsistencias"
        )

    lista_col = pick_col(df, LISTA_NOMINAL_ALIASES, required=False)
    if lista_col is None:
        raise ValueError(f"{file_path.name}: no trae columna de lista nominal")

    cve_ent_series = get_entity_series(df, lookup, file_path.name)

    if mun_name_col is not None:
        raw_mun_name = df[mun_name_col].fillna("").astype(str)
    else:
        raw_mun_name = pd.Series("", index=df.index, dtype=str)

    mun_norm_series = raw_mun_name.map(norm_name)

    s_ln = to_num(df[lista_col])
    s_vt = to_num(df[votos_col])

    # Exclusion filters:
    # 1. cve_ent must be valid '01'..'32'
    # 2. mun_norm must not contain TOTAL, SUBTOTAL, EXTRANJERO
    # 3. rows with both lista_nominal and votos_totales NaN are excluded
    valid_ent_mask = cve_ent_series.notna()
    excluded_name_mask = mun_norm_series.apply(is_excluded_mun_name)
    both_nan_mask = s_ln.isna() & s_vt.isna()

    keep_mask = valid_ent_mask & (~excluded_name_mask) & (~both_nan_mask)
    if not keep_mask.any():
        return create_empty_df()

    filtered_df = pd.DataFrame({
        "cve_ent": cve_ent_series[keep_mask],
        "mun_name": raw_mun_name[keep_mask],
        "mun_norm": mun_norm_series[keep_mask],
        "lista_nominal": s_ln[keep_mask].fillna(0).astype("int64"),
        "votos_totales": s_vt[keep_mask].fillna(0).astype("int64"),
    })

    if mun_id_col is not None:
        mun_id_num = to_num(df.loc[keep_mask, mun_id_col])
        filtered_df["ine_mun_group"] = mun_id_num.fillna(-1).astype(int)
    else:
        filtered_df["ine_mun_group"] = -1

    def _pick_mode_name(s: pd.Series) -> str:
        valid = s[s.str.strip() != ""]
        if valid.empty:
            return ""
        mode_vals = valid.mode()
        return mode_vals.iloc[0] if not mode_vals.empty else valid.iloc[0]

    grouped = filtered_df.groupby(
        ["cve_ent", "ine_mun_group", "mun_norm"],
        as_index=False,
    ).agg({
        "lista_nominal": "sum",
        "votos_totales": "sum",
        "mun_name": _pick_mode_name,
    })

    grouped["ine_mun"] = grouped["ine_mun_group"].apply(
        lambda x: pd.NA if x == -1 else int(x)
    ).astype("Int64")
    grouped = grouped.drop(columns=["ine_mun_group"])

    participacion = np.full(len(grouped), np.nan, dtype=float)
    valid_ln = grouped["lista_nominal"] > 0
    participacion[valid_ln] = (
        grouped.loc[valid_ln, "votos_totales"] / grouped.loc[valid_ln, "lista_nominal"]
    )

    clipped_mask = valid_ln & (participacion > 1.0)
    clipped_count = int(np.sum(clipped_mask))
    if clipped_count > 0:
        logger.warning(
            "%s: %d municipios tuvieron participación > 1.0 y se recortaron a 1.0",
            file_path.name,
            clipped_count,
        )
    participacion[clipped_mask] = 1.0
    grouped["participacion"] = participacion

    grouped["year"] = int(year)
    grouped["election"] = election
    grouped["source_file"] = file_path.name

    return grouped[COLUMNS_ORDER]


def discover_files(raw_dir: Path) -> dict[tuple[str, int], Path]:
    """Scan raw_dir non-recursively for INE result files matching (ELECTION)_(YEAR).
    
    If duplicates exist for the same (election, year), picks the largest file size and logs a warning.
    """
    if not raw_dir.is_dir():
        return {}

    candidates: dict[tuple[str, int], list[Path]] = {}
    for entry in raw_dir.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in VALID_EXTENSIONS:
            continue

        m = re.search(r"(DIP_FED|PRES|SEN|PJF)[_\- ]?(\d{4})", entry.name.upper())
        if not m:
            logger.warning("Archivo ignorado (no cumple patrón <elección>_<año>): %s", entry.name)
            continue

        election = m.group(1)
        year = int(m.group(2))
        key = (election, year)
        if key not in candidates:
            candidates[key] = []
        candidates[key].append(entry)

    selected: dict[tuple[str, int], Path] = {}
    for key, files in candidates.items():
        if len(files) == 1:
            selected[key] = files[0]
        else:
            largest = max(files, key=lambda f: f.stat().st_size)
            logger.warning(
                "Múltiples archivos para %s %d: seleccionando %s (mayor tamaño: %d bytes)",
                key[0],
                key[1],
                largest.name,
                largest.stat().st_size,
            )
            selected[key] = largest

    return selected


def print_summary(df: pd.DataFrame) -> None:
    """Print brief console summary table per (election, year)."""
    if df.empty:
        print("No se encontraron registros para mostrar resumen.")
        return

    print("\n" + "=" * 80)
    print(
        f"{'Elección':<10} {'Año':<6} {'Municipios':<12} {'Lista Nominal':<16} {'Votos Totales':<16} {'Part. Ponderada':<16}"
    )
    print("-" * 80)
    summary_groups = df.groupby(["election", "year"], as_index=False).agg({
        "mun_norm": "count",
        "lista_nominal": "sum",
        "votos_totales": "sum",
    })
    for _, row in summary_groups.iterrows():
        elec = str(row["election"])
        yr = int(row["year"])
        n_mun = int(row["mun_norm"])
        ln = int(row["lista_nominal"])
        vt = int(row["votos_totales"])
        part_str = f"{(vt / ln * 100):.2f}%" if ln > 0 else "N/A"
        print(f"{elec:<10} {yr:<6} {n_mun:<12,d} {ln:<16,d} {vt:<16,d} {part_str:<16}")
    print("=" * 80 + "\n")


def ingest_ine_results(
    raw_dir: Path | str | None = None,
    out_path: Path | str | None = None,
    seed_dir: Path | str | None = None,
) -> pd.DataFrame:
    """Run ingestion for all discovered INE election files."""
    raw_dir = Path(raw_dir) if raw_dir else (RAW_DIR / "ine")
    out_path = Path(out_path) if out_path else (BUILD_DIR / "participation_ine.parquet")
    seed_dir = Path(seed_dir) if seed_dir else SEED_DIR

    if not raw_dir.is_dir():
        print(f"Carpeta de entrada {raw_dir} no existe. Generando parquet vacío.")
        empty_df = create_empty_df()
        write_parquet(empty_df, out_path)
        return empty_df

    selected_files = discover_files(raw_dir)
    if not selected_files:
        print(f"Carpeta {raw_dir} no contiene archivos válidos de resultados INE. Generando parquet vacío.")
        empty_df = create_empty_df()
        write_parquet(empty_df, out_path)
        return empty_df

    dfs: list[pd.DataFrame] = []
    for (election, year), file_path in sorted(selected_files.items()):
        try:
            print(f"Procesando {file_path.name} ({election} {year})...")
            df_file = process_file(file_path, election=election, year=year, seed_dir=seed_dir)
            if df_file is not None and not df_file.empty:
                dfs.append(df_file)
        except Exception as exc:
            logger.warning("Error procesando %s: %s", file_path.name, exc)
            print(f"Aviso: {file_path.name} omitido ({exc})")

    if not dfs:
        print("Ningún archivo pudo procesarse exitosamente. Generando parquet vacío.")
        empty_df = create_empty_df()
        write_parquet(empty_df, out_path)
        return empty_df

    combined = pd.concat(dfs, ignore_index=True)
    combined = combined.sort_values(by=["election", "year", "cve_ent", "mun_norm"]).reset_index(drop=True)
    write_parquet(combined, out_path)
    print_summary(combined)
    return combined


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint for INE results ingestion."""
    parser = argparse.ArgumentParser(
        description="Ingest INE election results into municipality-level participation parquet."
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=None,
        help="Directory containing INE election result files (default: data/raw/ine)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Destination parquet file path (default: data/build/participation_ine.parquet)",
    )
    parser.add_argument(
        "--seed-dir",
        type=Path,
        default=None,
        help="Directory containing seed CSVs (default: data/seed)",
    )

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    ingest_ine_results(raw_dir=args.raw_dir, out_path=args.out, seed_dir=args.seed_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
