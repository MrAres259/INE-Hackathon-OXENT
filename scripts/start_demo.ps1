# ATALAYA - Demo Launcher (Backend + Frontend)
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)

[CmdletBinding()]
param(
    [switch]$Mock,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

# Comentario: los procesos se lanzan desacoplados porque los hijos de una shell de agente mueren con ella.

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$repoRootNorm = $repoRoot.TrimEnd('\', '/')
$backendDir = Join-Path $repoRoot "backend"
$frontendDir = Join-Path $repoRoot "frontend"
$cacheDir = Join-Path $repoRoot "data\cache"

if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
}

$apiOutLog = Join-Path $cacheDir "api.out.log"
$apiErrLog = Join-Path $cacheDir "api.err.log"
$nextOutLog = Join-Path $cacheDir "next.out.log"
$nextErrLog = Join-Path $cacheDir "next.err.log"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA Demo Launcher" -ForegroundColor Cyan
Write-Host " Root:     $repoRoot" -ForegroundColor Gray
Write-Host " Mock:     $Mock" -ForegroundColor Gray
Write-Host " Rebuild:  $Rebuild" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

function Get-ProcessInfo {
    param([int]$ProcessId)

    $cmd = ""
    $name = ""
    try {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if ($cim) {
            $cmd = [string]$cim.CommandLine
            $name = [string]$cim.Name
        }
    } catch {}

    if (-not $cmd) {
        try {
            $wmi = Get-WmiObject Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
            if ($wmi) {
                $cmd = [string]$wmi.CommandLine
                $name = [string]$wmi.Name
            }
        } catch {}
    }

    if (-not $name) {
        try {
            $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
            if ($p) {
                $name = [string]$p.ProcessName
                $cmd = [string]$p.Path
            }
        } catch {}
    }

    return @{ Name = $name; CommandLine = $cmd }
}

function Ensure-PortAvailable {
    param([int]$Port)

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        return
    }

    $pids = $conns | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
    foreach ($pId in $pids) {
        if ($pId -le 4) { continue }
        $info = Get-ProcessInfo -ProcessId $pId
        $cmd = $info.CommandLine
        $name = ($info.Name -as [string]).ToLower()
        $isNodeOrPython = ($name -like "*python*" -or $name -like "*node*")
        $inRepo = ($cmd -and ($cmd.IndexOf($repoRootNorm, [System.StringComparison]::OrdinalIgnoreCase) -ge 0))

        if ($isNodeOrPython -and $inRepo) {
            Write-Host "Stopping existing repo process on port $($Port) (PID: $($pId), Name: $($name))..." -ForegroundColor Yellow
            Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        } else {
            Write-Host "[-] Port $($Port) is in use by another program (PID: $($pId), Name: $($name))." -ForegroundColor Red
            Write-Host "    CommandLine: $cmd" -ForegroundColor Red
            Write-Host "[-] Aborting demo launch to avoid conflicts." -ForegroundColor Red
            exit 1
        }
    }
}

# Check if backend entry point exists; if not (Ola 2), fall back to -Mock
$backendMain = Join-Path $backendDir "atalaya\api\main.py"
if (-not $Mock -and (-not (Test-Path $backendMain))) {
    Write-Host "`nNotice: backend/atalaya/api/main.py does not exist yet (Ola 2). Falling back to -Mock mode." -ForegroundColor Yellow
    $Mock = [switch]::Present
}

# 1. Clean / Verify Ports
if (-not $Mock) {
    Ensure-PortAvailable -Port 8001
}
Ensure-PortAvailable -Port 3000

# 2. Launch Backend (if not -Mock)
if (-not $Mock) {
    Write-Host "`nLaunching ATALAYA backend (FastAPI on :8001)..." -ForegroundColor Yellow
    $env:ATALAYA_STORE = "auto"
    $env:PYTHONIOENCODING = "utf-8"
    $env:PYTHONUTF8 = "1"

    # Reset log files
    Set-Content -Path $apiOutLog -Value ""
    Set-Content -Path $apiErrLog -Value ""

    Start-Process -FilePath "python" `
        -ArgumentList "-m uvicorn atalaya.api.main:app --host 0.0.0.0 --port 8001" `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput $apiOutLog `
        -RedirectStandardError $apiErrLog `
        -WindowStyle Hidden

    Write-Host "Waiting for backend to become ready (max 120s)..." -ForegroundColor Yellow
    $backendReady = $false
    $swBack = [System.Diagnostics.Stopwatch]::StartNew()
    while ($swBack.Elapsed.TotalSeconds -lt 120) {
        Start-Sleep -Seconds 2
        try {
            $res = Invoke-RestMethod -Uri "http://localhost:8001/api/health" -Method Get -TimeoutSec 3 -ErrorAction Stop
            if ($res -and $res.warmup -eq "ready") {
                $backendReady = $true
                break
            }
        } catch {
            # Server warming up
        }
    }
    $swBack.Stop()

    if (-not $backendReady) {
        $elapsedSec = [math]::Round($swBack.Elapsed.TotalSeconds, 1)
        Write-Host "[-] Backend did not become ready after ${elapsedSec}s. Check logs in $apiErrLog" -ForegroundColor Red
        exit 1
    }

    Write-Host "[+] Backend is ready in $([math]::Round($swBack.Elapsed.TotalSeconds, 1))s (warmup: ready)." -ForegroundColor Green
} else {
    Write-Host "`n[-Mock specified or auto-fallback] Skipping backend start. Frontend will use mock data." -ForegroundColor Cyan
    $env:NEXT_PUBLIC_MOCK = "1"
}

# 3. Build Frontend if needed
$dotNext = Join-Path $frontendDir ".next"
$buildId = Join-Path $dotNext "BUILD_ID"
if ((-not (Test-Path $dotNext)) -or (-not (Test-Path $buildId)) -or $Rebuild) {
    # Remove stale lock if present
    $staleLock = Join-Path $dotNext "lock"
    if (Test-Path $staleLock) {
        Remove-Item -Path $staleLock -Force -ErrorAction SilentlyContinue
    }

    Write-Host "`nBuilding frontend (npm run build)..." -ForegroundColor Yellow
    $env:NEXT_TELEMETRY_DISABLED = "1"
    $env:CI = "1"
    if ($Mock) {
        $env:NEXT_PUBLIC_MOCK = "1"
    }
    Push-Location $frontendDir
    try {
        cmd.exe /c "set NEXT_TELEMETRY_DISABLED=1&& set CI=1&& npm run build"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[-] Frontend build failed with exit code $LASTEXITCODE." -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } finally {
        Pop-Location
    }
    Write-Host "[+] Frontend build completed successfully." -ForegroundColor Green
}

# 4. Launch Frontend
Write-Host "`nLaunching Next.js frontend on :3000..." -ForegroundColor Yellow
Set-Content -Path $nextOutLog -Value ""
Set-Content -Path $nextErrLog -Value ""

Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx next start -p 3000" `
    -WorkingDirectory $frontendDir `
    -RedirectStandardOutput $nextOutLog `
    -RedirectStandardError $nextErrLog `
    -WindowStyle Hidden

Write-Host "Waiting for frontend HTTP 200 response on http://localhost:3000 (max 60s)..." -ForegroundColor Yellow
$frontendReady = $false
$swFront = [System.Diagnostics.Stopwatch]::StartNew()
while ($swFront.Elapsed.TotalSeconds -lt 60) {
    Start-Sleep -Seconds 2
    try {
        $res = Invoke-WebRequest -Uri "http://localhost:3000" -Method Get -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($res.StatusCode -eq 200) {
            $frontendReady = $true
            break
        }
    } catch {
        # Still starting up
    }
}
$swFront.Stop()

if (-not $frontendReady) {
    $elapsedSec = [math]::Round($swFront.Elapsed.TotalSeconds, 1)
    Write-Host "[-] Frontend did not respond with 200 after ${elapsedSec}s. Check logs in $nextErrLog" -ForegroundColor Red
    exit 1
}

Write-Host "[+] Frontend is ready in $([math]::Round($swFront.Elapsed.TotalSeconds, 1))s." -ForegroundColor Green

# 5. Summary and URLs
$stopScript = Join-Path $repoRoot "scripts\stop_demo.ps1"
Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA Demo Running" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " App:         http://localhost:3000" -ForegroundColor Green
Write-Host " Metodología: http://localhost:3000/metodologia" -ForegroundColor Green
if (-not $Mock) {
    Write-Host " API Docs:    http://localhost:8001/docs" -ForegroundColor Green
}
Write-Host "`n To stop the demo, run:" -ForegroundColor Yellow
Write-Host "   powershell -ExecutionPolicy Bypass -File `"$stopScript`"" -ForegroundColor Gray
Write-Host "==========================================================`n" -ForegroundColor Cyan
