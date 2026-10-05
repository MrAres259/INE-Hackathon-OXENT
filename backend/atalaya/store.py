"""DataStore implementations: PandasStore (offline/fallback) and EsStore (CSS cluster)."""

from __future__ import annotations

import difflib
import functools
import json
import logging
import re
from pathlib import Path
from typing import Any, Protocol, Sequence

import numpy as np
import pandas as pd
from elasticsearch.helpers import scan

from atalaya.config import BUILD_DIR, SEED_DIR, get_settings, index_name
from atalaya.es_client import get_es, ping_es
from atalaya.ingest.common import norm_name, zpad

logger = logging.getLogger(__name__)

SPANISH_STOPWORDS = {
    "de", "la", "el", "los", "las", "en", "y", "por", "con", "del", "que", "a", "o", "al", "para"
}

PARTICIPATION_METRICS = {"participacion", "abstencion", "lista_nominal", "votos_totales"}


class StoreError(Exception):
    """Exception raised for errors during Store operations."""


class DataStore(Protocol):
    """Protocol defining the DataStore interface."""

    kind: str  # "es" | "memory"

    def healthy(self) -> bool:
        ...

    def units(self, level: str = "mun", ent: str | None = None) -> pd.DataFrame:
        ...

    def unit(self, unit_id: str) -> dict | None:
        ...

    def participation(
        self,
        unit_ids: list[str] | None = None,
        *,
        level: str = "mun",
        election: str | None = "DIP_FED",
        years: list[int] | None = None,
    ) -> pd.DataFrame:
        ...

    def search_units(self, text: str, *, level: str | None = None, size: int = 5) -> list[dict]:
        ...

    def search_catalog(self, text: str, size: int = 5) -> list[dict]:
        ...

    def top(
        self,
        metric: str,
        *,
        level: str = "mun",
        filters: dict | None = None,
        order: str = "desc",
        limit: int = 10,
    ) -> list[dict]:
        ...

    def aggregate(
        self,
        metric: str,
        *,
        level: str = "mun",
        group_by: str | None = None,
        filters: dict | None = None,
        stat: str = "avg",
    ) -> list[dict]:
        ...

    def correlation(
        self,
        fields: list[str],
        *,
        level: str = "mun",
        filters: dict | None = None,
    ) -> dict:
        ...

    def drivers(self, unit_id: str) -> list[dict]:
        ...

    def profile(self, unit_id: str, year: int | None = None) -> list[dict]:
        ...

    def ccpc_features(self, unit_id: str, year: int | None = None) -> dict | None:
        ...

    def metrics(self) -> dict:
        ...

    def reload(self) -> None:
        ...

    def stats(self) -> dict:
        ...


class PandasStore:
    """In-memory DataStore backed by Parquet build files and seed CSVs."""

    kind: str = "memory"

    def __init__(self, build_dir: Path | str = BUILD_DIR, seed_dir: Path | str = SEED_DIR):
        self.build_dir = Path(build_dir)
        self.seed_dir = Path(seed_dir)
        self._units_df: pd.DataFrame | None = None
        self._participation_df: pd.DataFrame | None = None
        self._catalog_df: pd.DataFrame | None = None
        self._states_df: pd.DataFrame | None = None
        self._drivers_df: pd.DataFrame | None = None
        self._metrics_dict: dict | None = None
        self._profile_df: pd.DataFrame | None = None
        self._ccpc_features_df: pd.DataFrame | None = None

    def reload(self) -> None:
        """Clear all cached DataFrames and dictionaries."""
        self._units_df = None
        self._participation_df = None
        self._catalog_df = None
        self._states_df = None
        self._drivers_df = None
        self._metrics_dict = None
        self._profile_df = None
        self._ccpc_features_df = None

    def healthy(self) -> bool:
        """Returns True since local PandasStore is always available."""
        return True

    def _get_states(self) -> pd.DataFrame:
        if self._states_df is None:
            states_file = self.seed_dir / "states.csv"
            if states_file.is_file():
                self._states_df = pd.read_csv(states_file, dtype=str)
            else:
                self._states_df = pd.DataFrame(columns=["cve_ent", "name", "iso", "aliases"])
        return self._states_df

    def _get_catalog(self) -> pd.DataFrame:
        if self._catalog_df is None:
            cat_file = self.seed_dir / "variables.csv"
            if cat_file.is_file():
                self._catalog_df = pd.read_csv(cat_file, dtype=str)
            else:
                self._catalog_df = pd.DataFrame(
                    columns=["key", "label_es", "description", "source", "unit", "level"]
                )
        return self._catalog_df

    def _load_units(self) -> pd.DataFrame:
        units_path = self.build_dir / "units.parquet"
        features_path = self.build_dir / "features.parquet"

        if units_path.is_file():
            df = pd.read_parquet(units_path)
        elif features_path.is_file():
            feat = pd.read_parquet(features_path)
            df = feat.copy()
            df["id"] = df["cvegeo"]
            df["level"] = "mun"
            df["name"] = df["nom_mun"] if "nom_mun" in df.columns else df["cvegeo"]
            risk_cols = [
                "lista_nominal", "last_year", "last_participation",
                "pred_participation", "pred_abstention", "pred_low", "pred_high",
                "trend_pp", "volatility_pp", "risk_score"
            ]
            for col in risk_cols:
                if col not in df.columns:
                    df[col] = np.nan
            df["category"] = "sin_dato"
        else:
            cols = [
                "id", "level", "cve_ent", "cve_mun", "cvegeo", "name", "nom_ent", "nom_mun",
                "pob_tot", "pob_18ymas", "pct_18_24", "pct_65ymas", "graproes", "pct_hli",
                "pct_sin_servsalud", "pct_internet", "pct_rural", "pct_analfabeta",
                "pct_po2sm", "im_2020", "gm_2020", "lista_nominal", "last_year",
                "last_participation", "pred_participation", "pred_abstention",
                "pred_low", "pred_high", "trend_pp", "volatility_pp", "risk_score", "category"
            ]
            df = pd.DataFrame(columns=cols)

        # Derive state rows if missing
        if not df.empty and "level" in df.columns and not (df["level"] == "state").any():
            mun_df = df[df["level"] == "mun"]
            states_info = self._get_states()
            name_map = {}
            if not states_info.empty and "cve_ent" in states_info.columns:
                for _, r in states_info.iterrows():
                    name_map[zpad(r["cve_ent"], 2)] = r["name"]

            state_rows = []
            for ent, group in mun_df.groupby("cve_ent"):
                ent_str = zpad(ent, 2)
                st_name = name_map.get(ent_str, f"Estado {ent_str}")
                if "pob_18ymas" in group.columns:
                    w = pd.to_numeric(group["pob_18ymas"], errors="coerce").fillna(0)
                else:
                    w = pd.Series(0.0, index=group.index)

                row: dict[str, Any] = {
                    "id": ent_str,
                    "level": "state",
                    "cve_ent": ent_str,
                    "cve_mun": "",
                    "cvegeo": ent_str,
                    "name": st_name,
                    "nom_ent": st_name,
                    "nom_mun": "",
                }

                # Sum counts
                for c in ["pob_tot", "pob_18ymas", "lista_nominal"]:
                    if c in group.columns:
                        s = pd.to_numeric(group[c], errors="coerce").fillna(0).sum()
                        row[c] = s if s > 0 else np.nan

                # Weighted averages
                prop_cols = [
                    "pct_18_24", "pct_65ymas", "graproes", "pct_hli", "pct_sin_servsalud",
                    "pct_internet", "pct_rural", "pct_analfabeta", "pct_po2sm", "im_2020",
                    "last_participation", "pred_participation", "pred_abstention",
                    "pred_low", "pred_high", "trend_pp", "volatility_pp", "risk_score",
                    "part_pj_2025", "part_18_34_last", "gap_youth_pp_last", "gap_sexo_pp_last", "pct_ln_rural_last"
                ]
                for c in prop_cols:
                    if c in group.columns:
                        vals = pd.to_numeric(group[c], errors="coerce")
                        valid = vals.notna() & (w > 0)
                        if valid.any() and w[valid].sum() > 0:
                            row[c] = float((vals[valid] * w[valid]).sum() / w[valid].sum())
                        elif vals.notna().any():
                            row[c] = float(vals.mean())
                        else:
                            row[c] = np.nan

                if "imputed_census" in group.columns:
                    row["imputed_census"] = bool(group["imputed_census"].any())
                else:
                    row["imputed_census"] = False

                if "category" in group.columns and pd.notna(row.get("risk_score")):
                    rs = row["risk_score"]
                    row["category"] = "rojo" if rs >= 75 else ("naranja" if rs >= 55 else ("amarillo" if rs >= 35 else "verde"))
                else:
                    row["category"] = "sin_dato"

                state_rows.append(row)

            if state_rows:
                state_df = pd.DataFrame(state_rows)
                df = pd.concat([df, state_df], ignore_index=True)

        # Derive coverage_ln if missing
        if "coverage_ln" not in df.columns and "lista_nominal" in df.columns and "pob_18ymas" in df.columns:
            ln = pd.to_numeric(df["lista_nominal"], errors="coerce")
            p18 = pd.to_numeric(df["pob_18ymas"], errors="coerce")
            cond = (p18 > 0).fillna(False).to_numpy(dtype=bool)
            with np.errstate(divide="ignore", invalid="ignore"):
                df["coverage_ln"] = np.where(cond, np.clip((ln / p18).astype(float), 0.0, 1.2), np.nan)

        # Pivot participation (DIP_FED) to part_dip_<year> and abst_dip_<year> for mun and state
        part_df = self._get_participation()
        if not part_df.empty and "election" in part_df.columns:
            dip = part_df[part_df["election"] == "DIP_FED"]
            if not dip.empty and "year" in dip.columns:
                years = sorted(dip["year"].dropna().unique().astype(int))
                for yr in years:
                    part_col = f"part_dip_{yr}"
                    abst_col = f"abst_dip_{yr}"
                    if part_col not in df.columns:
                        yr_dip = dip[dip["year"] == yr]
                        part_map = dict(zip(yr_dip["unit_id"].astype(str), yr_dip["participacion"]))
                        abst_map = dict(zip(yr_dip["unit_id"].astype(str), yr_dip["abstencion"]))
                        df[part_col] = df["id"].astype(str).map(part_map).astype(float)
                        df[abst_col] = df["id"].astype(str).map(abst_map).astype(float)

            # Check part_pj_2025 from participation if not in df
            if "part_pj_2025" not in df.columns:
                pjf = part_df[(part_df["election"] == "PJF") | (part_df["year"] == 2025)]
                if not pjf.empty and "participacion" in pjf.columns:
                    pj_map = dict(zip(pjf["unit_id"].astype(str), pjf["participacion"]))
                    df["part_pj_2025"] = df["id"].astype(str).map(pj_map).astype(float)

        # Check ccpc_features.parquet for part_18_34_last, gap_youth_pp_last, etc. if missing
        ccpc_last_cols = ["pct_ln_18_34_last", "part_18_34_last", "gap_youth_pp_last", "gap_sexo_pp_last", "pct_ln_rural_last"]
        missing_last = [c for c in ccpc_last_cols if c not in df.columns]
        if missing_last:
            feat_df = self._get_ccpc_features()
            if not feat_df.empty and "year" in feat_df.columns:
                dip_years = sorted([int(y) for y in feat_df["year"].dropna().unique() if int(y) <= 2024])
                latest_yr = dip_years[-1] if dip_years else 2024
                latest_feat = feat_df[feat_df["year"] == latest_yr]
                c_map = {
                    "pct_ln_18_34_last": "pct_ln_18_34",
                    "part_18_34_last": "part_18_34",
                    "gap_youth_pp_last": "gap_youth_pp",
                    "gap_sexo_pp_last": "gap_sexo_pp",
                    "pct_ln_rural_last": "pct_ln_rural",
                }
                for dst_col, src_col in c_map.items():
                    if dst_col in missing_last and src_col in latest_feat.columns:
                        id_col = "cvegeo" if "cvegeo" in latest_feat.columns else "id"
                        v_map = dict(zip(latest_feat[id_col].astype(str), latest_feat[src_col]))
                        df[dst_col] = df["id"].astype(str).map(v_map).astype(float)

        if "imputed_census" not in df.columns:
            df["imputed_census"] = False

        return df

    def _get_units(self) -> pd.DataFrame:
        if self._units_df is None:
            self._units_df = self._load_units()
        return self._units_df

    def _load_participation(self) -> pd.DataFrame:
        part_path = self.build_dir / "participation.parquet"
        if not part_path.is_file():
            cols = [
                "unit_id", "level", "cvegeo", "cve_ent", "year", "election",
                "lista_nominal", "votos_totales", "participacion", "abstencion"
            ]
            return pd.DataFrame(columns=cols)

        df = pd.read_parquet(part_path)
        if "unit_id" not in df.columns:
            df["unit_id"] = df["cvegeo"]
        if "level" not in df.columns:
            df["level"] = "mun"

        # Ensure cve_ent is 2 digits
        df["cve_ent"] = df["cve_ent"].apply(lambda v: zpad(v, 2))

        # Check if state rows already present
        if not (df["level"] == "state").any():
            mun_part = df[df["level"] == "mun"]
            sum_cols = ["lista_nominal", "votos_totales"]
            for extra in ["nv", "ns"]:
                if extra in mun_part.columns:
                    sum_cols.append(extra)
            grouped = mun_part.groupby(["cve_ent", "year", "election"], as_index=False)[
                sum_cols
            ].sum()

            grouped["unit_id"] = grouped["cve_ent"]
            grouped["cvegeo"] = grouped["cve_ent"]
            grouped["level"] = "state"
            cond_ln = (grouped["lista_nominal"] > 0).fillna(False).to_numpy(dtype=bool)
            with np.errstate(divide="ignore", invalid="ignore"):
                grouped["participacion"] = np.where(
                    cond_ln,
                    np.clip(grouped["votos_totales"] / grouped["lista_nominal"], 0.0, 1.0),
                    np.nan,
                )
            if "ns" in grouped.columns:
                with np.errstate(divide="ignore", invalid="ignore"):
                    grouped["ns_rate"] = np.where(cond_ln, grouped["ns"] / grouped["lista_nominal"], np.nan)
                    grouped["reliable"] = (grouped["ns_rate"] <= 0.5) & (grouped["participacion"] >= 0.02)
                    grouped["low_confidence"] = (grouped["ns_rate"] > 0.3) & (grouped["ns_rate"] <= 0.5)
            df = pd.concat([df, grouped], ignore_index=True)

        if "ns_rate" not in df.columns and "ns" in df.columns and "lista_nominal" in df.columns:
            cond_ln = (df["lista_nominal"] > 0).fillna(False).to_numpy(dtype=bool)
            with np.errstate(divide="ignore", invalid="ignore"):
                df["ns_rate"] = np.where(cond_ln, df["ns"] / df["lista_nominal"], np.nan)
        if "reliable" not in df.columns and "participacion" in df.columns:
            if "ns_rate" in df.columns:
                df["reliable"] = (df["ns_rate"].fillna(0) <= 0.5) & (df["participacion"].fillna(0) >= 0.02) & df["participacion"].notna()
            else:
                df["reliable"] = (df["participacion"].fillna(0) >= 0.02) & df["participacion"].notna()
        if "low_confidence" not in df.columns:
            if "ns_rate" in df.columns:
                df["low_confidence"] = (df["ns_rate"].fillna(0) > 0.3) & (df["ns_rate"].fillna(0) <= 0.5)
            else:
                df["low_confidence"] = False

        if "abstencion" not in df.columns:
            df["abstencion"] = 1.0 - df["participacion"]

        return df

    def _get_participation(self) -> pd.DataFrame:
        if self._participation_df is None:
            self._participation_df = self._load_participation()
        return self._participation_df

    def units(self, level: str = "mun", ent: str | None = None) -> pd.DataFrame:
        df = self._get_units().copy()
        if level:
            df = df[df["level"] == level]
        if ent:
            df = df[df["cve_ent"] == zpad(ent, 2)]
        return df.reset_index(drop=True)

    def unit(self, unit_id: str) -> dict | None:
        df = self._get_units()
        matches = df[df["id"] == str(unit_id)]
        if matches.empty and "cvegeo" in df.columns:
            matches = df[df["cvegeo"] == str(unit_id)]
        if matches.empty:
            return None
        row = matches.iloc[0].to_dict()
        return {k: (None if pd.isna(v) else v) for k, v in row.items()}

    def participation(
        self,
        unit_ids: list[str] | None = None,
        *,
        level: str = "mun",
        election: str | None = "DIP_FED",
        years: list[int] | None = None,
    ) -> pd.DataFrame:
        df = self._get_participation().copy()
        if level:
            df = df[df["level"] == level]
        if unit_ids is not None:
            df = df[df["unit_id"].isin(unit_ids)]
        if election:
            df = df[df["election"] == election]
        if years:
            df = df[df["year"].isin(years)]
        return df.reset_index(drop=True)

    def search_units(self, text: str, *, level: str | None = None, size: int = 5) -> list[dict]:
        q_norm = norm_name(text)
        if not q_norm:
            return []

        units_df = self._get_units()
        if level:
            units_df = units_df[units_df["level"] == level]

        states_df = self._get_states()
        state_aliases_map: dict[str, list[str]] = {}
        if not states_df.empty:
            for _, r in states_df.iterrows():
                ent = zpad(r["cve_ent"], 2)
                cands = [r["name"]]
                if pd.notna(r.get("iso")):
                    cands.append(str(r["iso"]))
                if pd.notna(r.get("aliases")):
                    cands.extend(str(r["aliases"]).split("|"))
                state_aliases_map[ent] = [norm_name(c) for c in cands if c]

        scored: list[dict] = []
        for _, u in units_df.iterrows():
            cand_names = [norm_name(u.get("name", ""))]
            if u["level"] == "state" and u["cve_ent"] in state_aliases_map:
                cand_names.extend(state_aliases_map[u["cve_ent"]])

            best_score = 0.0
            for cand in cand_names:
                if not cand:
                    continue
                if q_norm == cand:
                    score = 1.0
                elif cand.startswith(q_norm) or q_norm.startswith(cand):
                    score = 0.9
                elif q_norm in cand or cand in q_norm:
                    score = 0.8
                else:
                    score = difflib.SequenceMatcher(None, q_norm, cand).ratio()
                if score > best_score:
                    best_score = score

            if best_score >= 0.6:
                scored.append({
                    "id": str(u["id"]),
                    "name": str(u.get("name", "")),
                    "level": str(u.get("level", "")),
                    "cve_ent": str(u.get("cve_ent", "")),
                    "score": round(best_score, 4),
                })

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:size]

    def search_catalog(self, text: str, size: int = 5) -> list[dict]:
        cat_df = self._get_catalog()
        if cat_df.empty:
            return []

        tokens_q = set(re.findall(r"\w+", norm_name(text).lower())) - SPANISH_STOPWORDS
        if not tokens_q:
            return []

        results: list[dict] = []
        for _, row in cat_df.iterrows():
            combined = f"{row.get('key', '')} {row.get('label_es', '')} {row.get('description', '')}"
            tokens_row = set(re.findall(r"\w+", norm_name(combined).lower())) - SPANISH_STOPWORDS
            overlap = len(tokens_q & tokens_row)
            if overlap > 0:
                score = overlap / len(tokens_q)
                # Boost if exact key or label match
                if norm_name(row.get("key", "")).lower() in tokens_q:
                    score += 0.5
                r = row.to_dict()
                r["score"] = round(score, 4)
                results.append(r)

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:size]

    def _resolve_data_and_filters(
        self,
        metrics: list[str],
        level: str,
        filters: dict | None,
    ) -> pd.DataFrame:
        filters = filters or {}
        election = filters.get("election", "DIP_FED")

        # Map participacion / abstencion to part_dip_<yr> / abst_dip_<yr> if election is DIP_FED
        alias_map: dict[str, str] = {}
        if election == "DIP_FED":
            units_raw = self._get_units()
            dip_cols = [c for c in units_raw.columns if c.startswith("part_dip_")]
            years = sorted([int(c.split("_")[-1]) for c in dip_cols if c.split("_")[-1].isdigit()])
            target_year = filters.get("year")
            if target_year is not None:
                chosen_year = int(target_year)
            elif years:
                chosen_year = years[-1]
            else:
                part_raw = self._get_participation()
                if not part_raw.empty and "year" in part_raw.columns:
                    dip_part = part_raw[part_raw["election"] == "DIP_FED"]
                    chosen_year = int(dip_part["year"].max()) if not dip_part.empty else 2024
                else:
                    chosen_year = 2024

            for m in metrics:
                if m == "participacion":
                    alias_map[m] = f"part_dip_{chosen_year}"
                elif m == "abstencion":
                    alias_map[m] = f"abst_dip_{chosen_year}"

        # If any metric is still in PARTICIPATION_METRICS (e.g. lista_nominal, votos_totales or election != DIP_FED),
        # we need the participation table
        remaining_part_metrics = [m for m in metrics if m in PARTICIPATION_METRICS and m not in alias_map]
        needs_part = bool(remaining_part_metrics)

        if needs_part:
            df_part = self._get_participation().copy()
            df_part = df_part[df_part["level"] == level]

            if election:
                df_part = df_part[df_part["election"] == election]

            year = filters.get("year")
            if year:
                df_part = df_part[df_part["year"] == int(year)]
            elif not df_part.empty and "year" in df_part.columns:
                latest_year = df_part["year"].max()
                df_part = df_part[df_part["year"] == latest_year]

            # Merge with units for metadata / other features
            df_units = self._get_units()
            df_units = df_units[df_units["level"] == level]
            df = df_part.merge(
                df_units,
                left_on="unit_id",
                right_on="id",
                how="left",
                suffixes=("", "_unit"),
            )
        else:
            df = self._get_units().copy()
            df = df[df["level"] == level]
            # Copy wide column values to metric aliases if present
            for orig_m, wide_c in alias_map.items():
                if wide_c in df.columns:
                    df[orig_m] = df[wide_c]

        # Resolve CCPC metrics from ccpc_features.parquet if requested
        ccpc_keys = {
            "pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp",
            "pct_ln_rural", "pct_ln_urbana", "ns_rate", "part_pj_2025"
        }
        ccpc_requested = [m for m in metrics if m in ccpc_keys]
        if ccpc_requested:
            feat_df = self._get_ccpc_features()
            if not feat_df.empty and "year" in feat_df.columns:
                target_yr = filters.get("year")
                if target_yr is None:
                    if "part_pj_2025" in ccpc_requested:
                        target_yr = 2025
                    else:
                        dip_years = sorted([int(y) for y in feat_df["year"].dropna().unique() if int(y) <= 2024])
                        target_yr = dip_years[-1] if dip_years else 2024
                yr_feat = feat_df[feat_df["year"] == int(target_yr)]
                if not yr_feat.empty:
                    if level == "mun":
                        mun_feat = yr_feat[yr_feat["level"] == "mun"] if "level" in yr_feat.columns else yr_feat
                        join_col = "cvegeo" if "cvegeo" in mun_feat.columns else "id"
                        for m in ccpc_requested:
                            if m in mun_feat.columns and (m not in df.columns or df[m].isna().all()):
                                v_map = dict(zip(mun_feat[join_col].astype(str), mun_feat[m]))
                                id_col = "cvegeo" if "cvegeo" in df.columns else ("unit_id" if "unit_id" in df.columns else "id")
                                df[m] = df[id_col].astype(str).map(v_map).astype(float)
                    elif level == "state":
                        st_feat = yr_feat[yr_feat["level"] == "state"] if "level" in yr_feat.columns else pd.DataFrame()
                        for m in ccpc_requested:
                            if not st_feat.empty and m in st_feat.columns:
                                join_col = "cvegeo" if "cvegeo" in st_feat.columns else ("cve_ent" if "cve_ent" in st_feat.columns else "id")
                                st_map = dict(zip(st_feat[join_col].astype(str).apply(lambda v: zpad(v, 2)), st_feat[m]))
                                id_col = "cve_ent" if "cve_ent" in df.columns else ("cvegeo" if "cvegeo" in df.columns else "id")
                                df[m] = df[id_col].astype(str).apply(lambda v: zpad(v, 2)).map(st_map).astype(float)
                            elif m in yr_feat.columns and (m not in df.columns or df[m].isna().all()):
                                if "cve_ent" in yr_feat.columns:
                                    st_map = yr_feat.groupby("cve_ent")[m].mean().to_dict()
                                    id_col = "cve_ent" if "cve_ent" in df.columns else ("cvegeo" if "cvegeo" in df.columns else "id")
                                    df[m] = df[id_col].astype(str).apply(lambda v: zpad(v, 2)).map(st_map).astype(float)
            # Fallback to _last columns if present
            for m in ccpc_requested:
                if (m not in df.columns or df[m].isna().all()) and f"{m}_last" in df.columns:
                    df[m] = df[f"{m}_last"]

        # Apply common filters
        if "cve_ent" in filters:
            val = filters["cve_ent"]
            if isinstance(val, list):
                df = df[df["cve_ent"].isin([zpad(x, 2) for x in val])]
            else:
                df = df[df["cve_ent"] == zpad(val, 2)]

        if "category" in filters and "category" in df.columns:
            val = filters["category"]
            cats = val if isinstance(val, list) else [val]
            df = df[df["category"].isin(cats)]

        if "gm_2020" in filters and "gm_2020" in df.columns:
            val = filters["gm_2020"]
            gms = val if isinstance(val, list) else [val]
            df = df[df["gm_2020"].isin(gms)]

        if "ids" in filters:
            id_col = "unit_id" if "unit_id" in df.columns else "id"
            df = df[df[id_col].isin(filters["ids"])]

        # Range filters
        for k, v in filters.items():
            if isinstance(v, dict) and k in df.columns:
                series = pd.to_numeric(df[k], errors="coerce")
                if "gte" in v:
                    df = df[series >= v["gte"]]
                if "lte" in v:
                    df = df[series <= v["lte"]]
                if "gt" in v:
                    df = df[series > v["gt"]]
                if "lt" in v:
                    df = df[series < v["lt"]]

        return df

    def top(
        self,
        metric: str,
        *,
        level: str = "mun",
        filters: dict | None = None,
        order: str = "desc",
        limit: int = 10,
    ) -> list[dict]:
        df = self._resolve_data_and_filters([metric], level, filters)
        if df.empty or metric not in df.columns:
            return []

        df["_metric_num"] = pd.to_numeric(df[metric], errors="coerce")
        df = df[df["_metric_num"].notna()]
        ascending = order.lower() == "asc"
        df = df.sort_values(by="_metric_num", ascending=ascending).head(limit)

        results = []
        for _, row in df.iterrows():
            u_id = row.get("unit_id") or row.get("id")
            res_item = {
                "id": str(u_id),
                "name": str(row.get("name", "")),
                "level": level,
                "cve_ent": str(row.get("cve_ent", "")),
                "value": float(row["_metric_num"]),
                metric: float(row["_metric_num"]),
            }
            results.append(res_item)
        return results

    def aggregate(
        self,
        metric: str,
        *,
        level: str = "mun",
        group_by: str | None = None,
        filters: dict | None = None,
        stat: str = "avg",
    ) -> list[dict]:
        df = self._resolve_data_and_filters([metric], level, filters)
        if df.empty or metric not in df.columns:
            return []

        df["_metric_num"] = pd.to_numeric(df[metric], errors="coerce")
        df = df[df["_metric_num"].notna()]
        if df.empty:
            return []

        stat_lower = stat.lower()
        stat_map = {
            "avg": "mean",
            "mean": "mean",
            "sum": "sum",
            "min": "min",
            "max": "max",
            "count": "count",
            "median": "median",
        }
        agg_func = stat_map.get(stat_lower, "mean")

        if group_by and group_by in df.columns:
            results = []
            for key, grp in df.groupby(group_by):
                vals = grp["_metric_num"]
                val = getattr(vals, agg_func)()
                results.append({
                    "key": str(key),
                    "value": float(val) if pd.notna(val) else None,
                    "count": int(vals.count()),
                })
            return results
        else:
            val = getattr(df["_metric_num"], agg_func)()
            return [{
                "key": "total",
                "value": float(val) if pd.notna(val) else None,
                "count": int(df["_metric_num"].count()),
            }]

    def correlation(
        self,
        fields: list[str],
        *,
        level: str = "mun",
        filters: dict | None = None,
    ) -> dict:
        df = self._resolve_data_and_filters(fields, level, filters)
        for f in fields:
            if f in df.columns:
                df[f] = pd.to_numeric(df[f], errors="coerce")
            else:
                df[f] = np.nan

        sub = df[fields].dropna()
        n = len(sub)
        matrix: dict[str, dict[str, float | None]] = {f1: {} for f1 in fields}

        if n >= 2:
            corr_df = sub.corr(method="pearson")
            for f1 in fields:
                for f2 in fields:
                    val = corr_df.loc[f1, f2] if (f1 in corr_df.index and f2 in corr_df.columns) else np.nan
                    matrix[f1][f2] = round(float(val), 4) if pd.notna(val) else None
        else:
            for f1 in fields:
                for f2 in fields:
                    matrix[f1][f2] = 1.0 if f1 == f2 else None

        return {"n": n, "fields": fields, "matrix": matrix}

    def stats(self) -> dict:
        units_df = self._get_units()
        part_df = self._get_participation()

        n_mun = int((units_df["level"] == "mun").sum()) if not units_df.empty and "level" in units_df.columns else 0
        n_state = int((units_df["level"] == "state").sum()) if not units_df.empty and "level" in units_df.columns else 0
        n_part = len(part_df)

        years = sorted(part_df["year"].dropna().unique().astype(int).tolist()) if not part_df.empty and "year" in part_df.columns else []
        elections = sorted(part_df["election"].dropna().unique().astype(str).tolist()) if not part_df.empty and "election" in part_df.columns else []

        return {
            "units_mun": n_mun,
            "units_state": n_state,
            "participation_rows": n_part,
            "years": years,
            "elections": elections,
        }

    def drivers(self, unit_id: str) -> list[dict]:
        if self._drivers_df is None:
            drivers_path = self.build_dir / "drivers.parquet"
            if drivers_path.is_file():
                self._drivers_df = pd.read_parquet(drivers_path)
            else:
                self._drivers_df = pd.DataFrame()
        if self._drivers_df.empty:
            return []
        uid_str = str(unit_id)
        id_col = "id" if "id" in self._drivers_df.columns else ("cvegeo" if "cvegeo" in self._drivers_df.columns else None)
        if not id_col:
            return []
        matches = self._drivers_df[self._drivers_df[id_col].astype(str) == uid_str]
        if matches.empty and "cvegeo" in self._drivers_df.columns and id_col != "cvegeo":
            matches = self._drivers_df[self._drivers_df["cvegeo"].astype(str) == uid_str]
        if matches.empty:
            return []
        if "rank" in matches.columns:
            matches = matches.sort_values(by="rank", ascending=True)
        elif "contribution_pp" in matches.columns:
            matches = matches.reindex(matches["contribution_pp"].abs().sort_values(ascending=False).index)
        results = []
        for _, r in matches.iterrows():
            d = {k: (None if pd.isna(v) else v) for k, v in r.to_dict().items()}
            if "rank" in d and d["rank"] is not None:
                d["rank"] = int(d["rank"])
            if "contribution_pp" in d and d["contribution_pp"] is not None:
                d["contribution_pp"] = float(d["contribution_pp"])
            results.append(d)
        return results

    def metrics(self) -> dict:
        metrics_file = self.build_dir / "metrics.json"
        if metrics_file.is_file():
            try:
                return json.loads(metrics_file.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("Could not read metrics.json: %s", exc)
                return {}
        return {}

    def _load_profile(self) -> pd.DataFrame:
        prof_path = self.build_dir / "ccpc_profile_mun.parquet"
        if not prof_path.is_file():
            return pd.DataFrame()
        try:
            df = pd.read_parquet(prof_path)
            if "cve_ent" in df.columns:
                df["cve_ent"] = df["cve_ent"].apply(lambda v: zpad(v, 2))
            return df
        except Exception as exc:
            logger.warning("Error reading ccpc_profile_mun.parquet: %s", exc)
            return pd.DataFrame()

    def _get_profile(self) -> pd.DataFrame:
        if self._profile_df is None:
            self._profile_df = self._load_profile()
        return self._profile_df

    def _load_ccpc_features(self) -> pd.DataFrame:
        feat_path = self.build_dir / "ccpc_features.parquet"
        if not feat_path.is_file():
            return pd.DataFrame()
        try:
            df = pd.read_parquet(feat_path)
            if "cve_ent" in df.columns:
                df["cve_ent"] = df["cve_ent"].apply(lambda v: zpad(v, 2))
            return df
        except Exception as exc:
            logger.warning("Error reading ccpc_features.parquet: %s", exc)
            return pd.DataFrame()

    def _get_ccpc_features(self) -> pd.DataFrame:
        if self._ccpc_features_df is None:
            self._ccpc_features_df = self._load_ccpc_features()
        return self._ccpc_features_df

    def profile(self, unit_id: str, year: int | None = None) -> list[dict]:
        df = self._get_profile()
        if df.empty:
            return []

        uid_str = str(unit_id).strip()
        is_state = len(uid_str) == 2 or uid_str in [f"{i:02d}" for i in range(1, 33)]

        if is_state:
            ent = zpad(uid_str, 2)
            sub = df[df["cve_ent"] == ent]
            if sub.empty:
                return []
            if year is not None:
                sub = sub[sub["year"] == int(year)]
            if sub.empty:
                return []

            sum_cols = [c for c in ["ln", "sv", "nv", "ns"] if c in sub.columns]
            grouped = sub.groupby(["year", "age_group", "sexo"], as_index=False)[sum_cols].sum()
            sv_col = grouped["sv"] if "sv" in grouped.columns else 0
            nv_col = grouped["nv"] if "nv" in grouped.columns else 0
            denom = sv_col + nv_col
            with np.errstate(divide="ignore", invalid="ignore"):
                grouped["participacion"] = np.where(denom > 0, np.clip(sv_col / denom, 0.0, 1.0), np.nan)

            grouped = grouped.sort_values(by=["year", "age_group", "sexo"], ascending=True)
            results = []
            for _, r in grouped.iterrows():
                p = r.get("participacion")
                results.append({
                    "year": int(r["year"]),
                    "age_group": str(r["age_group"]),
                    "sexo": str(r["sexo"]),
                    "ln": int(r.get("ln", 0)),
                    "sv": int(r.get("sv", 0)),
                    "nv": int(r.get("nv", 0)),
                    "ns": int(r.get("ns", 0)),
                    "participacion": round(float(p), 6) if pd.notna(p) else None,
                })
            return results
        else:
            id_col = "cvegeo" if "cvegeo" in df.columns else ("unit_id" if "unit_id" in df.columns else "id")
            sub = df[df[id_col].astype(str) == uid_str]
            if sub.empty and "id" in df.columns and id_col != "id":
                sub = df[df["id"].astype(str) == uid_str]
            if sub.empty:
                return []
            if year is not None:
                sub = sub[sub["year"] == int(year)]
            if sub.empty:
                return []

            sub = sub.sort_values(by=["year", "age_group", "sexo"], ascending=True)
            results = []
            for _, r in sub.iterrows():
                sv = float(r.get("sv", 0))
                nv = float(r.get("nv", 0))
                part = sv / (sv + nv) if (sv + nv) > 0 else (r.get("participacion") if "participacion" in r else None)
                results.append({
                    "year": int(r["year"]),
                    "age_group": str(r["age_group"]),
                    "sexo": str(r["sexo"]),
                    "ln": int(r.get("ln", 0)),
                    "sv": int(sv),
                    "nv": int(nv),
                    "ns": int(r.get("ns", 0)),
                    "participacion": round(float(part), 6) if (part is not None and pd.notna(part)) else None,
                })
            return results

    def ccpc_features(self, unit_id: str, year: int | None = None) -> dict | None:
        df = self._get_ccpc_features()
        if df.empty:
            return None
        uid_str = str(unit_id).strip()
        is_state = len(uid_str) == 2 or uid_str in [f"{i:02d}" for i in range(1, 33)]

        if year is not None:
            target_yr = int(year)
        else:
            dip_years = sorted([int(y) for y in df["year"].dropna().unique() if int(y) <= 2024])
            target_yr = dip_years[-1] if dip_years else 2024

        yr_feat = df[df["year"] == target_yr]
        if yr_feat.empty:
            return None

        if is_state:
            ent = zpad(uid_str, 2)
            if "level" in yr_feat.columns:
                st_match = yr_feat[(yr_feat["level"] == "state") & ((yr_feat["cvegeo"] == ent) | (yr_feat["cve_ent"] == ent))]
                if not st_match.empty:
                    row = st_match.iloc[0].to_dict()
                    return {k: (None if pd.isna(v) else v) for k, v in row.items()}
            elif "cvegeo" in yr_feat.columns:
                st_match = yr_feat[yr_feat["cvegeo"] == ent]
                if not st_match.empty:
                    row = st_match.iloc[0].to_dict()
                    return {k: (None if pd.isna(v) else v) for k, v in row.items()}

            if "cve_ent" in yr_feat.columns:
                mun_sub = yr_feat[yr_feat["cve_ent"] == ent]
                if not mun_sub.empty:
                    mean_dict: dict[str, Any] = {"cve_ent": ent, "cvegeo": ent, "level": "state", "year": target_yr}
                    for col in ["pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp", "pct_ln_rural", "pct_ln_urbana", "ns_rate", "part_pj_2025"]:
                        if col in mun_sub.columns:
                            val = pd.to_numeric(mun_sub[col], errors="coerce").mean()
                            mean_dict[col] = float(val) if pd.notna(val) else None
                    return mean_dict
            return None
        else:
            id_col = "cvegeo" if "cvegeo" in yr_feat.columns else ("id" if "id" in yr_feat.columns else None)
            if not id_col:
                return None
            matches = yr_feat[yr_feat[id_col].astype(str) == uid_str]
            if matches.empty and "cvegeo" in yr_feat.columns and id_col != "cvegeo":
                matches = yr_feat[yr_feat["cvegeo"].astype(str) == uid_str]
            if matches.empty:
                return None
            row = matches.iloc[0].to_dict()
            return {k: (None if pd.isna(v) else v) for k, v in row.items()}


class EsStore:
    """DataStore backed by Elasticsearch (Huawei CSS)."""

    kind: str = "es"

    def __init__(self):
        self.settings = get_settings()

    def healthy(self) -> bool:
        return ping_es(timeout_s=self.settings.es_timeout_s)

    def _client(self):
        es = get_es()
        if es is None:
            raise StoreError("Elasticsearch client is not configured")
        return es

    def units(self, level: str = "mun", ent: str | None = None) -> pd.DataFrame:
        es = self._client()
        idx = index_name("units")
        query: dict[str, Any] = {"bool": {"filter": []}}
        if level:
            query["bool"]["filter"].append({"term": {"level": level}})
        if ent:
            query["bool"]["filter"].append({"term": {"cve_ent": zpad(ent, 2)}})

        try:
            hits = scan(
                es,
                index=idx,
                query={"query": query},
                request_timeout=self.settings.es_timeout_s,
            )
            rows = [hit["_source"] for hit in hits]
            return pd.DataFrame(rows)
        except Exception as e:
            raise StoreError(f"Error reading units from ES: {e}") from e

    def unit(self, unit_id: str) -> dict | None:
        es = self._client()
        idx = index_name("units")
        try:
            resp = es.get(index=idx, id=str(unit_id), ignore=[404], request_timeout=self.settings.es_timeout_s)
            if resp.get("found"):
                return resp["_source"]
            return None
        except Exception as e:
            raise StoreError(f"Error fetching unit {unit_id} from ES: {e}") from e

    def participation(
        self,
        unit_ids: list[str] | None = None,
        *,
        level: str = "mun",
        election: str | None = "DIP_FED",
        years: list[int] | None = None,
    ) -> pd.DataFrame:
        es = self._client()
        idx = index_name("participation")
        filters: list[dict] = []
        if level:
            filters.append({"term": {"level": level}})
        if election:
            filters.append({"term": {"election": election}})
        if unit_ids:
            filters.append({"terms": {"unit_id": unit_ids}})
        if years:
            filters.append({"terms": {"year": years}})

        query = {"query": {"bool": {"filter": filters}}} if filters else {"query": {"match_all": {}}}
        try:
            hits = scan(es, index=idx, query=query, request_timeout=self.settings.es_timeout_s)
            rows = [h["_source"] for h in hits]
            return pd.DataFrame(rows)
        except Exception as e:
            raise StoreError(f"Error reading participation from ES: {e}") from e

    def search_units(self, text: str, *, level: str | None = None, size: int = 5) -> list[dict]:
        es = self._client()
        idx = index_name("units")
        filters = []
        if level:
            filters.append({"term": {"level": level}})

        body = {
            "size": size,
            "query": {
                "bool": {
                    "must": [
                        {
                            "multi_match": {
                                "query": text,
                                "fields": ["name^2", "name_norm"],
                                "fuzziness": "AUTO",
                            }
                        }
                    ],
                    "filter": filters,
                }
            },
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                src = h["_source"]
                results.append({
                    "id": src.get("id"),
                    "name": src.get("name"),
                    "level": src.get("level"),
                    "cve_ent": src.get("cve_ent"),
                    "score": round(float(h["_score"]), 4),
                })
            return results
        except Exception as e:
            raise StoreError(f"Error searching units in ES: {e}") from e

    def search_catalog(self, text: str, size: int = 5) -> list[dict]:
        es = self._client()
        idx = index_name("catalog")
        body = {
            "size": size,
            "query": {
                "multi_match": {
                    "query": text,
                    "fields": ["label_es^2", "description"],
                }
            },
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                item = dict(h["_source"])
                item["score"] = round(float(h["_score"]), 4)
                results.append(item)
            return results
        except Exception as e:
            raise StoreError(f"Error searching catalog in ES: {e}") from e

    def _build_es_filter(self, filters: dict | None, level: str) -> list[dict]:
        filters = filters or {}
        es_filters: list[dict] = [{"term": {"level": level}}]

        if "cve_ent" in filters:
            v = filters["cve_ent"]
            if isinstance(v, list):
                es_filters.append({"terms": {"cve_ent": [zpad(x, 2) for x in v]}})
            else:
                es_filters.append({"term": {"cve_ent": zpad(v, 2)}})

        if "category" in filters:
            v = filters["category"]
            cats = v if isinstance(v, list) else [v]
            es_filters.append({"terms": {"category": cats}})

        if "gm_2020" in filters:
            v = filters["gm_2020"]
            gms = v if isinstance(v, list) else [v]
            es_filters.append({"terms": {"gm_2020": gms}})

        if "ids" in filters:
            es_filters.append({"terms": {"id": filters["ids"]}})

        for k, v in filters.items():
            if isinstance(v, dict):
                rng = {}
                for op in ["gte", "lte", "gt", "lt"]:
                    if op in v:
                        rng[op] = v[op]
                if rng:
                    es_filters.append({"range": {k: rng}})

        return es_filters

    @functools.lru_cache(maxsize=8)
    def _get_latest_part_year(self, election: str = "DIP_FED") -> int:
        es = self._client()
        idx = index_name("participation")
        body = {
            "size": 0,
            "query": {"term": {"election": election}},
            "aggs": {"max_year": {"max": {"field": "year"}}},
        }
        try:
            res = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            val = res.get("aggregations", {}).get("max_year", {}).get("value")
            return int(val) if val is not None else 2024
        except Exception:
            return 2024

    def reload(self) -> None:
        if hasattr(self._get_latest_part_year, "cache_clear"):
            self._get_latest_part_year.cache_clear()

    def drivers(self, unit_id: str) -> list[dict]:
        doc = self.unit(unit_id)
        if doc and "drivers" in doc and isinstance(doc["drivers"], list):
            return doc["drivers"]
        return []

    def metrics(self) -> dict:
        metrics_file = BUILD_DIR / "metrics.json"
        if metrics_file.is_file():
            try:
                return json.loads(metrics_file.read_text(encoding="utf-8"))
            except Exception as exc:
                logger.warning("Could not read metrics.json: %s", exc)
                return {}
        return {}

    def profile(self, unit_id: str, year: int | None = None) -> list[dict]:
        es = self._client()
        idx = index_name("profile")
        filters: list[dict] = [{"term": {"unit_id": str(unit_id)}}]
        if year is not None:
            filters.append({"term": {"year": int(year)}})

        body = {
            "size": 1000,
            "query": {"bool": {"filter": filters}},
            "sort": [{"year": "asc"}, {"age_group": "asc"}, {"sexo": "asc"}],
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                src = h["_source"]
                p = src.get("participacion")
                results.append({
                    "year": int(src.get("year", 0)),
                    "age_group": str(src.get("age_group", "")),
                    "sexo": str(src.get("sexo", "")),
                    "ln": int(src.get("ln", 0)),
                    "sv": int(src.get("sv", 0)),
                    "nv": int(src.get("nv", 0)),
                    "ns": int(src.get("ns", 0)),
                    "participacion": round(float(p), 6) if p is not None else None,
                })
            return results
        except Exception as e:
            logger.warning("Error fetching profile from ES: %s", e)
            return []

    def ccpc_features(self, unit_id: str, year: int | None = None) -> dict | None:
        feat_path = BUILD_DIR / "ccpc_features.parquet"
        if feat_path.is_file():
            try:
                df = pd.read_parquet(feat_path)
                if "cve_ent" in df.columns:
                    df["cve_ent"] = df["cve_ent"].apply(lambda v: zpad(v, 2))
                uid_str = str(unit_id).strip()
                is_state = len(uid_str) == 2 or uid_str in [f"{i:02d}" for i in range(1, 33)]

                if year is not None:
                    target_yr = int(year)
                else:
                    dip_years = sorted([int(y) for y in df["year"].dropna().unique() if int(y) <= 2024])
                    target_yr = dip_years[-1] if dip_years else 2024

                yr_feat = df[df["year"] == target_yr]
                if yr_feat.empty:
                    return None

                if is_state:
                    ent = zpad(uid_str, 2)
                    if "level" in yr_feat.columns:
                        st_match = yr_feat[(yr_feat["level"] == "state") & ((yr_feat["cvegeo"] == ent) | (yr_feat["cve_ent"] == ent))]
                        if not st_match.empty:
                            row = st_match.iloc[0].to_dict()
                            return {k: (None if pd.isna(v) else v) for k, v in row.items()}
                    elif "cvegeo" in yr_feat.columns:
                        st_match = yr_feat[yr_feat["cvegeo"] == ent]
                        if not st_match.empty:
                            row = st_match.iloc[0].to_dict()
                            return {k: (None if pd.isna(v) else v) for k, v in row.items()}

                    if "cve_ent" in yr_feat.columns:
                        mun_sub = yr_feat[yr_feat["cve_ent"] == ent]
                        if not mun_sub.empty:
                            mean_dict: dict[str, Any] = {"cve_ent": ent, "cvegeo": ent, "level": "state", "year": target_yr}
                            for col in ["pct_ln_18_34", "part_18_34", "gap_youth_pp", "gap_sexo_pp", "pct_ln_rural", "pct_ln_urbana", "ns_rate", "part_pj_2025"]:
                                if col in mun_sub.columns:
                                    val = pd.to_numeric(mun_sub[col], errors="coerce").mean()
                                    mean_dict[col] = float(val) if pd.notna(val) else None
                            return mean_dict
                    return None
                else:
                    id_col = "cvegeo" if "cvegeo" in yr_feat.columns else ("id" if "id" in yr_feat.columns else None)
                    if not id_col:
                        return None
                    matches = yr_feat[yr_feat[id_col].astype(str) == uid_str]
                    if matches.empty and "cvegeo" in yr_feat.columns and id_col != "cvegeo":
                        matches = yr_feat[yr_feat["cvegeo"].astype(str) == uid_str]
                    if matches.empty:
                        return None
                    row = matches.iloc[0].to_dict()
                    return {k: (None if pd.isna(v) else v) for k, v in row.items()}
            except Exception as e:
                logger.warning("Error reading ccpc_features in EsStore: %s", e)
                return None
        return None

    def top(
        self,
        metric: str,
        *,
        level: str = "mun",
        filters: dict | None = None,
        order: str = "desc",
        limit: int = 10,
    ) -> list[dict]:
        es = self._client()
        filters = filters or {}
        election = filters.get("election", "DIP_FED")
        target_field = metric

        if metric in ("participacion", "abstencion") and election == "DIP_FED":
            idx = index_name("units")
            es_filters = self._build_es_filter(filters, level)
            yr = filters.get("year") or self._get_latest_part_year("DIP_FED")
            target_field = f"part_dip_{yr}" if metric == "participacion" else f"abst_dip_{yr}"
        elif metric in PARTICIPATION_METRICS:
            idx = index_name("participation")
            es_filters = self._build_es_filter(filters, level)
            yr = filters.get("year") or self._get_latest_part_year(election)
            es_filters.append({"term": {"year": yr}})
            es_filters.append({"term": {"election": election}})
        else:
            idx = index_name("units")
            es_filters = self._build_es_filter(filters, level)

        sort_dir = "desc" if order.lower() == "desc" else "asc"
        body = {
            "size": limit,
            "query": {"bool": {"filter": es_filters}},
            "sort": [{target_field: {"order": sort_dir}}],
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                src = h["_source"]
                val = src.get(target_field) if target_field in src else src.get(metric)
                results.append({
                    "id": src.get("unit_id") or src.get("id"),
                    "name": src.get("name", ""),
                    "level": level,
                    "cve_ent": src.get("cve_ent", ""),
                    "value": float(val) if val is not None else None,
                    metric: float(val) if val is not None else None,
                    target_field: float(val) if val is not None else None,
                })
            return results
        except Exception as e:
            raise StoreError(f"Error computing top for {metric} in ES: {e}") from e

    def aggregate(
        self,
        metric: str,
        *,
        level: str = "mun",
        group_by: str | None = None,
        filters: dict | None = None,
        stat: str = "avg",
    ) -> list[dict]:
        es = self._client()
        filters = filters or {}
        election = filters.get("election", "DIP_FED")
        target_field = metric

        if metric in ("participacion", "abstencion") and election == "DIP_FED":
            idx = index_name("units")
            es_filters = self._build_es_filter(filters, level)
            yr = filters.get("year") or self._get_latest_part_year("DIP_FED")
            target_field = f"part_dip_{yr}" if metric == "participacion" else f"abst_dip_{yr}"
        elif metric in PARTICIPATION_METRICS:
            idx = index_name("participation")
            es_filters = self._build_es_filter(filters, level)
            yr = filters.get("year") or self._get_latest_part_year(election)
            es_filters.append({"term": {"year": yr}})
            es_filters.append({"term": {"election": election}})
        else:
            idx = index_name("units")
            es_filters = self._build_es_filter(filters, level)

        stat_map = {
            "avg": "avg",
            "mean": "avg",
            "sum": "sum",
            "min": "min",
            "max": "max",
            "count": "value_count",
            "median": "percentiles",
        }
        es_stat = stat_map.get(stat.lower(), "avg")
        stat_body: dict[str, Any] = {"field": target_field}
        if es_stat == "percentiles":
            stat_body["percents"] = [50]

        if group_by:
            aggs = {
                "by_group": {
                    "terms": {"field": group_by, "size": 1000},
                    "aggs": {"stat_val": {es_stat: stat_body}},
                }
            }
        else:
            aggs = {"stat_val": {es_stat: stat_body}}

        body = {
            "size": 0,
            "query": {"bool": {"filter": es_filters}},
            "aggs": aggs,
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            agg_resp = resp.get("aggregations", {})

            if group_by:
                buckets = agg_resp.get("by_group", {}).get("buckets", [])
                results = []
                for b in buckets:
                    val_obj = b.get("stat_val", {})
                    if es_stat == "percentiles":
                        val = val_obj.get("values", {}).get("50.0")
                    else:
                        val = val_obj.get("value")
                    results.append({
                        "key": str(b["key"]),
                        "value": float(val) if val is not None else None,
                        "count": b.get("doc_count", 0),
                    })
                return results
            else:
                val_obj = agg_resp.get("stat_val", {})
                if es_stat == "percentiles":
                    val = val_obj.get("values", {}).get("50.0")
                else:
                    val = val_obj.get("value")
                return [{
                    "key": "total",
                    "value": float(val) if val is not None else None,
                    "count": resp.get("hits", {}).get("total", {}).get("value", 0),
                }]
        except Exception as e:
            raise StoreError(f"Error aggregating {metric} in ES: {e}") from e

    def correlation(
        self,
        fields: list[str],
        *,
        level: str = "mun",
        filters: dict | None = None,
    ) -> dict:
        es = self._client()
        idx = index_name("units")
        es_filters = self._build_es_filter(filters, level)
        filters = filters or {}
        election = filters.get("election", "DIP_FED")

        es_fields = []
        field_alias_map = {}
        for f in fields:
            if f in ("participacion", "abstencion") and election == "DIP_FED":
                yr = filters.get("year") or self._get_latest_part_year("DIP_FED")
                translated = f"part_dip_{yr}" if f == "participacion" else f"abst_dip_{yr}"
                es_fields.append(translated)
                field_alias_map[translated] = f
            else:
                es_fields.append(f)
                field_alias_map[f] = f

        body = {
            "size": 0,
            "query": {"bool": {"filter": es_filters}},
            "aggs": {
                "matrix": {
                    "matrix_stats": {
                        "fields": es_fields
                    }
                }
            },
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            matrix_agg = resp.get("aggregations", {}).get("matrix", {})
            doc_count = matrix_agg.get("doc_count", 0)
            fields_res = matrix_agg.get("fields", [])

            corr_matrix: dict[str, dict[str, float | None]] = {f: {} for f in fields}
            res_dict = {item["name"]: item.get("correlation", {}) for item in fields_res}

            for f1 in fields:
                for f2 in fields:
                    if f1 == f2:
                        corr_matrix[f1][f2] = 1.0
                    else:
                        t1 = next((k for k, v in field_alias_map.items() if v == f1), f1)
                        t2 = next((k for k, v in field_alias_map.items() if v == f2), f2)
                        val = res_dict.get(t1, {}).get(t2)
                        corr_matrix[f1][f2] = round(float(val), 4) if val is not None else None

            return {"n": doc_count, "fields": fields, "matrix": corr_matrix}
        except Exception as e:
            raise StoreError(f"Error computing correlation in ES: {e}") from e

    def stats(self) -> dict:
        es = self._client()
        try:
            units_idx = index_name("units")
            part_idx = index_name("participation")

            u_resp = es.search(
                index=units_idx,
                body={
                    "size": 0,
                    "aggs": {"by_level": {"terms": {"field": "level"}}},
                },
                request_timeout=self.settings.es_timeout_s,
            )
            buckets = u_resp.get("aggregations", {}).get("by_level", {}).get("buckets", [])
            level_counts = {b["key"]: b["doc_count"] for b in buckets}

            p_resp = es.search(
                index=part_idx,
                body={
                    "size": 0,
                    "aggs": {
                        "years": {"terms": {"field": "year", "size": 100}},
                        "elections": {"terms": {"field": "election", "size": 100}},
                    },
                },
                request_timeout=self.settings.es_timeout_s,
            )
            p_total = p_resp.get("hits", {}).get("total", {}).get("value", 0)
            y_buckets = p_resp.get("aggregations", {}).get("years", {}).get("buckets", [])
            e_buckets = p_resp.get("aggregations", {}).get("elections", {}).get("buckets", [])

            return {
                "units_mun": level_counts.get("mun", 0),
                "units_state": level_counts.get("state", 0),
                "participation_rows": p_total,
                "years": sorted([int(b["key"]) for b in y_buckets]),
                "elections": sorted([str(b["key"]) for b in e_buckets]),
            }
        except Exception as e:
            raise StoreError(f"Error computing stats in ES: {e}") from e


@functools.lru_cache(maxsize=1)
def get_store() -> DataStore:
    """Retrieve configured DataStore instance according to store_mode."""
    settings = get_settings()
    mode = settings.store_mode.lower()

    if mode == "memory":
        return PandasStore()
    elif mode == "es":
        return EsStore()
    elif mode == "auto":
        if ping_es(timeout_s=3.0):
            try:
                es = get_es()
                if es and es.indices.exists(index=index_name("units")):
                    return EsStore()
            except Exception:
                pass
        return PandasStore()

    return PandasStore()
