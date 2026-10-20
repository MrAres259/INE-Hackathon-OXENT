"""OpenSearch mapping templates and index schemas for ATALAYA."""

from __future__ import annotations

from typing import Any

SCHEMA_VERSION: int = 2

ANALYSIS: dict[str, Any] = {
    "normalizer": {
        "folded_kw": {
            "type": "custom",
            "filter": ["lowercase", "asciifolding"],
        },
    },
    "analyzer": {
        "es_folded": {
            "type": "custom",
            "tokenizer": "standard",
            "filter": [
                "lowercase",
                "asciifolding",
                "spanish_stop",
                "spanish_stemmer",
            ],
        },
        "es_prefix": {
            "type": "custom",
            "tokenizer": "standard",
            "filter": [
                "lowercase",
                "asciifolding",
            ],
        },
    },
    "filter": {
        "spanish_stop": {
            "type": "stop",
            "stopwords": "_spanish_",
        },
        "spanish_stemmer": {
            "type": "stemmer",
            "language": "light_spanish",
        },
    },
}

TEMPLATES: dict[str, dict] = {
    "units": {
        "dynamic": "true",
        "dynamic_templates": [
            {
                "part_dip_floats": {
                    "match": "part_dip_*",
                    "mapping": {"type": "float"},
                }
            },
            {
                "abst_dip_floats": {
                    "match": "abst_dip_*",
                    "mapping": {"type": "float"},
                }
            },
            {
                "strings_as_keywords": {
                    "match_mapping_type": "string",
                    "mapping": {"type": "keyword"},
                }
            },
            {
                "numbers_as_floats": {
                    "match_mapping_type": "double",
                    "mapping": {"type": "float"},
                }
            },
            {
                "long_numbers_as_floats": {
                    "match_mapping_type": "long",
                    "mapping": {"type": "float"},
                }
            },
        ],
        "properties": {
            "id": {"type": "keyword"},
            "level": {"type": "keyword"},
            "cve_ent": {"type": "keyword"},
            "cve_mun": {"type": "keyword"},
            "cvegeo": {"type": "keyword"},
            "name": {
                "type": "text",
                "analyzer": "es_folded",
                "fields": {
                    "kw": {
                        "type": "keyword",
                        "normalizer": "folded_kw",
                    },
                    "sayt": {
                        "type": "search_as_you_type",
                        "analyzer": "es_prefix",
                    },
                },
            },
            "name_norm": {
                "type": "text",
                "analyzer": "es_prefix",
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
            # Model & risk columns (§4.8 & §9.2)
            "lista_nominal": {"type": "long"},
            "coverage_ln": {"type": "float"},
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
            "drivers": {"type": "object", "enabled": False},
            # Geographic centroid
            "centroid": {"type": "geo_point"},
        },
    },
    "participation": {
        "dynamic": "false",
        "properties": {
            "id": {"type": "keyword"},
            "unit_id": {"type": "keyword"},
            "name": {"type": "keyword"},
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
                "analyzer": "es_folded",
                "fields": {
                    "kw": {
                        "type": "keyword",
                        "normalizer": "folded_kw",
                    },
                },
            },
            "description": {
                "type": "text",
                "analyzer": "es_folded",
            },
            "source": {"type": "keyword"},
            "unit": {"type": "keyword"},
            "level": {"type": "keyword"},
        },
    },
    "profile": {
        "dynamic": "false",
        "properties": {
            "id": {"type": "keyword"},
            "unit_id": {"type": "keyword"},
            "level": {"type": "keyword"},
            "cve_ent": {"type": "keyword"},
            "year": {"type": "integer"},
            "age_group": {"type": "keyword"},
            "sexo": {"type": "keyword"},
            "ln": {"type": "long"},
            "sv": {"type": "long"},
            "nv": {"type": "long"},
            "ns": {"type": "long"},
            "participacion": {"type": "float"},
        },
    },
}


def template_body(kind: str, prefix: str, settings: dict[str, Any]) -> dict[str, Any]:
    """Generate composite index template body for a given dataset kind."""
    if kind not in TEMPLATES:
        raise KeyError(f"Unknown template kind: '{kind}'")

    merged_settings = dict(settings)
    merged_settings["analysis"] = ANALYSIS

    return {
        "index_patterns": [f"{prefix}{kind}-*"],
        "priority": 200,
        "template": {
            "settings": merged_settings,
            "mappings": TEMPLATES[kind],
        },
        "_meta": {
            "app": "atalaya",
            "schema_version": SCHEMA_VERSION,
        },
    }
