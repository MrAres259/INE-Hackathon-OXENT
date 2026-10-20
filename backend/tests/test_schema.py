"""Unit tests for atalaya.schema."""

from __future__ import annotations

from typing import Any
import pytest
from atalaya.schema import ANALYSIS, SCHEMA_VERSION, TEMPLATES, template_body


def test_schema_version_and_templates_present():
    assert SCHEMA_VERSION == 2
    assert set(TEMPLATES.keys()) == {"units", "participation", "catalog", "profile"}


def test_analysis_structure():
    assert "normalizer" in ANALYSIS
    assert "folded_kw" in ANALYSIS["normalizer"]
    assert ANALYSIS["normalizer"]["folded_kw"]["filter"] == ["lowercase", "asciifolding"]

    assert "analyzer" in ANALYSIS
    assert "es_folded" in ANALYSIS["analyzer"]
    assert "es_prefix" in ANALYSIS["analyzer"]
    assert ANALYSIS["analyzer"]["es_folded"]["tokenizer"] == "standard"
    assert "spanish_stop" in ANALYSIS["analyzer"]["es_folded"]["filter"]
    assert "spanish_stemmer" in ANALYSIS["analyzer"]["es_folded"]["filter"]

    assert "filter" in ANALYSIS
    assert "spanish_stop" in ANALYSIS["filter"]
    assert ANALYSIS["filter"]["spanish_stop"]["stopwords"] == "_spanish_"
    assert "spanish_stemmer" in ANALYSIS["filter"]
    assert ANALYSIS["filter"]["spanish_stemmer"]["language"] == "light_spanish"


def test_template_body_compilation():
    sample_settings = {
        "number_of_shards": 1,
        "number_of_replicas": 0,
        "refresh_interval": "1s",
        "max_result_window": 10000,
    }

    for kind in TEMPLATES:
        body = template_body(kind, prefix="atalaya-", settings=sample_settings)

        assert body["priority"] == 200
        assert body["index_patterns"] == [f"atalaya-{kind}-*"]
        assert body["index_patterns"][0].endswith("-*")
        assert body["_meta"] == {
            "app": "atalaya",
            "schema_version": 2,
        }

        template_sec = body["template"]
        settings_sec = template_sec["settings"]
        assert settings_sec["number_of_shards"] == 1
        assert settings_sec["number_of_replicas"] == 0
        assert settings_sec["analysis"] == ANALYSIS
        assert template_sec["mappings"] == TEMPLATES[kind]


def test_template_body_unknown_kind():
    with pytest.raises(KeyError, match="Unknown template kind"):
        template_body("nonexistent_kind", prefix="atalaya-", settings={})


def _extract_analyzers_and_normalizers(obj: Any) -> tuple[set[str], set[str]]:
    analyzers: set[str] = set()
    normalizers: set[str] = set()

    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "analyzer" and isinstance(v, str):
                analyzers.add(v)
            elif k == "normalizer" and isinstance(v, str):
                normalizers.add(v)
            else:
                a, n = _extract_analyzers_and_normalizers(v)
                analyzers |= a
                normalizers |= n
    elif isinstance(obj, list):
        for item in obj:
            a, n = _extract_analyzers_and_normalizers(item)
            analyzers |= a
            normalizers |= n

    return analyzers, normalizers


def test_all_analyzers_and_normalizers_defined():
    defined_analyzers = set(ANALYSIS.get("analyzer", {}).keys())
    defined_normalizers = set(ANALYSIS.get("normalizer", {}).keys())

    for kind, mapping in TEMPLATES.items():
        used_analyzers, used_normalizers = _extract_analyzers_and_normalizers(mapping)

        # Every normalizer must be explicitly defined in ANALYSIS
        for norm in used_normalizers:
            assert norm in defined_normalizers, f"Normalizer '{norm}' in template '{kind}' is not defined in ANALYSIS"

        # Every custom analyzer used in mapping must be in ANALYSIS
        for anz in used_analyzers:
            assert anz in defined_analyzers, f"Analyzer '{anz}' in template '{kind}' is not defined in ANALYSIS"


def test_field_specific_subfields_and_analyzers():
    # units
    units_props = TEMPLATES["units"]["properties"]
    assert units_props["name"]["type"] == "text"
    assert units_props["name"]["analyzer"] == "es_folded"
    assert units_props["name"]["fields"]["kw"]["type"] == "keyword"
    assert units_props["name"]["fields"]["kw"]["normalizer"] == "folded_kw"
    assert units_props["name"]["fields"]["sayt"]["type"] == "search_as_you_type"
    assert units_props["name"]["fields"]["sayt"]["analyzer"] == "es_prefix"
    assert units_props["name_norm"]["type"] == "text"
    assert units_props["name_norm"]["analyzer"] == "es_prefix"
    assert TEMPLATES["units"]["dynamic"] == "true"
    assert len(TEMPLATES["units"]["dynamic_templates"]) == 5

    # catalog
    cat_props = TEMPLATES["catalog"]["properties"]
    assert cat_props["label_es"]["type"] == "text"
    assert cat_props["label_es"]["analyzer"] == "es_folded"
    assert cat_props["label_es"]["fields"]["kw"]["type"] == "keyword"
    assert cat_props["label_es"]["fields"]["kw"]["normalizer"] == "folded_kw"
    assert "sayt" not in cat_props["label_es"]["fields"]
    assert cat_props["description"]["type"] == "text"
    assert cat_props["description"]["analyzer"] == "es_folded"

    # participation & profile
    assert TEMPLATES["participation"]["dynamic"] == "false"
    assert TEMPLATES["profile"]["dynamic"] == "false"
