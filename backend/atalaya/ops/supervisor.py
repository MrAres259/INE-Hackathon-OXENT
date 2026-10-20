"""ATALAYA Fault-Tolerant Process Supervisor.

Manages, monitors, and auto-heals the ATALAYA backend (FastAPI) and frontend
(Next.js) services for resilient public internet serving.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from typing import Any, Callable, Mapping

logger = logging.getLogger("atalaya.supervisor")

STATUS_STARTING = "starting"
STATUS_HEALTHY = "healthy"
STATUS_UNHEALTHY = "unhealthy"
STATUS_RESTARTING = "restarting"
STATUS_CRASH_LOOP = "crash-loop"
STATUS_STOPPED = "stopped"


def compute_backoff(consecutive_restarts: int, is_crash_loop: bool = False) -> float:
    """Compute exponential backoff (2 -> 4 -> ... -> 60 s), or 300 s for crash loop."""
    if is_crash_loop:
        return 300.0
    if consecutive_restarts <= 0:
        return 0.0
    return min(60.0, 2.0 ** max(1, consecutive_restarts))


@dataclass
class ServiceSpec:
    """Specification of a managed service."""

    name: str
    cmd: list[str]
    cwd: Path | str
    env: dict[str, str] = field(default_factory=dict)
    health_url: str = ""
    health_ok: Callable[[Any], bool] = field(default=lambda r: getattr(r, "status_code", 0) == 200)
    start_grace_s: float = 30.0
    depends_on: str | None = None
    port: int | None = None


@dataclass
class ServiceState:
    """Runtime tracking state of a managed service."""

    spec: ServiceSpec
    pid: int | None = None
    proc: Any | None = None
    status: str = STATUS_STOPPED
    restarts: int = 0
    consecutive_restarts: int = 0
    restart_timestamps: list[float] = field(default_factory=list)
    consecutive_health_failures: int = 0
    last_health: str | None = None
    last_error: str | None = None
    started_at: float | None = None
    healthy_since: float | None = None
    next_allowed_start: float = 0.0

    def record_start(self, pid: int, now: float, proc: Any = None) -> None:
        self.pid = pid
        self.proc = proc
        self.status = STATUS_STARTING
        self.started_at = now
        self.consecutive_health_failures = 0
        self.last_error = None
        self.healthy_since = None

    def record_health_success(self, now: float, now_iso: str) -> None:
        self.consecutive_health_failures = 0
        self.last_health = now_iso
        self.last_error = None
        self.status = STATUS_HEALTHY
        if self.healthy_since is None:
            self.healthy_since = now
        elif (now - self.healthy_since) >= 600.0:  # 10 min stable
            self.consecutive_restarts = 0
            self.restart_timestamps.clear()

    def record_health_failure(self, err_msg: str, now: float) -> bool:
        self.last_error = err_msg
        self.healthy_since = None

        in_grace = (
            self.started_at is not None
            and (now - self.started_at) < self.spec.start_grace_s
        )
        if in_grace and self.status == STATUS_STARTING:
            return False

        self.consecutive_health_failures += 1
        if self.status != STATUS_CRASH_LOOP:
            self.status = STATUS_UNHEALTHY

        return self.consecutive_health_failures >= 3

    def record_restart(self, now: float, reason: str = "") -> tuple[float, bool]:
        self.restarts += 1
        self.consecutive_restarts += 1
        self.restart_timestamps.append(now)
        # Window: 15 minutes (900 s)
        self.restart_timestamps = [t for t in self.restart_timestamps if (now - t) <= 900.0]
        is_crash_loop = len(self.restart_timestamps) > 10

        if is_crash_loop:
            self.status = STATUS_CRASH_LOOP
            backoff = compute_backoff(self.consecutive_restarts, is_crash_loop=True)
            logger.error(
                f"Service {self.spec.name} entered crash-loop (>10 restarts in 15m). "
                f"Retrying in {backoff}s. Reason: {reason}"
            )
        else:
            self.status = STATUS_RESTARTING
            backoff = compute_backoff(self.consecutive_restarts, is_crash_loop=False)
            logger.warning(
                f"Service {self.spec.name} restarting (attempt {self.consecutive_restarts}). "
                f"Backoff {backoff}s. Reason: {reason}"
            )

        self.next_allowed_start = now + backoff
        self.last_error = reason
        self.proc = None
        self.pid = None
        self.healthy_since = None
        self.consecutive_health_failures = 0
        return backoff, is_crash_loop

    def to_dict(self) -> dict[str, Any]:
        return {
            "pid": self.pid,
            "status": self.status,
            "restarts": self.restarts,
            "last_health": self.last_health,
            "last_error": self.last_error,
        }


# --- Helpers & System abstractions ---


def default_backend_health_ok(r: Any) -> bool:
    try:
        code = getattr(r, "status_code", None)
        if code != 200:
            return False
        data = r.json() if callable(getattr(r, "json", None)) else {}
        return data.get("warmup") == "ready"
    except Exception:
        return False


def default_frontend_health_ok(r: Any) -> bool:
    try:
        return getattr(r, "status_code", None) == 200
    except Exception:
        return False


def get_default_specs(port: int = 8080, repo_dir: Path | None = None) -> list[ServiceSpec]:
    if port == 80:
        raise ValueError("Port 80 is reserved for another application and cannot be used.")
    if repo_dir is None:
        repo_dir = Path(__file__).resolve().parents[3]

    backend_dir = repo_dir / "backend"
    frontend_dir = repo_dir / "frontend"

    backend_spec = ServiceSpec(
        name="backend",
        cmd=[
            sys.executable,
            "-m",
            "uvicorn",
            "atalaya.api.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8001",
            "--workers",
            "2",
            "--timeout-keep-alive",
            "5",
        ],
        cwd=backend_dir,
        env={"ATALAYA_STORE": "auto", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        health_url="http://127.0.0.1:8001/api/health",
        health_ok=default_backend_health_ok,
        start_grace_s=30.0,
        depends_on=None,
        port=8001,
    )

    node_bin = shutil.which("node") or "node"
    frontend_spec = ServiceSpec(
        name="frontend",
        cmd=[
            node_bin,
            "node_modules/next/dist/bin/next",
            "start",
            "-H",
            "0.0.0.0",
            "-p",
            str(port),
        ],
        cwd=frontend_dir,
        env={"NEXT_TELEMETRY_DISABLED": "1", "BACKEND_URL": "http://127.0.0.1:8001"},
        health_url=f"http://127.0.0.1:{port}/",
        health_ok=default_frontend_health_ok,
        start_grace_s=30.0,
        depends_on="backend",
        port=port,
    )

    return [backend_spec, frontend_spec]


def kill_process_tree(pid: int) -> None:
    """Kill process tree on Windows or POSIX."""
    if pid <= 4:
        return
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                check=False,
                timeout=5,
            )
        except Exception as e:
            logger.debug(f"Failed to taskkill PID {pid}: {e}")
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass


def is_pid_alive(pid: int) -> bool:
    """Check if process exists in the OS."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            res = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                check=False,
                timeout=3,
            )
            output = res.stdout.strip()
            return bool(output and f'"{pid}"' in output)
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def get_process_on_port(port: int) -> tuple[int, str] | None:
    """Inspect which process is listening on the given TCP port."""
    if sys.platform == "win32":
        try:
            res = subprocess.run(
                ["netstat", "-ano", "-p", "tcp"],
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )
            port_pattern = f":{port} "
            target_pid = None
            for line in res.stdout.splitlines():
                if "LISTENING" in line and port_pattern in line:
                    parts = line.strip().split()
                    if parts:
                        try:
                            target_pid = int(parts[-1])
                            break
                        except ValueError:
                            pass
            if target_pid and target_pid > 4:
                # Resolve process name
                p_res = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {target_pid}", "/FO", "CSV", "/NH"],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=3,
                )
                p_name = ""
                for p_line in p_res.stdout.splitlines():
                    if f'"{target_pid}"' in p_line:
                        parts = [p.strip('"') for p in p_line.split('","')]
                        if parts:
                            p_name = parts[0]
                return (target_pid, p_name or "unknown")
        except Exception as e:
            logger.debug(f"Error inspecting port {port}: {e}")
            return None
    return None


def default_health_checker(url: str, timeout_s: float = 5.0) -> Any:
    """Default HTTP health checker using httpx or urllib."""
    try:
        import httpx

        with httpx.Client(timeout=timeout_s) as client:
            return client.get(url)
    except ImportError:
        import urllib.request

        req = urllib.request.Request(url, headers={"User-Agent": "ATALAYA-Supervisor/1.0"})
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:

            class SimpleResponse:
                def __init__(self, r: Any):
                    self.status_code = getattr(r, "status", getattr(r, "code", 200))
                    self._content = r.read()

                def json(self) -> Any:
                    return json.loads(self._content.decode("utf-8"))

                @property
                def text(self) -> str:
                    return self._content.decode("utf-8")

            return SimpleResponse(resp)


def rotate_service_log_if_needed(log_path: Path, max_bytes: int = 20 * 1024 * 1024) -> None:
    try:
        if log_path.exists() and log_path.stat().st_size >= max_bytes:
            backup = log_path.with_name(f"{log_path.stem}.log.1")
            if backup.exists():
                backup.unlink()
            log_path.rename(backup)
    except Exception as e:
        logger.warning(f"Failed to rotate service log {log_path}: {e}")


def default_launcher(spec: ServiceSpec, log_path: Path) -> subprocess.Popen:
    rotate_service_log_if_needed(log_path)
    log_file = open(log_path, "a", encoding="utf-8", errors="replace")
    merged_env = os.environ.copy()
    merged_env.update(spec.env)

    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    proc = subprocess.Popen(
        spec.cmd,
        cwd=str(spec.cwd),
        env=merged_env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        creationflags=creationflags,
    )
    return proc


def save_state_atomic(state_file: Path, state_data: dict[str, Any]) -> None:
    """Atomically write JSON state by writing to a temp file and replacing."""
    state_file.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = state_file.with_name(f"{state_file.name}.tmp.{os.getpid()}")
    content = json.dumps(state_data, indent=2, ensure_ascii=False)
    with open(tmp_file, "w", encoding="utf-8") as f:
        f.write(content)
        f.flush()
        try:
            os.fsync(f.fileno())
        except Exception:
            pass
    os.replace(tmp_file, state_file)


class Supervisor:
    """Core process supervisor managing health, restart loops, and state."""

    def __init__(
        self,
        specs: list[ServiceSpec],
        cache_dir: Path,
        port: int = 8080,
        public_url: str | None = None,
        clock: Callable[[], float] = time.time,
        sleep_fn: Callable[[float], None] = time.sleep,
        launcher: Callable[[ServiceSpec, Path], Any] = default_launcher,
        process_poll: Callable[[Any], int | None] = lambda p: p.poll(),
        killer: Callable[[int], None] = kill_process_tree,
        health_checker: Callable[[str, float], Any] = default_health_checker,
        port_inspector: Callable[[int], tuple[int, str] | None] = get_process_on_port,
        is_alive_fn: Callable[[int], bool] = is_pid_alive,
    ):
        self.specs = specs
        self.cache_dir = cache_dir
        self.logs_dir = cache_dir / "logs"
        self.state_file = cache_dir / "supervisor_state.json"
        self.pid_file = cache_dir / "supervisor.pid"
        self.stop_file = cache_dir / "supervisor.stop"
        self.port = port
        self.public_url = public_url or os.getenv(
            "ATALAYA_PUBLIC_URL", f"http://46.250.172.193:{port}"
        )

        self.clock = clock
        self.sleep_fn = sleep_fn
        self.launcher = launcher
        self.process_poll = process_poll
        self.killer = killer
        self.health_checker = health_checker
        self.port_inspector = port_inspector
        self.is_alive_fn = is_alive_fn

        self.services: dict[str, ServiceState] = {
            spec.name: ServiceState(spec=spec) for spec in specs
        }
        self.started_at: float = self.clock()
        self.should_stop: bool = False

    def can_start(self, name: str, now: float) -> bool:
        state = self.services[name]
        if state.status not in (STATUS_STOPPED, STATUS_RESTARTING, STATUS_CRASH_LOOP):
            return False

        if now < state.next_allowed_start:
            return False

        if state.spec.depends_on:
            dep_name = state.spec.depends_on
            dep = self.services.get(dep_name)
            if dep:
                if dep.status == STATUS_HEALTHY:
                    return True
                if dep.started_at is not None and (now - dep.started_at) >= 180.0:
                    return True
                return False

        return True

    def check_port(self, spec: ServiceSpec, state: ServiceState, now: float) -> bool:
        if spec.port is None:
            return True
        if spec.port == 80:
            raise ValueError("Port 80 is strictly reserved and cannot be used.")

        proc_info = self.port_inspector(spec.port)
        if proc_info is not None:
            occ_pid, occ_name = proc_info
            if state.pid is not None and occ_pid == state.pid:
                return True
            logger.warning(
                f"Port {spec.port} is occupied by foreign process PID {occ_pid} ({occ_name}). "
                f"Will not kill it. Waiting to retry with backoff."
            )
            state.record_restart(
                now,
                reason=f"Port {spec.port} occupied by foreign process PID {occ_pid} ({occ_name})",
            )
            return False
        return True

    def tick(self, now: float | None = None) -> None:
        """Run one single supervisory tick."""
        if now is None:
            now = self.clock()

        iso_time = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()

        for name, state in self.services.items():
            spec = state.spec

            # 1. If process is tracked, check if still running
            if state.proc is not None:
                exit_code = self.process_poll(state.proc)
                if exit_code is not None:
                    reason = f"Process terminated unexpectedly with exit code {exit_code}"
                    logger.warning(f"Service {name} (PID {state.pid}) died: {reason}")
                    state.record_restart(now, reason)
                    continue

                # Process is alive; perform health check
                try:
                    res = self.health_checker(spec.health_url, 5.0)
                    if spec.health_ok(res):
                        state.record_health_success(now, iso_time)
                    else:
                        reason = f"Health check returned unhealthy response for {spec.health_url}"
                        should_restart = state.record_health_failure(reason, now)
                        if should_restart:
                            logger.warning(
                                f"Service {name} failed health check 3 consecutive times; restarting."
                            )
                            if state.pid:
                                self.killer(state.pid)
                            state.record_restart(
                                now, reason="Health check failed 3 consecutive times"
                            )
                except Exception as e:
                    reason = f"Health check request exception: {e}"
                    should_restart = state.record_health_failure(reason, now)
                    if should_restart:
                        logger.warning(
                            f"Service {name} failed health check 3 consecutive times; restarting."
                        )
                        if state.pid:
                            self.killer(state.pid)
                        state.record_restart(
                            now, reason="Health check failed 3 consecutive times"
                        )

            # 2. If service is not running, check if it can be started
            else:
                if self.can_start(name, now):
                    if not self.check_port(spec, state, now):
                        continue
                    log_path = self.logs_dir / f"{name}.log"
                    try:
                        self.logs_dir.mkdir(parents=True, exist_ok=True)
                        proc = self.launcher(spec, log_path)
                        pid = getattr(proc, "pid", None) or os.getpid()
                        state.record_start(pid, now, proc)
                        logger.info(f"Started service {name} with PID {pid}")
                    except Exception as e:
                        logger.error(f"Failed to launch service {name}: {e}")
                        state.record_restart(now, reason=f"Launch failed: {e}")

        self.save_state(now)

    def save_state(self, now: float | None = None) -> None:
        if now is None:
            now = self.clock()
        started_iso = datetime.fromtimestamp(self.started_at, tz=timezone.utc).isoformat()
        state_data = {
            "pid": os.getpid(),
            "started_at": started_iso,
            "public_url": self.public_url,
            "services": {name: st.to_dict() for name, st in self.services.items()},
        }
        save_state_atomic(self.state_file, state_data)

    def stop_all(self) -> None:
        """Orderly shutdown: stop frontend first, then backend."""
        logger.info("Stopping all services in orderly sequence (frontend then backend)...")

        shutdown_order = []
        if "frontend" in self.services:
            shutdown_order.append("frontend")
        for name in self.services:
            if name not in shutdown_order:
                shutdown_order.append(name)

        for name in shutdown_order:
            state = self.services[name]
            if state.pid:
                logger.info(f"Stopping service {name} (PID {state.pid})...")
                self.killer(state.pid)
                state.proc = None
                state.pid = None
            state.status = STATUS_STOPPED

        self.save_state()

        if self.pid_file.exists():
            try:
                self.pid_file.unlink()
            except Exception:
                pass
        if self.stop_file.exists():
            try:
                self.stop_file.unlink()
            except Exception:
                pass

        logger.info("All services stopped.")

    def run_loop(self) -> None:
        """Main supervisor loop with health check every 10s and 1s stop polling."""
        # Handle termination signals
        def _handle_signal(sig: int, frame: Any) -> None:
            logger.info(f"Received termination signal {sig}. Initiating shutdown.")
            self.should_stop = True

        signal.signal(signal.SIGINT, _handle_signal)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, _handle_signal)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, _handle_signal)

        logger.info(f"Supervisor loop started. Public URL: {self.public_url}")

        while not self.should_stop:
            if self.stop_file.exists():
                logger.info("Stop flag file detected. Initiating shutdown.")
                break

            self.tick()

            # Sleep 10s total, checking stop conditions every 1s
            for _ in range(10):
                if self.should_stop or self.stop_file.exists():
                    break
                self.sleep_fn(1.0)

        self.stop_all()


def configure_supervisor_logging(logs_dir: Path) -> None:
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / "supervisor.log"

    root_logger = logging.getLogger("atalaya")
    root_logger.setLevel(logging.INFO)

    # 5 MB x 5 rotating handler
    handler = RotatingFileHandler(
        log_file,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    try:
        if sys.stdout is not None and hasattr(sys.stdout, "isatty") and sys.stdout.isatty():
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setFormatter(formatter)
            root_logger.addHandler(console_handler)
    except Exception:
        pass


def cmd_run(port: int = 8080) -> int:
    if port == 80:
        print("ERROR: Port 80 is strictly reserved for another application.", file=sys.stderr)
        return 1

    repo_dir = Path(__file__).resolve().parents[3]
    cache_dir = repo_dir / "data" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    pid_file = cache_dir / "supervisor.pid"

    # Check if existing supervisor is already running
    if pid_file.exists():
        try:
            old_pid = int(pid_file.read_text(encoding="utf-8").strip())
            if is_pid_alive(old_pid):
                print(
                    f"ERROR: Supervisor is already running with PID {old_pid}.",
                    file=sys.stderr,
                )
                return 3
        except (ValueError, OSError):
            pass

    # Write own PID
    pid_file.write_text(str(os.getpid()), encoding="utf-8")

    configure_supervisor_logging(cache_dir / "logs")
    specs = get_default_specs(port=port, repo_dir=repo_dir)
    supervisor = Supervisor(specs=specs, cache_dir=cache_dir, port=port)

    try:
        supervisor.run_loop()
        return 0
    finally:
        if pid_file.exists():
            try:
                pid_file.unlink()
            except Exception:
                pass


def cmd_status() -> int:
    repo_dir = Path(__file__).resolve().parents[3]
    cache_dir = repo_dir / "data" / "cache"
    state_file = cache_dir / "supervisor_state.json"
    pid_file = cache_dir / "supervisor.pid"

    sup_pid = None
    if pid_file.exists():
        try:
            sup_pid = int(pid_file.read_text(encoding="utf-8").strip())
        except ValueError:
            pass

    sup_alive = is_pid_alive(sup_pid) if sup_pid else False

    print("=" * 65)
    print(" ATALAYA Supervisor Status")
    print("=" * 65)
    print(f" Supervisor PID : {sup_pid if sup_pid else 'N/A'}")
    print(f" Alive in OS    : {'YES' if sup_alive else 'NO'}")

    if not state_file.exists():
        print(" State file     : None (supervisor has not run or no state saved)")
        print("=" * 65)
        return 0 if sup_alive else 1

    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
    except Exception as e:
        print(f" Error reading state file: {e}")
        print("=" * 65)
        return 1

    print(f" Started At     : {state.get('started_at', 'N/A')}")
    print(f" Public URL     : {state.get('public_url', 'N/A')}")
    print("-" * 65)
    print(f"{'SERVICE':<12} {'PID':<8} {'STATUS':<12} {'RESTARTS':<10} {'ALIVE':<8}")
    print("-" * 65)

    services = state.get("services", {})
    for name, s in services.items():
        pid = s.get("pid")
        alive = is_pid_alive(pid) if pid else False
        alive_str = "YES" if alive else "NO"
        status = s.get("status", "unknown")
        restarts = s.get("restarts", 0)
        print(f"{name:<12} {str(pid or '-'):<8} {status:<12} {str(restarts):<10} {alive_str:<8}")
        if s.get("last_error"):
            print(f"  └─ Last error: {s.get('last_error')}")

    print("=" * 65)
    return 0


def cmd_stop() -> int:
    repo_dir = Path(__file__).resolve().parents[3]
    cache_dir = repo_dir / "data" / "cache"
    pid_file = cache_dir / "supervisor.pid"
    stop_file = cache_dir / "supervisor.stop"
    state_file = cache_dir / "supervisor_state.json"

    if not pid_file.exists():
        print("Supervisor is not running (no supervisor.pid found).")
        return 0

    try:
        sup_pid = int(pid_file.read_text(encoding="utf-8").strip())
    except ValueError:
        sup_pid = None

    if not sup_pid or not is_pid_alive(sup_pid):
        print(f"Supervisor PID {sup_pid} is not active. Cleaning up stale pid file.")
        if pid_file.exists():
            pid_file.unlink()
        return 0

    print(f"Signaling supervisor (PID {sup_pid}) to stop...")
    stop_file.touch(exist_ok=True)

    # Wait up to 30 s for supervisor to exit
    start_t = time.time()
    clean_exit = False
    while time.time() - start_t < 30.0:
        if not is_pid_alive(sup_pid):
            clean_exit = True
            break
        time.sleep(0.5)

    if clean_exit:
        print("Supervisor stopped cleanly.")
    else:
        print("Supervisor did not stop within 30 s. Forcing termination of process trees...")
        # Force kill service PIDs from state
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text(encoding="utf-8"))
                for name, s in state.get("services", {}).items():
                    pid = s.get("pid")
                    if pid and is_pid_alive(pid):
                        print(f"Force killing service {name} (PID {pid})...")
                        kill_process_tree(pid)
            except Exception:
                pass
        kill_process_tree(sup_pid)
        print("Supervisor process killed.")

    if pid_file.exists():
        try:
            pid_file.unlink()
        except Exception:
            pass
    if stop_file.exists():
        try:
            stop_file.unlink()
        except Exception:
            pass

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ATALAYA Fault-Tolerant Process Supervisor")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run the supervisor process")
    run_parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Public web port for Next.js (default: 8080)",
    )

    subparsers.add_parser("status", help="Show current status of supervisor and managed services")
    subparsers.add_parser("stop", help="Stop the supervisor and all managed services")

    args = parser.parse_args(argv)

    cmd = args.command or "run"
    if cmd == "run":
        port = getattr(args, "port", 8080)
        return cmd_run(port=port)
    elif cmd == "status":
        return cmd_status()
    elif cmd == "stop":
        return cmd_stop()
    else:
        parser.print_help()
        return 1


if __name__ == "__main__":
    sys.exit(main())
