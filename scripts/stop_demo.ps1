# ATALAYA - Stop Demo Server Processes
# Compatible with PowerShell 5.1

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$repoRootNorm = $repoRoot.TrimEnd('\', '/')

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

function Stop-RepoProcessOnPort {
    param([int]$Port)

    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Host "Port $($Port) is not in use." -ForegroundColor Gray
        return
    }

    $pids = $conns | ForEach-Object { $_.OwningProcess } | Select-Object -Unique
    foreach ($pId in $pids) {
        if ($pId -le 4) { continue }
        try {
            $info = Get-ProcessInfo -ProcessId $pId
            $cmd = $info.CommandLine
            $name = $info.Name

            # Stop only if command line contains the repository root path
            if ($cmd -and ($cmd.IndexOf($repoRootNorm, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
                Write-Host "Stopping process on port $($Port) (PID: $($pId), Name: $($name))..." -ForegroundColor Yellow
                Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
                Write-Host "Process $($pId) on port $($Port) stopped." -ForegroundColor Green
            } else {
                Write-Host "Process on port $($Port) (PID: $($pId), Name: $($name)) does not belong to this repo. Leaving intact." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "Warning: Could not inspect or stop PID $($pId) on port $($Port)" -ForegroundColor Yellow
        }
    }
}

Write-Host "Stopping ATALAYA demo processes on ports 8001 and 3000..." -ForegroundColor Cyan
Stop-RepoProcessOnPort -Port 8001
Stop-RepoProcessOnPort -Port 3000
Write-Host "Done." -ForegroundColor Cyan
