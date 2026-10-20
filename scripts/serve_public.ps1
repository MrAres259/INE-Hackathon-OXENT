# ATALAYA - Fault-tolerant public server launcher and supervisor manager
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)
#
# Only the web port is published. Next.js proxies /api/* to the backend (next.config.ts rewrites),
# so FastAPI listens on 127.0.0.1:8001 and is never exposed to the public internet.

[CmdletBinding()]
param(
    [int]$Port = 8080,
    [switch]$Rebuild,
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$Stop,
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ApiPort = 8001
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$cacheDir = Join-Path $repoRoot "data\cache"
$stateFile = Join-Path $cacheDir "supervisor_state.json"
$pidFile = Join-Path $cacheDir "supervisor.pid"

if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}

$pythonCmd = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "[-] python.exe not found in PATH." -ForegroundColor Red
    exit 1
}
$pythonExe = $pythonCmd.Source

# ---------------------------------------------------------------- Status delegation
if ($Status) {
    Push-Location $backendDir
    try {
        & $pythonExe -m atalaya.ops.supervisor status
        exit $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------- Stop delegation
if ($Stop) {
    Push-Location $backendDir
    try {
        & $pythonExe -m atalaya.ops.supervisor stop
        exit $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------- Uninstall Scheduled Task
if ($Uninstall) {
    Write-Host "Uninstalling ATALAYA scheduled task..." -ForegroundColor Yellow
    try {
        Stop-ScheduledTask -TaskName "ATALAYA" -ErrorAction SilentlyContinue
    } catch {}
    try {
        Unregister-ScheduledTask -TaskName "ATALAYA" -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "[+] Scheduled task 'ATALAYA' unregistered." -ForegroundColor Green
    } catch {
        Write-Host "[-] Failed or not found: $_" -ForegroundColor Yellow
    }

    Push-Location $backendDir
    try {
        & $pythonExe -m atalaya.ops.supervisor stop
    } finally {
        Pop-Location
    }
    Write-Host "[+] ATALAYA uninstalled and stopped." -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------- Validate Port
if ($Port -eq 80) {
    Write-Host "[-] Port 80 is strictly reserved for another application on this machine." -ForegroundColor Red
    Write-Host "    ATALAYA must be published on another port (e.g., 8080)." -ForegroundColor Red
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA Public Launcher (Web :$Port, API :$ApiPort)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------- Check Ports
function Get-KnownSupervisorPids {
    param([string]$StatePath, [string]$PidPath)
    $pids = @()
    if (Test-Path $PidPath) {
        try {
            $val = (Get-Content -Path $PidPath -Raw -ErrorAction SilentlyContinue).Trim()
            if ($val -match '^\d+$') { $pids += [int]$val }
        } catch {}
    }
    if (Test-Path $StatePath) {
        try {
            $json = Get-Content -Path $StatePath -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
            if ($json.pid) { $pids += [int]$json.pid }
            if ($json.services) {
                if ($json.services.backend -and $json.services.backend.pid) { $pids += [int]$json.services.backend.pid }
                if ($json.services.frontend -and $json.services.frontend.pid) { $pids += [int]$json.services.frontend.pid }
            }
        } catch {}
    }
    return $pids
}

$supervisorPids = Get-KnownSupervisorPids -StatePath $stateFile -PidPath $pidFile

foreach ($checkPort in @($ApiPort, $Port)) {
    $conns = Get-NetTCPConnection -LocalPort $checkPort -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $ownerPid = ($conns | Select-Object -First 1).OwningProcess
        $isOwnSupervisor = $false
        foreach ($spid in $supervisorPids) {
            if ($spid -gt 0 -and $ownerPid -eq $spid) {
                $isOwnSupervisor = $true
                break
            }
        }

        if (-not $isOwnSupervisor) {
            $pName = "unknown"
            $p = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
            if ($p) { $pName = $p.ProcessName }
            Write-Host "[-] Port $checkPort is already occupied by a foreign process (PID: $ownerPid, Name: $pName)." -ForegroundColor Red
            Write-Host "    Cannot start ATALAYA until port $checkPort is released." -ForegroundColor Red
            exit 1
        }
    }
}

# ---------------------------------------------------------------- Production build of frontend
$buildId = Join-Path $frontendDir ".next\BUILD_ID"
if ($Rebuild -or (-not (Test-Path $buildId))) {
    Write-Host "`nBuilding frontend (npm run build)..." -ForegroundColor Yellow
    Remove-Item -Path (Join-Path $frontendDir ".next\lock") -Force -ErrorAction SilentlyContinue
    Push-Location $frontendDir
    try {
        $env:NEXT_TELEMETRY_DISABLED = "1"
        $env:BACKEND_URL = "http://127.0.0.1:$ApiPort"
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[-] Frontend build failed with exit code $LASTEXITCODE." -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
    Write-Host "[+] Frontend build completed successfully." -ForegroundColor Green
}

# ---------------------------------------------------------------- Windows Firewall
$ruleName = "ATALAYA web (TCP $Port)"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existingRule) {
    Write-Host "[+] Firewall rule '$ruleName' already present." -ForegroundColor Green
} elseif ($isAdmin) {
    try {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
        Write-Host "[+] Firewall rule '$ruleName' created." -ForegroundColor Green
    } catch {
        Write-Host "[!] Failed to create firewall rule: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "[!] Not elevated: could not configure Windows Firewall rule '$ruleName'." -ForegroundColor Yellow
}

# ---------------------------------------------------------------- Install as Scheduled Task
if ($Install) {
    Write-Host "`nRegistering Windows Scheduled Task 'ATALAYA'..." -ForegroundColor Yellow
    $action = New-ScheduledTaskAction -Execute $pythonExe -Argument "-m atalaya.ops.supervisor run --port $Port" -WorkingDirectory $backendDir
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

    try {
        Register-ScheduledTask -TaskName "ATALAYA" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
        Start-ScheduledTask -TaskName "ATALAYA"
        Write-Host "[+] Scheduled task 'ATALAYA' created and started as SYSTEM." -ForegroundColor Green
    } catch {
        Write-Host "[-] Failed to register or start scheduled task: $_" -ForegroundColor Red
        exit 1
    }
} else {
    # Foreground or Background execution
    if ($Foreground) {
        Write-Host "`nStarting supervisor in foreground..." -ForegroundColor Yellow
        Push-Location $backendDir
        try {
            & $pythonExe -m atalaya.ops.supervisor run --port $Port
            exit $LASTEXITCODE
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "`nStarting supervisor in background..." -ForegroundColor Yellow
        $supOut = Join-Path $cacheDir "logs\supervisor.out.log"
        $supErr = Join-Path $cacheDir "logs\supervisor.err.log"
        Set-Content -Path $supOut -Value ""
        Set-Content -Path $supErr -Value ""

        $cmdLine = "`"$pythonExe`" -m atalaya.ops.supervisor run --port $Port"
        $launched = $false
        try {
            $wmiRes = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
                CommandLine = $cmdLine
                CurrentDirectory = $backendDir
            } -ErrorAction Stop
            if ($wmiRes -and $wmiRes.ReturnValue -eq 0) {
                $launched = $true
            }
        } catch {}

        if (-not $launched) {
            Start-Process -FilePath $pythonExe `
                -ArgumentList "-m atalaya.ops.supervisor run --port $Port" `
                -WorkingDirectory $backendDir `
                -RedirectStandardOutput $supOut `
                -RedirectStandardError $supErr `
                -WindowStyle Hidden
        }
    }
}

# ---------------------------------------------------------------- Wait for Health Check
Write-Host "Waiting for the app to respond on :$Port/api/health (max 240 s)..." -ForegroundColor Yellow
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$isReady = $false
while ($sw.Elapsed.TotalSeconds -lt 240) {
    Start-Sleep -Seconds 2
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -Method Get -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($res.StatusCode -eq 200) {
            $isReady = $true
            break
        }
    } catch {
        # App still warming up
    }
}
$sw.Stop()

if (-not $isReady) {
    $elapsedSec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    Write-Host "[-] The app did not respond with 200 after ${elapsedSec}s." -ForegroundColor Red
    Write-Host "    Check logs in data\cache\logs\supervisor.log" -ForegroundColor Yellow
    exit 1
}

Write-Host "[+] App is ready in $([math]::Round($sw.Elapsed.TotalSeconds, 1))s." -ForegroundColor Green

# ---------------------------------------------------------------- Output URLs
$publicIp = $null
if ($env:ATALAYA_PUBLIC_URL) {
    $publicUrl = $env:ATALAYA_PUBLIC_URL
} else {
    try {
        $publicIp = (Invoke-RestMethod -Uri "https://api.ipify.org" -TimeoutSec 5).ToString().Trim()
    } catch {}
    if ($publicIp) {
        $publicUrl = "http://${publicIp}:$Port"
    } else {
        $publicUrl = "http://46.250.172.193:$Port"
    }
}

$lanIps = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA is LIVE and supervised" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Local:    http://localhost:$Port" -ForegroundColor Green
foreach ($ip in $lanIps) {
    Write-Host " Network:  http://${ip}:$Port" -ForegroundColor Green
}
Write-Host " Public:   $publicUrl" -ForegroundColor Green
Write-Host "`n NOTE: If the public URL does not open from outside, ensure inbound TCP $Port" -ForegroundColor Yellow
Write-Host " is allowed in Huawei Cloud ECS Security Group (outside this machine)." -ForegroundColor Yellow
Write-Host " Stop:   powershell -ExecutionPolicy Bypass -File scripts\serve_public.ps1 -Stop" -ForegroundColor Gray
Write-Host " Status: powershell -ExecutionPolicy Bypass -File scripts\serve_public.ps1 -Status" -ForegroundColor Gray
Write-Host "==========================================================`n" -ForegroundColor Cyan

exit 0
