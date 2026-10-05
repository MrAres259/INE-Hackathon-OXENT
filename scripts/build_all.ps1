# ATALAYA - Full Knowledge & Data Build Pipeline
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)

[CmdletBinding()]
param(
    [switch]$Load,
    [switch]$Geo,
    [switch]$SkipModel
)

$ErrorActionPreference = "Stop"

$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$backendDir = Join-Path $repoRoot "backend"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA Full Data Build Pipeline" -ForegroundColor Cyan
Write-Host " Root:     $repoRoot" -ForegroundColor Gray
Write-Host " Backend:  $backendDir" -ForegroundColor Gray
Write-Host " Options:  Load=$Load, Geo=$Geo, SkipModel=$SkipModel" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

Push-Location $backendDir

function Run-Step {
    param(
        [string]$StepNumber,
        [string]$StepTitle,
        [scriptblock]$Action
    )

    Write-Host "`n----------------------------------------------------------" -ForegroundColor Yellow
    Write-Host " [$StepNumber/9] $StepTitle" -ForegroundColor Yellow
    Write-Host "----------------------------------------------------------" -ForegroundColor Yellow

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $Action
    $exitCode = $LASTEXITCODE
    $sw.Stop()
    $seconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)

    if ($exitCode -and $exitCode -ne 0) {
        Write-Host "[-] Step $StepNumber FAILED (exit code: $exitCode) after ${seconds}s" -ForegroundColor Red
        throw "Step $StepNumber failed with exit code $exitCode"
    } else {
        Write-Host "[+] Step $StepNumber completed in ${seconds}s" -ForegroundColor Green
    }
}

try {
    $totalSw = [System.Diagnostics.Stopwatch]::StartNew()

    # Step 1: INE Results Ingest
    Run-Step -StepNumber "1" -StepTitle "Ingesting INE Results (participation)" -Action {
        python -m atalaya.ingest.ine_results
    }

    # Step 2: INEGI Censo 2020 ITER Ingest
    Run-Step -StepNumber "2" -StepTitle "Ingesting INEGI Censo 2020 (ITER)" -Action {
        python -m atalaya.ingest.inegi_iter
    }

    # Step 3: CONAPO Marginación Ingest
    Run-Step -StepNumber "3" -StepTitle "Ingesting CONAPO Marginación 2020" -Action {
        python -m atalaya.ingest.conapo
    }

    # Step 4: Build Sociodemographic Features
    Run-Step -StepNumber "4" -StepTitle "Building Sociodemographic Features" -Action {
        python -m atalaya.ingest.features
    }

    # Step 5: Crosswalk and Master Dataset Consolidation
    Run-Step -StepNumber "5" -StepTitle "Consolidating Crosswalk and Master Data" -Action {
        python -m atalaya.ingest.crosswalk
    }

    # Step 6: Model Training / Inference
    Run-Step -StepNumber "6" -StepTitle "Building Predictive Model" -Action {
        $modelScript = Join-Path $backendDir "atalaya\model\build.py"
        if ($SkipModel) {
            Write-Host "-SkipModel specified. Skipping model build." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        } elseif (Test-Path $modelScript) {
            python -m atalaya.model.build
        } else {
            Write-Host "backend/atalaya/model/build.py does not exist yet. Skipped (Ola 2)." -ForegroundColor Yellow
            $global:LASTEXITCODE = 0
        }
    }

    # Step 7: Load dry-run validation
    Run-Step -StepNumber "7" -StepTitle "Validating Elasticsearch Documents (dry-run)" -Action {
        python -m atalaya.load --dry-run
    }

    # Step 8: Optional load to Elasticsearch / Cloud Search
    Run-Step -StepNumber "8" -StepTitle "Loading Index into Cluster" -Action {
        if ($Load) {
            $checkScript = Join-Path $repoRoot "scripts\check_cluster.py"
            if (Test-Path $checkScript) {
                python $checkScript
                $clusterCheck = $LASTEXITCODE
                if ($clusterCheck -eq 0) {
                    Write-Host "Cluster is reachable. Loading documents..." -ForegroundColor Green
                    python -m atalaya.load
                } else {
                    Write-Host "Cluster check returned $clusterCheck (unreachable). Skipping live load." -ForegroundColor Yellow
                    $global:LASTEXITCODE = 0
                }
            } else {
                Write-Host "scripts/check_cluster.py not found. Skipping live load." -ForegroundColor Yellow
                $global:LASTEXITCODE = 0
            }
        } else {
            Write-Host "-Load flag not specified. Skipping cluster ingestion." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        }
    }

    # Step 9: Geo processing with mapshaper
    Run-Step -StepNumber "9" -StepTitle "Generating Geographic Layers (mapshaper)" -Action {
        if ($Geo) {
            $geoDir = Join-Path $repoRoot "tools\geo"
            $geoModules = Join-Path $geoDir "node_modules"
            if (Test-Path $geoModules) {
                Push-Location $geoDir
                try {
                    node --max-old-space-size=6144 build_geo.mjs
                } finally {
                    Pop-Location
                }
            } else {
                Write-Host "tools/geo/node_modules not found. Skipping geo build." -ForegroundColor Yellow
                $global:LASTEXITCODE = 0
            }
        } else {
            Write-Host "-Geo flag not specified. Skipping geo processing." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        }
    }

    $totalSw.Stop()
    $totalSeconds = [math]::Round($totalSw.Elapsed.TotalSeconds, 2)
    Write-Host "`n==========================================================" -ForegroundColor Cyan
    Write-Host " BUILD COMPLETED SUCCESSFULLY IN ${totalSeconds}s" -ForegroundColor Green
    Write-Host "==========================================================" -ForegroundColor Cyan
} finally {
    Pop-Location
}
