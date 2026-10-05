---
trigger: always_on
description: How agents and subagents run terminal commands without hanging or waiting idle (Windows, Antigravity). Enforced by the agent-guard hook.
---

# Terminal execution rules (all projects)

An `agent-guard` hook inspects every `run_command` before it runs. It wraps tests, builds,
installs and scripts in `run-safe.ps1` (empty stdin, CI environment, hard and inactivity
timeouts, exit code 124 when it kills something), blocks foreground servers and git/GitHub
writes, and may move the command out of the terminal sandbox. When a tool result says a hook
rewrote your command, that is expected; read the final `[run-safe] exit=<code> ...` line.

1. **Commands longer than 10 s always become background tasks** (`WaitMsBeforeAsync` is capped
   at 10 000 ms). Wait for them with the `schedule` tool using the task as its condition, sized
   to the expected duration (for example 120 s for a test run), so you wake up the moment it
   finishes. Do not poll with `manage_task status` or by re-reading the log every turn.
2. **Never start a server in the foreground** (uvicorn, next dev/start, vite, flask, databases,
   workers, `--watch`). Use the repo's start script, or `Start-Process ... -WindowStyle Hidden`
   with stdout/stderr redirected to log files; poll its health URL for at most ~60 s; stop
   everything you started before you finish.
3. **Non-interactive always**: test runners in run mode, installers with `-y` / `--yes`, never
   watch mode. Prompts receive EOF.
4. **Tests run in-process.** Import the function and call it; do not spawn `node`, `python` or
   a CLI from inside a test (`spawnSync`, `execSync`, `subprocess.run`) when you can import it.
5. **Parallel agents**: run only your own test files; give pytest a per-agent
   `--basetemp=.pytest_tmp/<agent-name>`.
6. **Killed with exit 124?** The command hung or went silent. Read the log tail, fix the cause
   (prompt, watch mode, network, deadlock), and do not relaunch it unchanged.
7. **Inner double quotes** are safe now (the guard passes your command base64-encoded), but keep
   long scripts in a `.py` / `.ps1` file rather than a giant one-liner.
8. **Subagents created with `define_subagent` do not inherit anything**: the tool always writes
   `inheritCustomizations: false` (it has no parameter for it), so those subagents get neither
   these rules, nor the repository's `AGENTS.md`, nor the agent-guard hook. Put the essential
   command rules in the subagent's prompt and tell it to read `AGENTS.md` first. Agents defined
   ahead of time in an `agent.md` with `inheritCustomizations: true` do inherit them.
