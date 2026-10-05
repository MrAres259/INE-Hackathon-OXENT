# ATALAYA - Stop Demo Server Processes
# Compatible with PowerShell 5.1

$ErrorActionPreference = "Stop"

$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$repoRootNorm = $repoRoot.TrimEnd('\', '/')
$cacheDir = Join-Path $repoRoot "data\cache"
$apiPidFile = Join-Path $cacheDir "api.pid"
$webPidFile = Join-Path $cacheDir "web.pid"

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

function Stop-PidFile {
    param(
        [string]$FilePath,
        [string]$Description
    )

    $targetPid = 0
    if (Test-Path $FilePath) {
        try {
            $val = (Get-Content -Path $FilePath -Raw -ErrorAction SilentlyContinue).Trim()
            if ($val -match '^\d+$') {
                $targetPid = [int]$val
            }
        } catch {}
    }

    $stopped = $false
    if ($targetPid -gt 4) {
        try {
            $info = Get-ProcessInfo -ProcessId $targetPid
            $pName = ($info.Name -as [string]).ToLower()
            if ($pName -like "*python*" -or $pName -like "*node*" -or $pName -like "*cmd*") {
                Write-Host "Stopping $Description (PID: $targetPid, Name: $pName) and child processes..." -ForegroundColor Yellow
                Stop-ProcessSafely -ProcessId $targetPid
                Start-Sleep -Milliseconds 500
                Write-Host "$Description (PID: $targetPid) stopped." -ForegroundColor Green
                $stopped = $true
            }
        } catch {
            Write-Host "Warning: Could not stop $Description PID $targetPid : $_" -ForegroundColor Yellow
        }
    }

    if (Test-Path $FilePath) {
        Remove-Item -Path $FilePath -Force -ErrorAction SilentlyContinue
    }

    return @{ Pid = $targetPid; Stopped = $stopped }
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

function Stop-RepoProcessOnPort {
    param(
        [int]$Port,
        [int]$WebPid = 0,
        [int]$ApiPid = 0
    )

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "Port $($Port) is not in use." -ForegroundColor Gray
        return $false
    }

    $stopped = $false
    $procIds = $conns | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
    foreach ($procId in $procIds) {
        if ($procId -le 4) { continue }
        try {
            $info = Get-ProcessInfo -ProcessId $procId
            $cmd = $info.CommandLine
            $name = $info.Name

            $isRepo = Test-IsRepoProcess -ProcessId $procId -ProcInfo $info -RepoRootNorm $repoRootNorm -WebPid $WebPid -ApiPid $ApiPid

            if ($isRepo) {
                Write-Host "Stopping repo process on port $($Port) (PID: $($procId), Name: $($name))..." -ForegroundColor Yellow
                Stop-ProcessSafely -ProcessId $procId
                Start-Sleep -Milliseconds 500
                Write-Host "Process $($procId) on port $($Port) stopped." -ForegroundColor Green
                $stopped = $true
            } else {
                Write-Host "Process on port $($Port) (PID: $($procId), Name: $($name)) does not belong to this repo. Leaving intact." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "Warning: Could not inspect or stop PID $($procId) on port $($Port)" -ForegroundColor Yellow
        }
    }
    return $stopped
}

Write-Host "Stopping ATALAYA demo processes on ports 8001 and 3000..." -ForegroundColor Cyan

# 1. Stop recorded PID files first
$apiResult = Stop-PidFile -FilePath $apiPidFile -Description "Backend API"
$webResult = Stop-PidFile -FilePath $webPidFile -Description "Frontend Web"

$recordedApiPid = $apiResult.Pid
$recordedWebPid = $webResult.Pid
$stoppedAny = ($apiResult.Stopped -or $webResult.Stopped)

# 2. Check ports as fallback
$stoppedBack = Stop-RepoProcessOnPort -Port 8001 -WebPid $recordedWebPid -ApiPid $recordedApiPid
$stoppedFront = Stop-RepoProcessOnPort -Port 3000 -WebPid $recordedWebPid -ApiPid $recordedApiPid

if ($stoppedBack -or $stoppedFront) {
    $stoppedAny = $true
}

if (-not $stoppedAny) {
    Write-Host "Nothing to stop: no active ATALAYA demo processes found." -ForegroundColor Gray
}

Write-Host "Done." -ForegroundColor Cyan
exit 0
