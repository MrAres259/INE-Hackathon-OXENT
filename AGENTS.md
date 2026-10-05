# Agent rules for this repository (ATALAYA)

Every terminal command an agent runs here passes through the machine's `agent-guard` hook
(see `%USERPROFILE%\agent-tools\README.md`) with this repo's `.agent-guard.json`: tests, builds,
installs and scripts are wrapped in `run-safe.ps1` (empty stdin, CI env, hard + inactivity
timeouts, exit 124 when it kills something), foreground servers and git/GitHub writes are blocked,
`pip install` is denied. Work with it, not around it: run **plain commands**; read the final
`[run-safe] exit=<code> ...` line.

## Commands

| Task | Command | Run from |
|---|---|---|
| Backend tests, **your files only** | `python -m pytest tests/test_<yours>.py -q -p no:cacheprovider --basetemp=.pytest_tmp/<your-agent-name>` | `backend` |
| Data ingest / model / loader | `python -m atalaya.ingest.<module>` · `python -m atalaya.model.build` · `python -m atalaya.load --dry-run` | `backend` |
| Frontend type check | `npm run typecheck` | `frontend` |
| Frontend tests | `npm test` (= `vitest run`, never watch) | `frontend` |
| Frontend build | `npm run build` (the guard sets `NEXT_AGENT_BUILD=1`) | `frontend` |
| Geo tests / build | `npm test` · `node --max-old-space-size=6144 build_geo.mjs` | `tools/geo` |
| Start / stop the app | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start_demo.ps1` (`-Mock` for mock data) · `...\scripts\stop_demo.ps1` | repo root |

## Rules

- **Commands longer than 10 s become background tasks.** Wait for them with the `schedule` tool
  using the task as its condition, sized to the expected duration (tests ≈ 60–120 s, Next build
  ≈ 120–300 s). Never poll with `manage_task status` or re-read logs every turn.
- **Never run a server in the foreground** (`uvicorn`, `next dev/start`): use the start/stop
  scripts above. Anything you start, you stop before you finish.
- **Run only your own test files**, with a per-agent `--basetemp`. Other agents are editing other
  modules at the same time; the architect runs the full suite during the audit.
- **Tests run in-process**: import and call the function; do not spawn `python`, `node` or a CLI
  from inside a test.
- **Exit 124 = it hung or went silent.** Read the log tail, fix the cause (prompt, watch mode,
  network, deadlock); do not relaunch it unchanged.
- **Network**: tests never touch the network (`backend/tests/conftest.py` blocks the ES client).
  The Huawei CSS cluster is unreachable from this machine; the LLM is reachable but slow (≈4 s).
  No new dependencies: everything needed is already installed.
- If a Next build fails with a file-read or UTF-8 error on a file that looks fine, delete
  `frontend/.next` (stale cache) and build again once.
- Windows console is cp1252: CLIs that print accented data run with `PYTHONIOENCODING=utf-8`
  (the guard sets it).
- `C:\Users\Administrator\Desktop\Hackathon` (RAÍZ) is **read-only reference**: never write there.

## Unchanged project rules

No git or GitHub commands of any kind. Touch only the files your task assigns to you. No report or
summary files. Never print secrets from `backend/.env`.
