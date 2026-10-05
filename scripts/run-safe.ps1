<#
.SYNOPSIS
  Runs a command for an automated agent: never waits for input, never hangs,
  always returns an exit code.

.DESCRIPTION
  - stdin is an empty file, so any prompt (y/N, watch mode, "press a key")
    gets EOF immediately instead of waiting forever.
  - CI / no-telemetry / UTF-8 variables are set for the child only.
  - Hard timeout (-TimeoutSec) and optional inactivity timeout (-IdleSec:
    no new output for N seconds). On expiry the whole process tree is killed
    (taskkill /T) and the exit code is 124, as in GNU `timeout`.
  - stdout/stderr go to log files; the last -Tail lines are printed at the end
    together with a one-line summary that is easy to grep: "[run-safe] exit=...".

  Do NOT use this for servers (uvicorn, next start, databases). Those never
  exit by design; launch them detached (Start-Process) and poll their health URL.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-safe.ps1 -TimeoutSec 180 -Cwd backend -- python -m pytest tests/test_llm.py
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-safe.ps1 -TimeoutSec 300 -IdleSec 120 -Cwd frontend -Env NEXT_AGENT_BUILD=1 -- npm run build
#>
[CmdletBinding()]
param(
    [int]$TimeoutSec = 300,
    [int]$IdleSec = 0,
    [string]$Cwd = (Get-Location).Path,
    [int]$Tail = 60,
    [string[]]$Env = @(),
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Cmd
)

$ErrorActionPreference = 'Stop'

$cmdLine = $Cmd.Trim()
if (-not $cmdLine) {
    Write-Output '[run-safe] usage: run-safe.ps1 [-TimeoutSec N] [-IdleSec N] [-Cwd dir] [-Env K=V,...] "<command line>"'
    exit 2
}

# Non-interactive, no telemetry, unbuffered UTF-8. Inherited by the child only.
$vars = @{
    CI = '1'; NONINTERACTIVE = '1'; DEBIAN_FRONTEND = 'noninteractive'
    PYTHONUNBUFFERED = '1'; PYTHONUTF8 = '1'; PYTHONIOENCODING = 'utf-8'
    NEXT_TELEMETRY_DISABLED = '1'; DO_NOT_TRACK = '1'; NO_UPDATE_NOTIFIER = '1'
    npm_config_yes = 'true'; npm_config_fund = 'false'; npm_config_audit = 'false'
    PIP_NO_INPUT = '1'; PIP_DISABLE_PIP_VERSION_CHECK = '1'
    GIT_TERMINAL_PROMPT = '0'; NO_COLOR = '1'; FORCE_COLOR = '0'
}
foreach ($kv in $Env) {
    $i = $kv.IndexOf('=')
    if ($i -gt 0) { $vars[$kv.Substring(0, $i)] = $kv.Substring($i + 1) }
}
foreach ($k in $vars.Keys) { Set-Item -Path "Env:$k" -Value $vars[$k] }

# Log directory: system temp if writable (a sandbox may forbid it), else next to the command.
$logDir = Join-Path ([IO.Path]::GetTempPath()) 'run-safe'
try { New-Item -ItemType Directory -Force -Path $logDir | Out-Null; [IO.File]::WriteAllText((Join-Path $logDir '.probe'), '') }
catch { $logDir = Join-Path $Cwd '.run-safe-logs'; New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $PID
$outLog = Join-Path $logDir "$stamp.out.log"
$errLog = Join-Path $logDir "$stamp.err.log"
$inFile = Join-Path $logDir "$stamp.stdin"
[IO.File]::WriteAllText($inFile, '')

$sw = [Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/s', '/c', "`"$cmdLine`"" `
    -WorkingDirectory $Cwd -NoNewWindow -PassThru `
    -RedirectStandardInput $inFile -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$null = $proc.Handle  # caches the handle so ExitCode is readable after exit (PowerShell 5.1 quirk)

$reason = ''
$lastSize = -1
$lastChange = $sw.Elapsed.TotalSeconds
while (-not $proc.WaitForExit(1000)) {
    $now = $sw.Elapsed.TotalSeconds
    $size = 0
    foreach ($f in @($outLog, $errLog)) { if (Test-Path $f) { $size += (Get-Item $f).Length } }
    if ($size -ne $lastSize) { $lastSize = $size; $lastChange = $now }
    if ($TimeoutSec -gt 0 -and $now -ge $TimeoutSec) { $reason = "timeout ${TimeoutSec}s"; break }
    if ($IdleSec -gt 0 -and ($now - $lastChange) -ge $IdleSec) { $reason = "no output for ${IdleSec}s"; break }
}

if ($reason) {
    & taskkill.exe /T /F /PID $proc.Id 2>&1 | Out-Null
    $code = 124
} else {
    $proc.WaitForExit()
    $code = $proc.ExitCode
    if ($null -eq $code) { $code = 1 }
}
$elapsed = [Math]::Round($sw.Elapsed.TotalSeconds, 1)

foreach ($pair in @(@('stdout', $outLog), @('stderr', $errLog))) {
    if ((Test-Path $pair[1]) -and (Get-Item $pair[1]).Length -gt 0) {
        Write-Output "----- $($pair[0]) (last $Tail lines) -----"
        Get-Content -Path $pair[1] -Tail $Tail -Encoding UTF8
    }
}
Remove-Item -Path $inFile -ErrorAction SilentlyContinue
$killed = if ($reason) { "KILLED ($reason)" } else { 'completed' }
Write-Output "[run-safe] exit=$code $killed elapsed=${elapsed}s cmd=$cmdLine logs=$outLog"
exit $code
