# ATALAYA - Public launcher: backend + frontend in one Windows Terminal window (two panes)
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)
#
# Only the web port is published. Next.js proxies /api/* to the backend (next.config.ts rewrites),
# so FastAPI listens on 127.0.0.1 and is never reachable from outside.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start_public.ps1 [-Port 3000] [-Rebuild] [-NoFirewall]
#
# Close the window (or Ctrl+C in each pane) to stop; scripts\stop_demo.ps1 also stops it.

[CmdletBinding()]
param(
    [ValidateSet("launcher", "backend", "frontend")]
    [string]$Role = "launcher",
    [int]$Port = 3000,
    [switch]$Rebuild,
    [switch]$NoFirewall
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ApiPort = 8001  # fixed: the /api rewrite target is compiled into the Next build (BACKEND_URL)
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$scriptPath = $MyInvocation.MyCommand.Path

function Wait-Http {
    param([string]$Uri, [int]$TimeoutSec, [scriptblock]$Ok)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
        try {
            $res = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if (& $Ok $res) { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return $false
}

# ---------------------------------------------------------------- pane: backend
if ($Role -eq "backend") {
    $Host.UI.RawUI.WindowTitle = "ATALAYA backend :$ApiPort"
    $env:ATALAYA_STORE = "auto"
    $env:PYTHONIOENCODING = "utf-8"
    $env:PYTHONUTF8 = "1"
    Set-Location $backendDir
    Write-Host "ATALAYA backend (FastAPI) on 127.0.0.1:$ApiPort - local only, published through the web proxy" -ForegroundColor Cyan
    & python -m uvicorn atalaya.api.main:app --host 127.0.0.1 --port $ApiPort
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------- pane: frontend
if ($Role -eq "frontend") {
    $Host.UI.RawUI.WindowTitle = "ATALAYA web :$Port"
    $env:NEXT_TELEMETRY_DISABLED = "1"
    Set-Location $frontendDir
    Write-Host "Waiting for the backend to finish warmup..." -ForegroundColor Yellow
    $ready = Wait-Http -Uri "http://127.0.0.1:$ApiPort/api/health" -TimeoutSec 180 -Ok { param($r) ($r.Content | ConvertFrom-Json).warmup -eq "ready" }
    if (-not $ready) { Write-Host "Backend not ready after 180 s; starting the web anyway (see the backend pane)." -ForegroundColor Red }
    Write-Host "ATALAYA web (Next.js) on 0.0.0.0:$Port" -ForegroundColor Cyan
    & npx.cmd next start -H 0.0.0.0 -p $Port
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------- launcher
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA - public launch (web :$Port, API local :$ApiPort)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Ports must be free
foreach ($p in @($ApiPort, $Port)) {
    $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        $procId = ($busy | Select-Object -First 1).OwningProcess
        $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Write-Host "[-] Port $p is already in use (PID $procId, $name)." -ForegroundColor Red
        Write-Host "    If it is a previous ATALAYA run: powershell -ExecutionPolicy Bypass -File scripts\stop_demo.ps1" -ForegroundColor Yellow
        exit 1
    }
}

# 2. Production build of the frontend (once, or with -Rebuild)
$buildId = Join-Path $frontendDir ".next\BUILD_ID"
if ($Rebuild -or -not (Test-Path $buildId)) {
    Write-Host "`nBuilding frontend (npm run build)..." -ForegroundColor Yellow
    Remove-Item -Path (Join-Path $frontendDir ".next\lock") -Force -ErrorAction SilentlyContinue
    Push-Location $frontendDir
    try {
        $env:NEXT_TELEMETRY_DISABLED = "1"
        $env:BACKEND_URL = "http://127.0.0.1:$ApiPort"
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { Write-Host "[-] Frontend build failed ($LASTEXITCODE)." -ForegroundColor Red; exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}

# 3. Windows Firewall: allow inbound TCP on the web port (requires an elevated shell)
if (-not $NoFirewall) {
    $ruleName = "ATALAYA web (TCP $Port)"
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
        Write-Host "[+] Firewall rule '$ruleName' already present." -ForegroundColor Green
    } elseif ($isAdmin) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
        Write-Host "[+] Firewall rule '$ruleName' created." -ForegroundColor Green
    } else {
        Write-Host "[!] Not elevated: could not open TCP $Port in Windows Firewall. Re-run as Administrator." -ForegroundColor Yellow
    }
}

# 4. One window, two panes (Windows Terminal); two console windows as fallback
$psArgs = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
    $wtArgs = "-w new new-tab --title `"ATALAYA backend :$ApiPort`" --suppressApplicationTitle -d `"$backendDir`" powershell.exe $psArgs -Role backend" +
              " ; split-pane -V --title `"ATALAYA web :$Port`" --suppressApplicationTitle -d `"$frontendDir`" powershell.exe $psArgs -Role frontend -Port $Port"
    Start-Process -FilePath $wt.Source -ArgumentList $wtArgs | Out-Null
    Write-Host "[+] Windows Terminal opened: backend (left) | web (right)." -ForegroundColor Green
} else {
    Start-Process powershell.exe -ArgumentList "$psArgs -Role backend" -WorkingDirectory $backendDir | Out-Null
    Start-Process powershell.exe -ArgumentList "$psArgs -Role frontend -Port $Port" -WorkingDirectory $frontendDir | Out-Null
    Write-Host "[+] Windows Terminal not found: opened two PowerShell windows." -ForegroundColor Yellow
}

# 5. Wait for the web and print the addresses
Write-Host "`nWaiting for the app (max 240 s)..." -ForegroundColor Yellow
$up = Wait-Http -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 240 -Ok { param($r) $r.StatusCode -eq 200 }
if (-not $up) {
    Write-Host "[-] The app did not answer on :$Port/api/health. Check the panes for errors." -ForegroundColor Red
    exit 1
}

$publicIp = $null
try { $publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 5).ToString().Trim() } catch {}
$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA is up" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Local:    http://localhost:$Port" -ForegroundColor Green
foreach ($ip in $lanIps) { Write-Host " Network:  http://${ip}:$Port" -ForegroundColor Green }
if ($publicIp) {
    Write-Host " Public:   http://${publicIp}:$Port" -ForegroundColor Green
} else {
    Write-Host " Public:   (could not detect the public IP)" -ForegroundColor Yellow
}
Write-Host "`n If the public URL does not open from outside, allow inbound TCP $Port in the" -ForegroundColor Yellow
Write-Host " cloud provider's security group / network firewall (outside this machine)." -ForegroundColor Yellow
Write-Host " Stop: close the Windows Terminal window, or scripts\stop_demo.ps1" -ForegroundColor Gray
Write-Host "==========================================================`n" -ForegroundColor Cyan
exit 0
