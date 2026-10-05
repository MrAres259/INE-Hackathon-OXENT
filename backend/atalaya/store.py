"""DataStore implementations: PandasStore (offline/fallback) and EsStore (CSS cluster)."""

from __future__ import annotations

import difflib
import functools
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
                w = pd.to_numeric(group.get("pob_18ymas"), errors="coerce").fillna(0)

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
                    "pred_low", "pred_high", "trend_pp", "volatility_pp", "risk_score"
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

                if "category" in group.columns and pd.notna(row.get("risk_score")):
                    rs = row["risk_score"]
                    row["category"] = "rojo" if rs >= 75 else ("naranja" if rs >= 55 else ("amarillo" if rs >= 35 else "verde"))
                else:
                    row["category"] = "sin_dato"

                state_rows.append(row)

            if state_rows:
                state_df = pd.DataFrame(state_rows)
                df = pd.concat([df, state_df], ignore_index=True)

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
            grouped = mun_part.groupby(["cve_ent", "year", "election"], as_index=False)[
                ["lista_nominal", "votos_totales"]
            ].sum()

            grouped["unit_id"] = grouped["cve_ent"]
            grouped["cvegeo"] = grouped["cve_ent"]
            grouped["level"] = "state"
            with np.errstate(divide="ignore", invalid="ignore"):
                grouped["participacion"] = np.where(
                    grouped["lista_nominal"] > 0,
                    np.clip(grouped["votos_totales"] / grouped["lista_nominal"], 0.0, 1.0),
                    np.nan,
                )
            df = pd.concat([df, grouped], ignore_index=True)

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
        needs_part = any(m in PARTICIPATION_METRICS for m in metrics)

        if needs_part:
            df_part = self._get_participation().copy()
            df_part = df_part[df_part["level"] == level]

            election = filters.get("election", "DIP_FED")
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
            results.append({
                "id": str(u_id),
                "name": str(row.get("name", "")),
                "level": level,
                "cve_ent": str(row.get("cve_ent", "")),
                "value": float(row["_metric_num"]),
                metric: float(row["_metric_num"]),
            })
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
        idx = index_name("participation" if metric in PARTICIPATION_METRICS else "units")
        es_filters = self._build_es_filter(filters, level)
        if metric in PARTICIPATION_METRICS:
            if filters and "year" in filters:
                es_filters.append({"term": {"year": filters["year"]}})
            if filters and "election" in filters:
                es_filters.append({"term": {"election": filters["election"]}})

        sort_dir = "desc" if order.lower() == "desc" else "asc"
        body = {
            "size": limit,
            "query": {"bool": {"filter": es_filters}},
            "sort": [{metric: {"order": sort_dir}}],
        }
        try:
            resp = es.search(index=idx, body=body, request_timeout=self.settings.es_timeout_s)
            hits = resp.get("hits", {}).get("hits", [])
            results = []
            for h in hits:
                src = h["_source"]
                val = src.get(metric)
                results.append({
                    "id": src.get("unit_id") or src.get("id"),
                    "name": src.get("name", ""),
                    "level": level,
                    "cve_ent": src.get("cve_ent", ""),
                    "value": float(val) if val is not None else None,
                    metric: float(val) if val is not None else None,
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
        idx = index_name("participation" if metric in PARTICIPATION_METRICS else "units")
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
        stat_body: dict[str, Any] = {"field": metric}
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

        body = {
            "size": 0,
            "query": {"bool": {"filter": es_filters}},
            "aggs": {
                "matrix": {
                    "matrix_stats": {
                        "fields": fields
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
                        val = res_dict.get(f1, {}).get(f2)
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
