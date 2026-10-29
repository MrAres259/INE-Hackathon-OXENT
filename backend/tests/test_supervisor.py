"""Tests for ATALAYA fault-tolerant process supervisor.

All tests run in-process without spawning real subprocesses or making network calls.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import pytest

from atalaya.ops.supervisor import (
    STATUS_CRASH_LOOP,
    STATUS_HEALTHY,
    STATUS_RESTARTING,
    STATUS_STARTING,
    STATUS_STOPPED,
    STATUS_UNHEALTHY,
    ServiceSpec,
    ServiceState,
    Supervisor,
    cmd_run,
    compute_backoff,
    default_edge_health_ok,
    get_default_specs,
    render_caddyfile,
    save_state_atomic,
)


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.current = start

    def __call__(self) -> float:
        return self.current

    def advance(self, seconds: float) -> None:
        self.current += seconds


class FakeProcess:
    def __init__(self, pid: int):
        self.pid = pid
        self._exit_code: int | None = None

    def poll(self) -> int | None:
        return self._exit_code

    def terminate(self) -> None:
        self._exit_code = 0


class FakeLauncher:
    def __init__(self):
        self.next_pid = 1000
        self.procs: dict[str, FakeProcess] = {}
        self.launched_history: list[tuple[str, int]] = []

    def __call__(self, spec: ServiceSpec, log_path: Path) -> FakeProcess:
        self.next_pid += 1
        proc = FakeProcess(self.next_pid)
        self.procs[spec.name] = proc
        self.launched_history.append((spec.name, proc.pid))
        return proc


class FakeKiller:
    def __init__(self):
        self.killed_pids: list[int] = []

    def __call__(self, pid: int) -> None:
        self.killed_pids.append(pid)


class FakeHealthChecker:
    def __init__(self):
        self.responses: dict[str, Any] = {}
        self.calls: list[str] = []

    def set_ok(self, url: str) -> None:
        class OkResponse:
            status_code = 200

            def json(self):
                return {"warmup": "ready"}

        self.responses[url] = OkResponse()

    def set_unhealthy(self, url: str, status_code: int = 500) -> None:
        class BadResponse:
            def __init__(self, code):
                self.status_code = code

            def json(self):
                return {"error": "unhealthy"}

        self.responses[url] = BadResponse(status_code)

    def set_exception(self, url: str, exc: Exception) -> None:
        self.responses[url] = exc

    def __call__(self, url: str, timeout: float = 5.0) -> Any:
        self.calls.append(url)
        res = self.responses.get(url)
        if isinstance(res, Exception):
            raise res
        return res


class FakePortInspector:
    def __init__(self):
        self.occupied: dict[int, tuple[int, str]] = {}

    def set_occupied(self, port: int, pid: int, name: str) -> None:
        self.occupied[port] = (pid, name)

    def set_free(self, port: int) -> None:
        self.occupied.pop(port, None)

    def __call__(self, port: int) -> tuple[int, str] | None:
        return self.occupied.get(port)


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------


def test_backoff_and_stability_reset():
    """Verify exponential backoff calculation and reset after 10 min stable."""
    # 1. Test pure exponential backoff calculation: 2 -> 4 -> 8 -> 16 -> 32 -> 60 s
    assert compute_backoff(0) == 0.0
    assert compute_backoff(1) == 2.0
    assert compute_backoff(2) == 4.0
    assert compute_backoff(3) == 8.0
    assert compute_backoff(4) == 16.0
    assert compute_backoff(5) == 32.0
    assert compute_backoff(6) == 60.0
    assert compute_backoff(7) == 60.0
    assert compute_backoff(1, is_crash_loop=True) == 300.0

    # 2. Test stability reset in ServiceState
    spec = ServiceSpec(
        name="test_service",
        cmd=["echo", "1"],
        cwd=".",
        start_grace_s=0.0,
    )
    state = ServiceState(spec=spec)
    now = 1000.0

    # First restart: consecutive_restarts becomes 1, backoff is 2s
    backoff, is_cl = state.record_restart(now, reason="test failure 1")
    assert backoff == 2.0
    assert not is_cl
    assert state.consecutive_restarts == 1

    # Second restart: backoff is 4s
    now += 5.0
    backoff, is_cl = state.record_restart(now, reason="test failure 2")
    assert backoff == 4.0
    assert state.consecutive_restarts == 2

    # Third restart: backoff is 8s
    now += 10.0
    backoff, is_cl = state.record_restart(now, reason="test failure 3")
    assert backoff == 8.0
    assert state.consecutive_restarts == 3

    # Now service starts and stays healthy
    now += 10.0
    state.record_start(pid=123, now=now)
    state.record_health_success(now=now, now_iso="2026-10-20T12:00:00Z")
    assert state.status == STATUS_HEALTHY

    # Less than 10 minutes (e.g., 300 s): counter NOT reset
    now += 300.0
    state.record_health_success(now=now, now_iso="2026-10-20T12:05:00Z")
    assert state.consecutive_restarts == 3

    # 10 minutes stable (>= 600 s): counter resets!
    now += 301.0
    state.record_health_success(now=now, now_iso="2026-10-20T12:10:01Z")
    assert state.consecutive_restarts == 0
    assert len(state.restart_timestamps) == 0

    # Next restart starts back at 2s
    now += 5.0
    backoff, is_cl = state.record_restart(now, reason="failure after stable")
    assert backoff == 2.0
    assert state.consecutive_restarts == 1


def test_restart_after_3_health_failures_not_2(tmp_path: Path):
    """Verify service is only restarted on 3 consecutive health check failures."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    port_inspector = FakePortInspector()

    spec = ServiceSpec(
        name="backend",
        cmd=["dummy"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8001/api/health",
        health_ok=lambda r: getattr(r, "status_code", 0) == 200,
        start_grace_s=0.0,
        port=8001,
    )

    sup = Supervisor(
        specs=[spec],
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=port_inspector,
    )

    # Tick 1: service launches (status: starting)
    checker.set_ok("http://127.0.0.1:8001/api/health")
    sup.tick()
    assert len(launcher.launched_history) == 1
    orig_pid = launcher.launched_history[0][1]
    assert sup.services["backend"].status == STATUS_STARTING

    # Tick 2: health check runs, becomes healthy
    clock.advance(10.0)
    sup.tick()
    assert sup.services["backend"].status == STATUS_HEALTHY
    assert len(killer.killed_pids) == 0

    # Failure 1
    clock.advance(10.0)
    checker.set_unhealthy("http://127.0.0.1:8001/api/health", 500)
    sup.tick()
    assert sup.services["backend"].status == STATUS_UNHEALTHY
    assert sup.services["backend"].consecutive_health_failures == 1
    assert len(killer.killed_pids) == 0  # not restarted yet!

    # Failure 2
    clock.advance(10.0)
    sup.tick()
    assert sup.services["backend"].status == STATUS_UNHEALTHY
    assert sup.services["backend"].consecutive_health_failures == 2
    assert len(killer.killed_pids) == 0  # still not restarted!

    # Failure 3 -> restart triggered!
    clock.advance(10.0)
    sup.tick()
    assert len(killer.killed_pids) == 1
    assert killer.killed_pids[0] == orig_pid
    assert sup.services["backend"].status == STATUS_RESTARTING


def test_dead_process_triggers_immediate_restart(tmp_path: Path):
    """Verify dead process is detected immediately and triggers restart."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    checker.set_ok("http://127.0.0.1:8001/api/health")

    spec = ServiceSpec(
        name="backend",
        cmd=["dummy"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8001/api/health",
        health_ok=lambda r: getattr(r, "status_code", 0) == 200,
        start_grace_s=0.0,
    )

    sup = Supervisor(
        specs=[spec],
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=FakePortInspector(),
    )

    # Launch
    sup.tick()
    clock.advance(10.0)
    sup.tick()
    assert sup.services["backend"].status == STATUS_HEALTHY

    proc = launcher.procs["backend"]
    # Simulate process death (exit code 1)
    proc._exit_code = 1
    clock.advance(10.0)
    sup.tick()

    assert sup.services["backend"].status == STATUS_RESTARTING
    assert sup.services["backend"].restarts == 1
    assert "exit code 1" in (sup.services["backend"].last_error or "")

    # Advance beyond backoff (2s) -> service should be relaunched
    clock.advance(3.0)
    sup.tick()
    assert len(launcher.launched_history) == 2
    assert launcher.launched_history[1][1] != launcher.launched_history[0][1]


def test_crash_loop_retries_every_5_minutes(tmp_path: Path):
    """Verify service entering crash loop (>10 restarts in 15m) retries every 5 minutes."""
    clock = FakeClock(1000.0)
    spec = ServiceSpec(
        name="flaky_service",
        cmd=["dummy"],
        cwd=tmp_path,
        start_grace_s=0.0,
    )
    state = ServiceState(spec=spec)

    # Trigger 10 restarts within 5 minutes
    for i in range(10):
        clock.advance(20.0)
        backoff, is_cl = state.record_restart(clock(), reason=f"fail {i}")
        assert not is_cl
        assert state.status == STATUS_RESTARTING

    # 11th restart in the same 15-minute window
    clock.advance(20.0)
    backoff, is_cl = state.record_restart(clock(), reason="fail 11")
    assert is_cl
    assert state.status == STATUS_CRASH_LOOP
    assert backoff == 300.0  # 5 minutes
    assert state.next_allowed_start == clock() + 300.0


def test_frontend_dependency_on_backend(tmp_path: Path):
    """Verify frontend waits for backend to be healthy or for 180s timeout."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    port_inspector = FakePortInspector()

    backend_spec = ServiceSpec(
        name="backend",
        cmd=["dummy_backend"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8001/api/health",
        health_ok=lambda r: getattr(r, "status_code", 0) == 200,
        start_grace_s=30.0,
        depends_on=None,
    )
    frontend_spec = ServiceSpec(
        name="frontend",
        cmd=["dummy_frontend"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8080/",
        health_ok=lambda r: getattr(r, "status_code", 0) == 200,
        start_grace_s=30.0,
        depends_on="backend",
    )

    sup = Supervisor(
        specs=[backend_spec, frontend_spec],
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=port_inspector,
    )

    # Initial tick: backend launches, but is still STARTING (not healthy yet)
    sup.tick()
    launched_names = [n for n, _ in launcher.launched_history]
    assert "backend" in launched_names
    assert "frontend" not in launched_names
    assert not sup.can_start("frontend", clock())

    # Backend becomes healthy on tick 2
    checker.set_ok("http://127.0.0.1:8001/api/health")
    checker.set_ok("http://127.0.0.1:8080/")
    clock.advance(10.0)
    # Tick 2 updates backend to healthy and immediately triggers frontend launch
    sup.tick()
    assert sup.services["backend"].status == STATUS_HEALTHY
    launched_names = [n for n, _ in launcher.launched_history]
    assert "frontend" in launched_names


def test_frontend_starts_after_180s_timeout_if_backend_not_healthy(tmp_path: Path):
    """Verify frontend launches after 180s even if backend has not become healthy."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    checker.set_unhealthy("http://127.0.0.1:8001/api/health")

    backend_spec = ServiceSpec(
        name="backend",
        cmd=["dummy_backend"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8001/api/health",
        start_grace_s=30.0,
        depends_on=None,
    )
    frontend_spec = ServiceSpec(
        name="frontend",
        cmd=["dummy_frontend"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8080/",
        start_grace_s=30.0,
        depends_on="backend",
    )

    sup = Supervisor(
        specs=[backend_spec, frontend_spec],
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=FakePortInspector(),
    )

    sup.tick()
    assert not sup.can_start("frontend", clock())

    # Advance clock 185s
    clock.advance(185.0)
    assert sup.can_start("frontend", clock())


def test_foreign_process_on_port_not_killed(tmp_path: Path):
    """Verify foreign process occupying a service port is not killed."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    port_inspector = FakePortInspector()

    # Port 8080 is occupied by external PID 7777 (not launched by supervisor)
    port_inspector.set_occupied(8080, pid=7777, name="external_service.exe")

    spec = ServiceSpec(
        name="frontend",
        cmd=["dummy_frontend"],
        cwd=tmp_path,
        health_url="http://127.0.0.1:8080/",
        port=8080,
    )

    sup = Supervisor(
        specs=[spec],
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=port_inspector,
    )

    # Tick: supervisor checks port 8080 before launching
    sup.tick()

    # Verification: PID 7777 was NOT killed!
    assert 7777 not in killer.killed_pids
    assert len(killer.killed_pids) == 0
    # Service was not launched
    assert len(launcher.launched_history) == 0
    # Error message recorded the occupied port
    assert "occupied by foreign process PID 7777" in (sup.services["frontend"].last_error or "")
    assert sup.services["frontend"].status == STATUS_RESTARTING


def test_atomic_state_saving(tmp_path: Path):
    """Verify state file is written atomically with complete JSON schema."""
    state_file = tmp_path / "supervisor_state.json"
    data = {
        "pid": 5432,
        "started_at": "2026-10-20T12:00:00Z",
        "public_url": "http://46.250.172.193:8080",
        "services": {
            "backend": {
                "pid": 1111,
                "status": "healthy",
                "restarts": 0,
                "last_health": "2026-10-20T12:01:00Z",
                "last_error": None,
            },
            "frontend": {
                "pid": 2222,
                "status": "healthy",
                "restarts": 0,
                "last_health": "2026-10-20T12:01:00Z",
                "last_error": None,
            },
        },
    }

    save_state_atomic(state_file, data)

    assert state_file.exists()
    loaded = json.loads(state_file.read_text(encoding="utf-8"))
    assert loaded["pid"] == 5432
    assert loaded["public_url"] == "http://46.250.172.193:8080"
    assert loaded["services"]["backend"]["status"] == "healthy"
    assert loaded["services"]["frontend"]["pid"] == 2222

    # Check that temporary files were cleaned up
    tmp_files = list(tmp_path.glob("*.tmp.*"))
    assert len(tmp_files) == 0


def test_second_supervisor_exits_with_code_3(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Verify that starting a second supervisor when one is alive exits with code 3."""
    cache_dir = tmp_path / "data" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    pid_file = cache_dir / "supervisor.pid"

    # Simulate existing supervisor PID 9999
    pid_file.write_text("9999", encoding="utf-8")

    # Mock is_pid_alive to report 9999 is alive
    import atalaya.ops.supervisor as sup_mod

    monkeypatch.setattr(sup_mod, "is_pid_alive", lambda pid: pid == 9999)
    # Mock repo_dir resolution to point to tmp_path
    monkeypatch.setattr(
        sup_mod.Path,
        "resolve",
        lambda self: tmp_path / "backend" / "atalaya" / "ops" / "supervisor.py",
    )

    # Running cmd_run should return 3
    exit_code = cmd_run(port=8080)
    assert exit_code == 3


def test_port_80_strictly_forbidden():
    """Verify port 80 is rejected to protect other apps on the machine."""
    with pytest.raises(ValueError, match="Port 80 is reserved"):
        get_default_specs(port=80)

    exit_code = cmd_run(port=80)
    assert exit_code == 1


def test_default_specs_three_services():
    """Verify default specs contain backend (1 worker, proxy headers), frontend (127.0.0.1:3000), and edge."""
    specs = get_default_specs(port=8080)
    assert len(specs) == 3
    names = [s.name for s in specs]
    assert names == ["backend", "frontend", "edge"]

    backend, frontend, edge = specs
    # Backend
    assert backend.port == 8001
    assert backend.depends_on is None
    assert "--workers" in backend.cmd
    workers_idx = backend.cmd.index("--workers")
    assert backend.cmd[workers_idx + 1] == "1"
    assert "--proxy-headers" in backend.cmd
    assert "--forwarded-allow-ips" in backend.cmd
    fwd_idx = backend.cmd.index("--forwarded-allow-ips")
    assert backend.cmd[fwd_idx + 1] == "127.0.0.1"

    # Frontend
    assert frontend.port == 3000
    assert frontend.depends_on == "backend"
    assert "-H" in frontend.cmd
    h_idx = frontend.cmd.index("-H")
    assert frontend.cmd[h_idx + 1] == "127.0.0.1"
    assert "-p" in frontend.cmd
    p_idx = frontend.cmd.index("-p")
    assert frontend.cmd[p_idx + 1] == "3000"
    assert frontend.health_url == "http://127.0.0.1:3000/login"

    # Edge
    assert edge.port == 8080
    assert edge.depends_on == "frontend"
    assert "run" in edge.cmd
    assert edge.health_url == "http://127.0.0.1:8080/api/health"
    assert edge.health_ok == default_edge_health_ok


def test_render_caddyfile(tmp_path: Path):
    """Verify Caddyfile template renders correctly with security headers, admin blocking, and SSE flush."""
    template_file = tmp_path / "Caddyfile.template"
    output_file = tmp_path / "Caddyfile"
    log_file = tmp_path / "logs" / "caddy_access.log"

    template_content = """{
\tadmin off
\tauto_https off
}

:{{PORT}} {
\tlog {
\t\toutput file "{{LOG}}" {
\t\t\troll_size 10MiB
\t\t\troll_keep 5
\t\t}
\t\tformat json
\t}

\tencode zstd gzip

\trequest_body {
\t\tmax_size 1MB
\t}

\theader {
\t\tX-Content-Type-Options nosniff
\t\tReferrer-Policy strict-origin-when-cross-origin
\t\tX-Frame-Options SAMEORIGIN
\t\tPermissions-Policy "camera=(), microphone=(), geolocation=()"
\t\t-Server
\t}

\t@admin path_regexp admin (?i)^/api/admin(/|$)
\thandle @admin {
\t\trespond 404
\t}

\thandle /api/* {
\t\treverse_proxy {{API}} {
\t\t\theader_up X-Forwarded-For {remote_host}
\t\t\tflush_interval -1
\t\t\ttransport http {
\t\t\t\tread_timeout 180s
\t\t\t}
\t\t}
\t}

\thandle {
\t\treverse_proxy {{WEB}}
\t}
}
"""
    template_file.write_text(template_content, encoding="utf-8")

    rendered = render_caddyfile(
        template_path=template_file,
        output_path=output_file,
        port=8080,
        api_target="127.0.0.1:8001",
        web_target="127.0.0.1:3000",
        log_path=log_file,
    )

    assert output_file.exists()
    assert ":8080 {" in rendered
    assert "admin off" in rendered
    assert "auto_https off" in rendered
    assert "X-Content-Type-Options nosniff" in rendered
    assert "SAMEORIGIN" in rendered
    assert "@admin path_regexp admin (?i)^/api/admin(/|$)" in rendered
    assert "respond 404" in rendered
    assert "header_up X-Forwarded-For {remote_host}" in rendered
    assert "flush_interval -1" in rendered
    assert "read_timeout 180s" in rendered
    assert "127.0.0.1:8001" in rendered
    assert "127.0.0.1:3000" in rendered
    assert log_file.as_posix() in rendered


def test_edge_missing_caddy_enters_crash_loop(tmp_path: Path):
    """Verify that if caddy.exe is missing, edge service transitions to crash-loop without launching."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    checker.set_ok("http://127.0.0.1:8001/api/health")
    checker.set_ok("http://127.0.0.1:3000/login")

    specs = get_default_specs(port=8080, repo_dir=tmp_path)

    sup = Supervisor(
        specs=specs,
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=FakePortInspector(),
        repo_dir=tmp_path,
        caddy_validator=None,
        caddy_exists_fn=lambda p: False,  # Simulate caddy.exe missing
    )

    # Tick 1: backend launches
    sup.tick()
    clock.advance(10.0)
    sup.tick()
    assert sup.services["backend"].status == STATUS_HEALTHY

    # Tick 2: frontend launches
    clock.advance(10.0)
    sup.tick()
    assert sup.services["frontend"].status == STATUS_HEALTHY

    # Tick 3: edge tries to start, but caddy.exe is missing!
    clock.advance(10.0)
    sup.tick()

    edge_state = sup.services["edge"]
    assert edge_state.status == STATUS_CRASH_LOOP
    assert edge_state.last_error == r"falta tools/caddy/caddy.exe: ejecuta scripts\get_caddy.ps1"
    launched_names = [n for n, _ in launcher.launched_history]
    assert "edge" not in launched_names


def test_edge_lifecycle_and_orderly_shutdown(tmp_path: Path):
    """Verify 3-tier startup (backend -> frontend -> edge) and orderly shutdown (edge -> frontend -> backend)."""
    clock = FakeClock(1000.0)
    launcher = FakeLauncher()
    killer = FakeKiller()
    checker = FakeHealthChecker()
    checker.set_ok("http://127.0.0.1:8001/api/health")
    checker.set_ok("http://127.0.0.1:3000/login")
    checker.set_ok("http://127.0.0.1:8080/api/health")

    # Create dummy template file so render_caddyfile succeeds
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    template_path = scripts_dir / "Caddyfile.template"
    template_path.write_text(":{{PORT}} { handle { respond 200 } }", encoding="utf-8")

    specs = get_default_specs(port=8080, repo_dir=tmp_path)

    sup = Supervisor(
        specs=specs,
        cache_dir=tmp_path,
        clock=clock,
        launcher=launcher,
        killer=killer,
        health_checker=checker,
        port_inspector=FakePortInspector(),
        repo_dir=tmp_path,
        caddy_validator=lambda exe, path: None,  # no-op validation for unit test
        caddy_exists_fn=lambda p: True,
    )

    # Step 1: backend starts
    sup.tick()
    assert "backend" in [n for n, _ in launcher.launched_history]
    assert "frontend" not in [n for n, _ in launcher.launched_history]
    assert "edge" not in [n for n, _ in launcher.launched_history]

    # Step 2: backend becomes healthy, frontend starts
    clock.advance(10.0)
    sup.tick()
    assert sup.services["backend"].status == STATUS_HEALTHY
    assert "frontend" in [n for n, _ in launcher.launched_history]
    assert "edge" not in [n for n, _ in launcher.launched_history]

    # Step 3: frontend becomes healthy, edge starts
    clock.advance(10.0)
    sup.tick()
    assert sup.services["frontend"].status == STATUS_HEALTHY
    assert "edge" in [n for n, _ in launcher.launched_history]

    # Step 4: edge becomes healthy
    clock.advance(10.0)
    sup.tick()
    assert sup.services["edge"].status == STATUS_HEALTHY

    # Verify PIDs are tracked
    edge_pid = sup.services["edge"].pid
    frontend_pid = sup.services["frontend"].pid
    backend_pid = sup.services["backend"].pid
    assert edge_pid is not None
    assert frontend_pid is not None
    assert backend_pid is not None

    # Step 5: Orderly stop_all
    sup.stop_all()
    assert sup.services["edge"].status == STATUS_STOPPED
    assert sup.services["frontend"].status == STATUS_STOPPED
    assert sup.services["backend"].status == STATUS_STOPPED

    # Verification: killer called in sequence: edge -> frontend -> backend
    assert killer.killed_pids == [edge_pid, frontend_pid, backend_pid]


def test_reserved_internal_ports_forbidden():
    """Verify internal ports 8001 and 3000 are rejected as edge port."""
    with pytest.raises(ValueError, match="reserved for internal services"):
        get_default_specs(port=8001)

    with pytest.raises(ValueError, match="reserved for internal services"):
        get_default_specs(port=3000)

    assert cmd_run(port=8001) == 1
    assert cmd_run(port=3000) == 1
