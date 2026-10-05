# ATALAYA - Demo Launcher (Backend + Frontend)
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)

[CmdletBinding()]
param(
    [switch]$Mock,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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
$apiPidFile = Join-Path $cacheDir "api.pid"
$webPidFile = Join-Path $cacheDir "web.pid"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA Demo Launcher" -ForegroundColor Cyan
Write-Host " Root:     $repoRoot" -ForegroundColor Gray
Write-Host " Mock:     $Mock" -ForegroundColor Gray
Write-Host " Rebuild:  $Rebuild" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

function Stop-ProcessSafely {
    param([int]$ProcessId)

    if ($ProcessId -le 4) { return }

    # 1. Verify PID exists before attempting kill
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) {
        return
    }

    # 2. Wrap native call with temporary ErrorActionPreference = Continue
    $prevEAP = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & taskkill /T /F /PID $ProcessId 2>&1 | Out-Null
        # 3. Ignore taskkill exit code if process already terminated
        $global:LASTEXITCODE = 0
    } catch {
        # Process already terminated
    } finally {
        $ErrorActionPreference = $prevEAP
    }
}

function Get-ProcessInfo {
    param([int]$ProcessId)

    $cmd = ""
    $name = ""
    $parentId = 0
    try {
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if ($cim) {
            $cmd = [string]$cim.CommandLine
            $name = [string]$cim.Name
            $parentId = [int]$cim.ParentProcessId
        }
    } catch {}

    if (-not $cmd -and -not $name) {
        try {
            $wmi = Get-WmiObject Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
            if ($wmi) {
                $cmd = [string]$wmi.CommandLine
                $name = [string]$wmi.Name
                $parentId = [int]$wmi.ParentProcessId
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

    return @{ Name = $name; CommandLine = $cmd; ParentProcessId = $parentId }
}

function Test-IsRepoProcess {
    param(
        [int]$ProcessId,
        [hashtable]$ProcInfo,
        [string]$RepoRootNorm,
        [int]$WebPid = 0,
        [int]$ApiPid = 0
    )

    if ($ProcessId -le 4) { return $false }

    if (($ApiPid -gt 0 -and $ProcessId -eq $ApiPid) -or ($WebPid -gt 0 -and $ProcessId -eq $WebPid)) {
        return $true
    }

    $cmd = [string]$ProcInfo.CommandLine
    $name = ([string]$ProcInfo.Name).ToLower()
    $parentId = [int]$ProcInfo.ParentProcessId

    $isNodeOrPythonOrCmd = ($name -like "*python*" -or $name -like "*node*" -or $name -like "*cmd*")
    if (-not $isNodeOrPythonOrCmd) {
        return $false
    }

    # 1. Command line contains repo root path
    if ($cmd -and ($cmd.IndexOf($RepoRootNorm, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        return $true
    }

    # 2. Command line contains atalaya.api.main
    if ($cmd -and ($cmd.IndexOf("atalaya.api.main", [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        return $true
    }

    # 3. Command line contains next start -p 3000 and parent is the cmd.exe from web.pid
    if ($cmd -and ($cmd.IndexOf("next start", [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        if ($WebPid -gt 0) {
            if ($parentId -eq $WebPid) {
                return $true
            }
            try {
                $parentInfo = Get-ProcessInfo -ProcessId $parentId
                if ($parentInfo.ParentProcessId -eq $WebPid) {
                    return $true
                }
            } catch {}
        }
    }

    return $false
}

function Ensure-PortAvailable {
    param([int]$Port)

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        return
    }

    $savedWebPid = 0
    if (Test-Path $webPidFile) {
        try {
            $val = (Get-Content -Path $webPidFile -Raw -ErrorAction SilentlyContinue).Trim()
            if ($val -match '^\d+$') { $savedWebPid = [int]$val }
        } catch {}
    }

    $savedApiPid = 0
    if (Test-Path $apiPidFile) {
        try {
            $val = (Get-Content -Path $apiPidFile -Raw -ErrorAction SilentlyContinue).Trim()
            if ($val -match '^\d+$') { $savedApiPid = [int]$val }
        } catch {}
    }

    $procIds = $conns | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
    foreach ($procId in $procIds) {
        if ($procId -le 4) { continue }
        $info = Get-ProcessInfo -ProcessId $procId
        $cmd = $info.CommandLine
        $name = ($info.Name -as [string]).ToLower()

        $isRepo = Test-IsRepoProcess -ProcessId $procId -ProcInfo $info -RepoRootNorm $repoRootNorm -WebPid $savedWebPid -ApiPid $savedApiPid

        if ($isRepo) {
            Write-Host "Stopping existing repo process on port $($Port) (PID: $($procId), Name: $($name))..." -ForegroundColor Yellow
            Stop-ProcessSafely -ProcessId $procId
            if ($savedWebPid -gt 0 -and $Port -eq 3000) {
                Stop-ProcessSafely -ProcessId $savedWebPid
                Remove-Item -Path $webPidFile -Force -ErrorAction SilentlyContinue
            }
            if ($savedApiPid -gt 0 -and $Port -eq 8001) {
                Stop-ProcessSafely -ProcessId $savedApiPid
                Remove-Item -Path $apiPidFile -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Seconds 1
        } else {
            Write-Host "[-] Port $($Port) is in use by another program (PID: $($procId), Name: $($name))." -ForegroundColor Red
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

    $apiProc = Start-Process -FilePath "python" `
        -ArgumentList "-m uvicorn atalaya.api.main:app --host 0.0.0.0 --port 8001" `
        -WorkingDirectory $backendDir `
        -RedirectStandardOutput $apiOutLog `
        -RedirectStandardError $apiErrLog `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -Path $apiPidFile -Value $apiProc.Id

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
        if (Test-Path $apiPidFile) {
            Stop-ProcessSafely -ProcessId $apiProc.Id
            Remove-Item -Path $apiPidFile -Force -ErrorAction SilentlyContinue
        }
        exit 1
    }

    Write-Host "[+] Backend is ready in $([math]::Round($swBack.Elapsed.TotalSeconds, 1))s (warmup: ready)." -ForegroundColor Green
} else {
    Write-Host "`n[-Mock specified or auto-fallback] Skipping backend start. Frontend will use mock data." -ForegroundColor Cyan
    $env:NEXT_PUBLIC_MOCK = "1"
    if (Test-Path $apiPidFile) {
        Remove-Item -Path $apiPidFile -Force -ErrorAction SilentlyContinue
    }
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

$webProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c npx next start -p 3000" `
    -WorkingDirectory $frontendDir `
    -RedirectStandardOutput $nextOutLog `
    -RedirectStandardError $nextErrLog `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $webPidFile -Value $webProc.Id

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
    if (Test-Path $webPidFile) {
        Stop-ProcessSafely -ProcessId $webProc.Id
        Remove-Item -Path $webPidFile -Force -ErrorAction SilentlyContinue
    }
    if (-not $Mock -and (Test-Path $apiPidFile)) {
        Stop-ProcessSafely -ProcessId $apiProc.Id
        Remove-Item -Path $apiPidFile -Force -ErrorAction SilentlyContinue
    }
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

exit 0
