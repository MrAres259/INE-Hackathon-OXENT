"""Elasticsearch mapping templates and index schemas for ATALAYA."""

from __future__ import annotations

TEMPLATES: dict[str, dict] = {
    "units": {
        "dynamic": "false",
        "properties": {
            "id": {"type": "keyword"},
            "level": {"type": "keyword"},
            "cve_ent": {"type": "keyword"},
            "cve_mun": {"type": "keyword"},
            "cvegeo": {"type": "keyword"},
            "name": {
                "type": "text",
                "analyzer": "spanish",
                "fields": {
                    "kw": {"type": "keyword"}
                },
            },
            "name_norm": {
                "type": "text",
                "analyzer": "standard",
            },
            # Sociodemographic features (§4.3)
            "nom_ent": {"type": "keyword"},
            "nom_mun": {"type": "keyword"},
            "pob_tot": {"type": "long"},
            "pob_18ymas": {"type": "long"},
            "pct_18_24": {"type": "float"},
            "pct_65ymas": {"type": "float"},
            "graproes": {"type": "float"},
            "pct_hli": {"type": "float"},
            "pct_sin_servsalud": {"type": "float"},
            "pct_internet": {"type": "float"},
            "pct_rural": {"type": "float"},
            "pct_analfabeta": {"type": "float"},
            "pct_po2sm": {"type": "float"},
            "im_2020": {"type": "float"},
            "gm_2020": {"type": "keyword"},
            # Model & risk columns (§4.8)
            "lista_nominal": {"type": "long"},
            "last_year": {"type": "integer"},
            "last_participation": {"type": "float"},
            "pred_participation": {"type": "float"},
            "pred_abstention": {"type": "float"},
            "pred_low": {"type": "float"},
            "pred_high": {"type": "float"},
            "trend_pp": {"type": "float"},
            "volatility_pp": {"type": "float"},
            "risk_score": {"type": "float"},
            "category": {"type": "keyword"},
            # Optional geographic centroid
            "centroid": {"type": "geo_point"},
        },
    },
    "participation": {
        "dynamic": "false",
        "properties": {
            "id": {"type": "keyword"},
            "unit_id": {"type": "keyword"},
            "level": {"type": "keyword"},
            "cve_ent": {"type": "keyword"},
            "election": {"type": "keyword"},
            "year": {"type": "integer"},
            "lista_nominal": {"type": "long"},
            "votos_totales": {"type": "long"},
            "participacion": {"type": "float"},
            "abstencion": {"type": "float"},
        },
    },
    "catalog": {
        "dynamic": "false",
        "properties": {
            "key": {"type": "keyword"},
            "label_es": {
                "type": "text",
                "analyzer": "spanish",
                "fields": {
                    "kw": {"type": "keyword"}
                },
            },
            "description": {
                "type": "text",
                "analyzer": "spanish",
            },
            "source": {"type": "keyword"},
            "unit": {"type": "keyword"},
            "level": {"type": "keyword"},
        },
    },
}
