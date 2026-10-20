"""Unit tests for atalaya.load CLI and versioned OpenSearch index management."""

from __future__ import annotations

from pathlib import Path
import re
import sys
from typing import Any
import pytest

from atalaya.load import (
    assert_prefixed,
    load_kind,
    main,
    physical_versions,
    purge_prefixed,
    swap_alias,
    versioned_name,
)
from atalaya.store import PandasStore


# ---------------------------------------------------------------------------
# In-memory fake OpenSearch client simulating indices and count APIs
# ---------------------------------------------------------------------------

class FakeIndicesClient:
    def __init__(self) -> None:
        self.indices: dict[str, dict[str, Any]] = {}
        self.aliases: dict[str, set[str]] = {}
        self.index_templates: dict[str, dict[str, Any]] = {}
        self.templates: dict[str, dict[str, Any]] = {}
        self.calls: list[tuple[str, Any]] = []

    def create(self, index: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append(("create", index))
        self.indices[index] = {
            "settings": (body.get("settings", {}) if body else {}),
            "docs": [],
        }
        return {"acknowledged": True}

    def put_settings(self, index: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append(("put_settings", index))
        if index in self.indices:
            self.indices[index].setdefault("settings", {}).update(body or {})
        return {"acknowledged": True}

    def refresh(self, index: str | None = None) -> dict[str, Any]:
        self.calls.append(("refresh", index))
        return {"_shards": {"total": 1, "successful": 1, "failed": 0}}

    def exists(self, index: str) -> bool:
        return (index in self.indices) or (index in self.aliases and len(self.aliases[index]) > 0)

    def exists_alias(self, name: str) -> bool:
        return name in self.aliases and len(self.aliases[name]) > 0

    def get_alias(self, name: str | None = None, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("get_alias", name))
        if not name:
            return {}
        regex = re.compile("^" + re.escape(name).replace(r"\*", ".*") + "$")
        res: dict[str, Any] = {}
        for alias_name, idx_set in self.aliases.items():
            if regex.match(alias_name):
                for idx in idx_set:
                    res.setdefault(idx, {"aliases": {}})["aliases"][alias_name] = {}
        return res

    def delete_alias(self, index: str, name: str, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("delete_alias", (index, name)))
        if name in self.aliases and index in self.aliases[name]:
            self.aliases[name].remove(index)
            if not self.aliases[name]:
                del self.aliases[name]
        return {"acknowledged": True}

    def update_aliases(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("update_aliases", body))
        for action in body.get("actions", []):
            if "remove" in action:
                idx = action["remove"]["index"]
                alias = action["remove"]["alias"]
                if alias in self.aliases and idx in self.aliases[alias]:
                    self.aliases[alias].remove(idx)
                    if not self.aliases[alias]:
                        del self.aliases[alias]
            elif "add" in action:
                idx = action["add"]["index"]
                alias = action["add"]["alias"]
                self.aliases.setdefault(alias, set()).add(idx)
        return {"acknowledged": True}

    def delete(self, index: str, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("delete", index))
        if index in self.indices:
            del self.indices[index]
        for alias, targets in list(self.aliases.items()):
            if index in targets:
                targets.remove(index)
                if not targets:
                    del self.aliases[alias]
        return {"acknowledged": True}

    def get(self, index: str | None = None, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("get", index))
        if not index:
            return {idx: {} for idx in self.indices}
        res: dict[str, Any] = {}
        # Simple wildcard matcher
        regex = re.compile("^" + re.escape(index).replace(r"\*", ".*") + "$")
        for idx in self.indices:
            if regex.match(idx):
                res[idx] = {}
        return res

    def get_index_template(self, name: str | None = None, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("get_index_template", name))
        if not name:
            return {"index_templates": [{"name": k} for k in self.index_templates]}
        regex = re.compile("^" + re.escape(name).replace(r"\*", ".*") + "$")
        matched = [k for k in self.index_templates if regex.match(k)]
        return {"index_templates": [{"name": k} for k in matched]}

    def delete_index_template(self, name: str, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("delete_index_template", name))
        if name in self.index_templates:
            del self.index_templates[name]
        return {"acknowledged": True}

    def get_template(self, name: str | None = None, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("get_template", name))
        if not name:
            return {k: {} for k in self.templates}
        regex = re.compile("^" + re.escape(name).replace(r"\*", ".*") + "$")
        return {k: {} for k in self.templates if regex.match(k)}

    def delete_template(self, name: str, ignore: list[int] | None = None) -> dict[str, Any]:
        self.calls.append(("delete_template", name))
        if name in self.templates:
            del self.templates[name]
        return {"acknowledged": True}


class FakeOpenSearchClient:
    def __init__(self) -> None:
        self.indices = FakeIndicesClient()
        self.custom_counts: dict[str, int] = {}
        self.calls: list[tuple[str, Any]] = []

    def count(self, index: str) -> dict[str, int]:
        self.calls.append(("count", index))
        if index in self.custom_counts:
            return {"count": self.custom_counts[index]}
        if index in self.indices.indices:
            return {"count": len(self.indices.indices[index].get("docs", []))}
        return {"count": 0}


# ---------------------------------------------------------------------------
# Existing 4 tests preserved from original test suite
# ---------------------------------------------------------------------------

def test_dry_run_with_empty_build(monkeypatch, capsys, tmp_path: Path):
    empty_build = tmp_path / "build"
    empty_seed = tmp_path / "seed"
    empty_build.mkdir(parents=True, exist_ok=True)
    empty_seed.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr("atalaya.load.BUILD_DIR", empty_build)
    monkeypatch.setattr("atalaya.load.SEED_DIR", empty_seed)
    monkeypatch.setattr(sys, "argv", ["load", "--dry-run"])

    main()
    out, err = capsys.readouterr()
    assert "Index document counts:" in out
    assert "units: 0" in out
    assert "participation: 0" in out
    assert "catalog: 0" in out
    assert "[dry-run] Validation complete." in out


def test_dry_run_with_sample_fixtures(monkeypatch, capsys, tmp_path: Path):
    fixtures_core = Path(__file__).resolve().parent / "fixtures" / "core"
    build_dir = tmp_path / "build"
    build_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr("atalaya.load.BUILD_DIR", build_dir)
    monkeypatch.setattr("atalaya.load.SEED_DIR", fixtures_core)
    monkeypatch.setattr(sys, "argv", ["load", "--dry-run", "--only", "catalog"])

    main()
    out, err = capsys.readouterr()
    assert "catalog: 21" in out
    assert "[dry-run] Validation complete." in out


def test_prepare_docs_with_drivers_and_wide_columns(tmp_path: Path):
    from atalaya.load import prepare_participation_docs, prepare_units_docs
    import pandas as pd

    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    # Units
    units_df = pd.DataFrame({
        "id": ["07101"],
        "level": ["mun"],
        "cve_ent": ["07"],
        "cvegeo": ["07101"],
        "name": ["Tuxtla Gutiérrez"],
        "pob_18ymas": [1000],
        "lista_nominal": [800],
    })
    units_df.to_parquet(build_dir / "units.parquet", index=False)

    # Participation
    part_df = pd.DataFrame({
        "cvegeo": ["07101"],
        "cve_ent": ["07"],
        "year": [2024],
        "election": ["DIP_FED"],
        "lista_nominal": [800],
        "votos_totales": [480],
        "participacion": [0.60],
    })
    part_df.to_parquet(build_dir / "participation.parquet", index=False)

    # Drivers
    drivers_df = pd.DataFrame({
        "id": ["07101"],
        "level": ["mun"],
        "key": ["pct_18_24"],
        "label": ["Jóvenes"],
        "contribution_pp": [2.5],
        "direction": ["sube_abstencion"],
        "rank": [1],
    })
    drivers_df.to_parquet(build_dir / "drivers.parquet", index=False)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    u_docs = prepare_units_docs(store)
    assert len(u_docs) == 2  # mun + derived state
    doc = [d for d in u_docs if d["id"] == "07101"][0]
    assert doc["id"] == "07101"
    assert doc["coverage_ln"] == 0.8
    assert doc["part_dip_2024"] == 0.60
    assert doc["abst_dip_2024"] == 0.40
    assert len(doc["drivers"]) == 1
    assert doc["drivers"][0]["key"] == "pct_18_24"

    p_docs = prepare_participation_docs(store)
    assert len(p_docs) == 2
    p_mun = [p for p in p_docs if p["unit_id"] == "07101"][0]
    assert p_mun["name"] == "Tuxtla Gutiérrez"
    assert p_mun["unit_id"] == "07101"


def test_prepare_profile_docs(tmp_path: Path):
    from atalaya.load import prepare_profile_docs, validate_docs
    import pandas as pd

    build_dir = tmp_path / "build"
    seed_dir = tmp_path / "seed"
    build_dir.mkdir(parents=True, exist_ok=True)
    seed_dir.mkdir(parents=True, exist_ok=True)

    store = PandasStore(build_dir=build_dir, seed_dir=seed_dir)
    assert prepare_profile_docs(store) == []

    prof_df = pd.DataFrame([
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 500, "sv": 250, "nv": 250, "ns": 5},
        {"cvegeo": "07101", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "M", "ln": 520, "sv": 312, "nv": 208, "ns": 5},
        {"cvegeo": "07102", "cve_ent": "07", "year": 2024, "age_group": "18-24", "sexo": "H", "ln": 300, "sv": 150, "nv": 150, "ns": 2},
    ])
    prof_df.to_parquet(build_dir / "ccpc_profile_mun.parquet", index=False)

    docs = prepare_profile_docs(store)
    assert len(docs) == 5

    mun_doc = next(d for d in docs if d["id"] == "07101_2024_18-24_H")
    assert mun_doc["level"] == "mun"
    assert mun_doc["unit_id"] == "07101"
    assert mun_doc["cve_ent"] == "07"
    assert mun_doc["year"] == 2024
    assert mun_doc["age_group"] == "18-24"
    assert mun_doc["sexo"] == "H"
    assert mun_doc["participacion"] == 0.50

    state_doc = next(d for d in docs if d["id"] == "07_2024_18-24_H")
    assert state_doc["level"] == "state"
    assert state_doc["unit_id"] == "07"
    assert state_doc["ln"] == 800
    assert state_doc["sv"] == 400
    assert state_doc["nv"] == 400
    assert state_doc["participacion"] == 0.50

    errs = validate_docs("profile", docs)
    assert errs == []


# ---------------------------------------------------------------------------
# New tests: Versioned indexing, atomic swap, concrete index cleanup, prefix guards
# ---------------------------------------------------------------------------

def test_versioned_name_and_assert_prefixed():
    name = versioned_name("units", "20261020120000")
    assert name == "atalaya-units-20261020120000"
    assert_prefixed(name)

    with pytest.raises(ValueError):
        assert_prefixed("unprefixed-units")


def test_physical_versions_sorting():
    client = FakeOpenSearchClient()
    client.indices.indices["atalaya-units-20261019000000"] = {}
    client.indices.indices["atalaya-units-20261018000000"] = {}
    client.indices.indices["atalaya-units-20261020120000"] = {}
    # Indices that should be ignored (wrong kind or not 14 digits)
    client.indices.indices["atalaya-participation-20261019000000"] = {}
    client.indices.indices["atalaya-units-backup"] = {}

    versions = physical_versions(client, "units")
    assert versions == [
        "atalaya-units-20261018000000",
        "atalaya-units-20261019000000",
        "atalaya-units-20261020120000",
    ]


def test_load_kind_happy_path_keep_zero(monkeypatch):
    client = FakeOpenSearchClient()
    old_version = "atalaya-units-20261019000000"
    client.indices.indices[old_version] = {"settings": {}, "docs": [{"id": "old1"}]}
    client.indices.aliases["atalaya-units"] = {old_version}

    docs = [{"id": "d1", "name": "One"}, {"id": "d2", "name": "Two"}]

    def fake_bulk_index(c, idx, ds, id_field="id", chunk=1000):
        c.indices.indices[idx]["docs"] = list(ds)
        return len(ds), []

    monkeypatch.setattr("atalaya.load.bulk_index", fake_bulk_index)

    res = load_kind(client, "units", docs, stamp="20261020120000", replicas=1, keep=0)

    new_index = "atalaya-units-20261020120000"
    assert res["index"] == new_index
    assert res["ok"] == 2
    assert res["errors"] == []
    assert res["removed_from"] == [old_version]
    assert res["deleted"] == [old_version]

    # Alias points to new index
    assert client.indices.aliases["atalaya-units"] == {new_index}
    # Old version is deleted because keep=0
    assert old_version not in client.indices.indices
    # New index is present with docs
    assert len(client.indices.indices[new_index]["docs"]) == 2


def test_load_kind_happy_path_keep_one(monkeypatch):
    client = FakeOpenSearchClient()
    v1 = "atalaya-units-20261018000000"
    v2 = "atalaya-units-20261019000000"
    client.indices.indices[v1] = {"settings": {}, "docs": []}
    client.indices.indices[v2] = {"settings": {}, "docs": []}
    client.indices.aliases["atalaya-units"] = {v2}

    docs = [{"id": "d1"}]

    def fake_bulk_index(c, idx, ds, id_field="id", chunk=1000):
        c.indices.indices[idx]["docs"] = list(ds)
        return len(ds), []

    monkeypatch.setattr("atalaya.load.bulk_index", fake_bulk_index)

    res = load_kind(client, "units", docs, stamp="20261020120000", replicas=1, keep=1)

    new_index = "atalaya-units-20261020120000"
    assert res["index"] == new_index
    assert res["deleted"] == [v1]  # v1 was deleted, v2 kept because keep=1
    assert v1 not in client.indices.indices
    assert v2 in client.indices.indices
    assert new_index in client.indices.indices
    assert client.indices.aliases["atalaya-units"] == {new_index}


def test_load_kind_count_mismatch_aborts_and_cleans_new_index(monkeypatch):
    client = FakeOpenSearchClient()
    old_version = "atalaya-units-20261019000000"
    client.indices.indices[old_version] = {"settings": {}, "docs": []}
    client.indices.aliases["atalaya-units"] = {old_version}

    docs = [{"id": "d1"}, {"id": "d2"}]

    def fake_bulk_index(c, idx, ds, id_field="id", chunk=1000):
        c.indices.indices[idx]["docs"] = list(ds)
        return len(ds), []

    monkeypatch.setattr("atalaya.load.bulk_index", fake_bulk_index)

    # Force count mismatch (expected 2, returns 1)
    new_index = "atalaya-units-20261020120000"
    client.custom_counts[new_index] = 1

    with pytest.raises(RuntimeError) as exc_info:
        load_kind(client, "units", docs, stamp="20261020120000", replicas=1, keep=1)

    assert "count mismatch" in str(exc_info.value).lower()
    # New index was rolled back (deleted)
    assert new_index not in client.indices.indices
    # Old alias is still intact pointing to old_version
    assert client.indices.aliases["atalaya-units"] == {old_version}


def test_load_kind_concrete_index_deleted_before_swap(monkeypatch):
    client = FakeOpenSearchClient()
    alias_name = "atalaya-units"
    # Create concrete index with name identical to alias
    client.indices.indices[alias_name] = {"settings": {}, "docs": []}
    assert client.indices.exists(alias_name) is True
    assert client.indices.exists_alias(alias_name) is False

    docs = [{"id": "d1"}]

    def fake_bulk_index(c, idx, ds, id_field="id", chunk=1000):
        c.indices.indices[idx]["docs"] = list(ds)
        return len(ds), []

    monkeypatch.setattr("atalaya.load.bulk_index", fake_bulk_index)

    new_index = "atalaya-units-20261020120000"
    res = load_kind(client, "units", docs, stamp="20261020120000", replicas=1, keep=1)

    assert res["index"] == new_index
    # The concrete index with name atalaya-units was deleted
    assert alias_name not in client.indices.indices
    # Now atalaya-units exists as an alias pointing to new_index
    assert client.indices.exists_alias(alias_name) is True
    assert client.indices.aliases[alias_name] == {new_index}


def test_prefix_guard_prevents_unprefixed_writes(monkeypatch):
    client = FakeOpenSearchClient()

    with pytest.raises(ValueError):
        assert_prefixed("unauthorized_index")

    with pytest.raises(ValueError):
        swap_alias(client, "unauthorized_alias", "atalaya-units-20261020120000")

    with pytest.raises(ValueError):
        swap_alias(client, "atalaya-units", "unauthorized_index")

    # Confirm no create, delete or update calls reached client
    assert len(client.indices.calls) == 0


def test_main_unreachable_cluster_exits_code_2(monkeypatch, capsys):
    monkeypatch.setattr("atalaya.load.ping", lambda timeout_s=5.0: False)
    monkeypatch.setattr(sys, "argv", ["load"])

    with pytest.raises(SystemExit) as exc:
        main()

    assert exc.value.code == 2
    out, err = capsys.readouterr()
    assert "cluster unreachable" in out.lower()


def test_purge_prefixed_empty_prefix_raises_value_error(monkeypatch):
    from atalaya.config import Settings
    # Empty prefix
    monkeypatch.setattr("atalaya.load.get_settings", lambda: Settings(index_prefix=""))

    class ExplodingClient:
        @property
        def indices(self):
            raise AssertionError("Client should never be called when prefix is empty")

    with pytest.raises(ValueError) as exc:
        purge_prefixed(ExplodingClient())
    assert "prefix is empty" in str(exc.value).lower()


def test_purge_prefixed_deletes_only_prefixed_and_never_uses_wildcards(monkeypatch):
    client = FakeOpenSearchClient()

    # Prefixed resources
    client.indices.indices["atalaya-units-20261020000000"] = {}
    client.indices.indices["atalaya-participation-20261020000000"] = {}
    client.indices.aliases["atalaya-units"] = {"atalaya-units-20261020000000"}
    client.indices.index_templates["atalaya-units"] = {}
    client.indices.templates["atalaya-legacy"] = {}

    # Unprefixed resources (should remain completely untouched)
    client.indices.indices["other-index"] = {}
    client.indices.aliases["other-alias"] = {"other-index"}
    client.indices.index_templates["other-template"] = {}
    client.indices.templates["other-legacy"] = {}

    res = purge_prefixed(client)

    # Returned dict has expected purged items
    assert res["aliases"] == ["atalaya-units"]
    assert sorted(res["indices"]) == ["atalaya-participation-20261020000000", "atalaya-units-20261020000000"]
    assert sorted(res["templates"]) == ["atalaya-legacy", "atalaya-units"]

    # Unprefixed resources remain intact
    assert "other-index" in client.indices.indices
    assert "other-alias" in client.indices.aliases
    assert "other-template" in client.indices.index_templates
    assert "other-legacy" in client.indices.templates

    # Prefixed resources are gone
    assert "atalaya-units-20261020000000" not in client.indices.indices
    assert "atalaya-participation-20261020000000" not in client.indices.indices
    assert "atalaya-units" not in client.indices.aliases
    assert "atalaya-units" not in client.indices.index_templates
    assert "atalaya-legacy" not in client.indices.templates

    # Verify that NEVER was delete called with a wildcard '*'
    delete_calls = [call for call in client.indices.calls if call[0] == "delete"]
    assert len(delete_calls) == 2
    for action, target_index in delete_calls:
        assert "*" not in target_index
        assert target_index.startswith("atalaya-")


def test_purge_prefixed_raises_if_unprefixed_name_returned(monkeypatch):
    client = FakeOpenSearchClient()

    # Simulate anomalous client response returning an unprefixed index
    def anomalous_get(index=None, ignore=None):
        return {"unprefixed_index_something": {}}

    monkeypatch.setattr(client.indices, "get", anomalous_get)

    with pytest.raises(ValueError) as exc:
        purge_prefixed(client)
    assert "does not start with configured prefix" in str(exc.value)


def test_main_reset_flag_invokes_purge_prefixed(monkeypatch, capsys, tmp_path):
    fixtures_core = Path(__file__).resolve().parent / "fixtures" / "core"
    build_dir = tmp_path / "build"
    build_dir.mkdir(parents=True, exist_ok=True)

    client = FakeOpenSearchClient()
    purged_called = []

    def mock_purge_prefixed(c):
        purged_called.append(c)
        return {"aliases": ["atalaya-units"], "indices": ["atalaya-units-old"], "templates": []}

    monkeypatch.setattr("atalaya.load.BUILD_DIR", build_dir)
    monkeypatch.setattr("atalaya.load.SEED_DIR", fixtures_core)
    monkeypatch.setattr("atalaya.load.ping", lambda timeout_s=5.0: True)
    monkeypatch.setattr("atalaya.load.get_client", lambda: client)
    monkeypatch.setattr("atalaya.load.purge_prefixed", mock_purge_prefixed)
    monkeypatch.setattr("atalaya.load.ensure_index_templates", lambda c: ["atalaya-catalog"])
    monkeypatch.setattr("atalaya.load.load_kind", lambda *a, **kw: {"index": "test", "ok": 0})
    monkeypatch.setattr(sys, "argv", ["load", "--reset", "--only", "catalog"])

    main()

    assert len(purged_called) == 1
    out, _ = capsys.readouterr()
    assert "Purged prefixed cluster resources:" in out
    assert "atalaya-units" in out
