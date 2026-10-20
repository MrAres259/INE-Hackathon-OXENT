"""Unit tests for bootstrap_cluster script."""

from __future__ import annotations

from pathlib import Path
import sys
from typing import Any
import pytest

from opensearchpy.exceptions import AuthenticationException
from atalaya.config import Settings
from scripts.bootstrap_cluster import bootstrap, main, _format_clean_urls, _reload_api


class FakeClient:
    def __init__(self) -> None:
        self.indices = self
        self.cluster = self

    def ping(self, request_timeout: float = 5.0) -> bool:
        return True

    def info(self, request_timeout: float = 5.0) -> dict[str, Any]:
        return {
            "version": {"number": "3.4.0", "distribution": "opensearch"},
            "cluster_name": "test-cluster",
        }

    def health(self, request_timeout: float = 5.0) -> dict[str, Any]:
        return {"status": "green", "number_of_nodes": 1}


@pytest.fixture(autouse=True)
def mock_sleep_and_client(monkeypatch):
    """Disable time.sleep delays and provide default mock cluster environment."""
    monkeypatch.setattr("time.sleep", lambda s: None)
    monkeypatch.setattr("scripts.bootstrap_cluster.time.sleep", lambda s: None)

    fake_settings = Settings(
        search_urls=["https://10.0.0.205:9200"],
        search_username="admin",
        search_password="secretpassword",
        search_verify_certs=False,
        index_prefix="atalaya-",
    )
    monkeypatch.setattr("scripts.bootstrap_cluster.get_settings", lambda: fake_settings)
    monkeypatch.setattr("scripts.bootstrap_cluster.get_client", lambda: FakeClient())
    monkeypatch.setattr("scripts.bootstrap_cluster.ping", lambda timeout_s=5.0: True)
    monkeypatch.setattr(
        "scripts.bootstrap_cluster.cluster_info",
        lambda timeout_s=5.0: {
            "distribution": "opensearch",
            "version": "3.4.0",
            "cluster_name": "test-cluster",
            "status": "green",
            "nodes": 1,
        },
    )
    monkeypatch.setattr("scripts.bootstrap_cluster.ensure_index_templates", lambda c: ["atalaya-units"])
    monkeypatch.setattr("scripts.bootstrap_cluster.auto_replicas", lambda c: 0)
    monkeypatch.setattr(
        "scripts.bootstrap_cluster.load_kind",
        lambda client, kind, docs, stamp, replicas, keep: {
            "kind": kind,
            "index": f"atalaya-{kind}-{stamp}",
            "docs": len(docs),
            "ok": len(docs),
        },
    )
    monkeypatch.setattr("scripts.bootstrap_cluster.prepare_units_docs", lambda s: [{"id": "u1"}])
    monkeypatch.setattr("scripts.bootstrap_cluster.prepare_participation_docs", lambda s: [{"id": "p1"}])
    monkeypatch.setattr("scripts.bootstrap_cluster.prepare_catalog_docs", lambda s: [{"id": "c1"}])
    monkeypatch.setattr("scripts.bootstrap_cluster.prepare_profile_docs", lambda s: [{"id": "pr1"}])
    monkeypatch.setattr("scripts.bootstrap_cluster.validate_docs", lambda k, d: [])
    monkeypatch.setattr("scripts.os_parity.run_checks", lambda m, o: [("check_1", True, "matched")])
    monkeypatch.setattr("scripts.bootstrap_cluster._reload_api", lambda url: (True, "Reloaded ok"))


def test_format_clean_urls_masks_credentials():
    urls = [
        "https://admin:supersecret@10.0.0.205:9200",
        "http://myhost:9201/path",
        "https://cluster.example.com",
    ]
    clean = _format_clean_urls(urls)
    assert clean == ["10.0.0.205:9200", "myhost:9201", "cluster.example.com:443"]
    for c in clean:
        assert "admin" not in c
        assert "supersecret" not in c


def test_bootstrap_no_urls_exits_2(monkeypatch):
    monkeypatch.setattr("scripts.bootstrap_cluster.get_settings", lambda: Settings(search_urls=[]))
    code = bootstrap()
    assert code == 2


def test_bootstrap_client_none_exits_2(monkeypatch):
    monkeypatch.setattr("scripts.bootstrap_cluster.get_client", lambda: None)
    code = bootstrap()
    assert code == 2


def test_bootstrap_ping_retry_success(monkeypatch):
    attempts = 0

    def flaky_ping(timeout_s=5.0):
        nonlocal attempts
        attempts += 1
        return attempts >= 3

    monkeypatch.setattr("scripts.bootstrap_cluster.ping", flaky_ping)
    code = bootstrap()
    assert code == 0
    assert attempts == 3


def test_bootstrap_ping_failure_with_401_exits_2(monkeypatch, capsys):
    monkeypatch.setattr("scripts.bootstrap_cluster.ping", lambda timeout_s=5.0: False)

    class AuthFailClient(FakeClient):
        def info(self, request_timeout: float = 5.0):
            raise AuthenticationException(401, "Unauthorized", "Invalid auth")

    monkeypatch.setattr("scripts.bootstrap_cluster.get_client", lambda: AuthFailClient())

    code = bootstrap()
    assert code == 2
    out, _ = capsys.readouterr()
    assert "Autenticación fallida (401" in out


def test_bootstrap_ping_failure_unreachable_exits_2(monkeypatch, capsys):
    monkeypatch.setattr("scripts.bootstrap_cluster.ping", lambda timeout_s=5.0: False)

    class UnreachableClient(FakeClient):
        def info(self, request_timeout: float = 5.0):
            raise ConnectionError("Host unreachable")

    monkeypatch.setattr("scripts.bootstrap_cluster.get_client", lambda: UnreachableClient())

    code = bootstrap()
    assert code == 2
    out, _ = capsys.readouterr()
    assert "Clúster no alcanzable" in out


def test_bootstrap_red_status_waits_until_yellow_or_green(monkeypatch, capsys):
    statuses = ["red", "red", "yellow"]

    def flaky_health(request_timeout=5.0):
        val = statuses.pop(0) if statuses else "yellow"
        return {"status": val, "number_of_nodes": 1}

    class RedClusterClient(FakeClient):
        def health(self, request_timeout=5.0):
            return flaky_health(request_timeout)

    monkeypatch.setattr("scripts.bootstrap_cluster.get_client", lambda: RedClusterClient())
    monkeypatch.setattr(
        "scripts.bootstrap_cluster.cluster_info",
        lambda timeout_s=5.0: {
            "distribution": "opensearch",
            "version": "3.4.0",
            "cluster_name": "test-cluster",
            "status": "red",
            "nodes": 1,
        },
    )

    code = bootstrap()
    assert code == 0
    out, _ = capsys.readouterr()
    assert "Estado 'red'. Esperando hasta 60s" in out
    assert "Estado actualizado a: yellow" in out


def test_bootstrap_reset_flag_invokes_purge(monkeypatch):
    purge_called = []

    def mock_purge(client):
        purge_called.append(client)
        return {
            "aliases": ["atalaya-units"],
            "indices": ["atalaya-units-20261019000000"],
            "templates": ["atalaya-units"],
        }

    monkeypatch.setattr("scripts.bootstrap_cluster.purge_prefixed", mock_purge)
    code = bootstrap(reset=True)
    assert code == 0
    assert len(purge_called) == 1


def test_bootstrap_load_kind_failure_exits_1(monkeypatch):
    def failing_load_kind(*args, **kwargs):
        raise RuntimeError("Disk full")

    monkeypatch.setattr("scripts.bootstrap_cluster.load_kind", failing_load_kind)
    code = bootstrap()
    assert code == 1


def test_bootstrap_doc_validation_failure_exits_1(monkeypatch):
    monkeypatch.setattr("scripts.bootstrap_cluster.validate_docs", lambda k, d: ["Invalid ID"])
    code = bootstrap()
    assert code == 1


def test_bootstrap_api_down_shows_warning_and_exits_0(monkeypatch, capsys):
    monkeypatch.setattr("scripts.bootstrap_cluster._reload_api", lambda url: (False, "URLError: [WinError 10061] Connection refused"))
    code = bootstrap()
    assert code == 0
    out, _ = capsys.readouterr()
    assert "AVISO" in out
    assert "API no alcanzable" in out


def test_bootstrap_parity_failure_exits_1(monkeypatch):
    monkeypatch.setattr(
        "scripts.os_parity.run_checks",
        lambda m, o: [
            ("units count by level", True, "matched"),
            ("unit('09015')", False, "mismatches: pred_abstention"),
        ],
    )
    code = bootstrap(skip_parity=False)
    assert code == 1


def test_bootstrap_skip_parity_exits_0(monkeypatch):
    # Even if parity checks would fail, skip_parity=True should bypass them
    monkeypatch.setattr(
        "scripts.os_parity.run_checks",
        lambda m, o: [("failing_check", False, "failed")],
    )
    code = bootstrap(skip_parity=True)
    assert code == 0


def test_main_cli_invokes_bootstrap(monkeypatch):
    captured_args = {}

    def mock_bootstrap(**kwargs):
        captured_args.update(kwargs)
        return 0

    monkeypatch.setattr("scripts.bootstrap_cluster.bootstrap", mock_bootstrap)
    monkeypatch.setattr(
        sys,
        "argv",
        ["bootstrap_cluster.py", "--reset", "--skip-parity", "--api", "http://127.0.0.1:9999"],
    )

    with pytest.raises(SystemExit) as exc:
        main()

    assert exc.value.code == 0
    assert captured_args["reset"] is True
    assert captured_args["skip_parity"] is True
    assert captured_args["api_url"] == "http://127.0.0.1:9999"
