# ATALAYA - Full Knowledge & Data Build Pipeline
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)

[CmdletBinding()]
param(
    [switch]$Load,
    [switch]$SkipGeo,
    [switch]$SkipModel,
    [switch]$SkipExport,
    [switch]$SkipReports
)

$ErrorActionPreference = "Stop"

$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$backendDir = Join-Path $repoRoot "backend"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " ATALAYA Full Data Build Pipeline" -ForegroundColor Cyan
Write-Host " Root:     $repoRoot" -ForegroundColor Gray
Write-Host " Backend:  $backendDir" -ForegroundColor Gray
Write-Host " Options:  Load=$Load, SkipGeo=$SkipGeo, SkipModel=$SkipModel, SkipExport=$SkipExport, SkipReports=$SkipReports" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

Push-Location $backendDir

function Run-Step {
    param(
        [string]$StepNumber,
        [string]$StepTitle,
        [scriptblock]$Action
    )

    Write-Host "`n----------------------------------------------------------" -ForegroundColor Yellow
    Write-Host " [$StepNumber/14] $StepTitle" -ForegroundColor Yellow
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

    # Step 1: Geographic Layers & Catalogs (mapshaper)
    Run-Step -StepNumber "1" -StepTitle "Generating Geographic Layers & Catalogs (mapshaper)" -Action {
        if ($SkipGeo) {
            Write-Host "-SkipGeo specified. Skipping geographic processing." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        } else {
            $geoDir = Join-Path $repoRoot "tools\geo"
            $geoModules = Join-Path $geoDir "node_modules"
            $entShp = Join-Path $repoRoot "data\raw\geo\00ent.shp"
            $munShp = Join-Path $repoRoot "data\raw\geo\00mun.shp"
            if ((Test-Path $geoModules) -and (Test-Path $entShp) -and (Test-Path $munShp)) {
                Push-Location $geoDir
                try {
                    node --max-old-space-size=6144 build_geo.mjs
                } finally {
                    Pop-Location
                }
            } else {
                Write-Host "Shapefiles or tools/geo/node_modules not found. Skipping geo build." -ForegroundColor Yellow
                $global:LASTEXITCODE = 0
            }
        }
    }

    # Step 2: CCPC Ingest
    Run-Step -StepNumber "2" -StepTitle "Ingesting CCPC Participation Data" -Action {
        python -m atalaya.ingest.ccpc
    }

    # Step 3: INEGI Censo 2020 ITER Ingest
    Run-Step -StepNumber "3" -StepTitle "Ingesting INEGI Censo 2020 (ITER)" -Action {
        python -m atalaya.ingest.inegi_iter
    }

    # Step 4: CONAPO Marginación Ingest
    Run-Step -StepNumber "4" -StepTitle "Ingesting CONAPO Marginación 2020" -Action {
        python -m atalaya.ingest.conapo
    }

    # Step 5: Build Sociodemographic Features
    Run-Step -StepNumber "5" -StepTitle "Building Sociodemographic Features" -Action {
        python -m atalaya.ingest.features
    }

    # Step 6: Crosswalk and Master Dataset Consolidation
    Run-Step -StepNumber "6" -StepTitle "Consolidating Crosswalk and Master Data" -Action {
        python -m atalaya.ingest.crosswalk
    }

    # Step 7: CCPC Demographic & Turnout Features
    Run-Step -StepNumber "7" -StepTitle "Building CCPC Features" -Action {
        python -m atalaya.ingest.ccpc_features
    }

    # Step 8: Model Training / Inference
    Run-Step -StepNumber "8" -StepTitle "Building Predictive Model" -Action {
        if ($SkipModel) {
            Write-Host "-SkipModel specified. Skipping model build." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        } else {
            $modelScript = Join-Path $backendDir "atalaya\model\build.py"
            if (Test-Path $modelScript) {
                python -m atalaya.model.build
            } else {
                Write-Host "backend/atalaya/model/build.py does not exist yet. Skipped." -ForegroundColor Yellow
                $global:LASTEXITCODE = 0
            }
        }
    }

    # Step 9: Export Deliverables
    Run-Step -StepNumber "9" -StepTitle "Exporting Deliverables" -Action {
        if ($SkipExport) {
            Write-Host "-SkipExport specified. Skipping export." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        } else {
            $exportScript = Join-Path $backendDir "atalaya\export.py"
            if (Test-Path $exportScript) {
                python -m atalaya.export
            } else {
                Write-Host "backend/atalaya/export.py does not exist yet. Skipped." -ForegroundColor Yellow
                $global:LASTEXITCODE = 0
            }
        }
    }

    # Step 10: Load dry-run validation
    Run-Step -StepNumber "10" -StepTitle "Validating Elasticsearch Documents (dry-run)" -Action {
        python -m atalaya.load --dry-run
    }

    # Step 11: Optional load to Elasticsearch / Cloud Search
    Run-Step -StepNumber "11" -StepTitle "Loading Index into Cluster" -Action {
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

    # Step 12: Build Output Validation Summary
    Run-Step -StepNumber "12" -StepTitle "Validation Summary of Build Artifacts" -Action {
        $validateScript = Join-Path $backendDir "scripts\validate_build.py"
        if (Test-Path $validateScript) {
            python $validateScript
        } else {
            Write-Host "backend/scripts/validate_build.py does not exist. Skipped." -ForegroundColor Yellow
            $global:LASTEXITCODE = 0
        }
    }

    # Step 13: Executive Report Generation
    Run-Step -StepNumber "13" -StepTitle "Generating Executive Methodological Report" -Action {
        if ($SkipReports) {
            Write-Host "-SkipReports specified. Skipping report build." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        } else {
            python -m atalaya.report.build_report
        }
    }

    # Step 14: Presentation Slides Generation
    Run-Step -StepNumber "14" -StepTitle "Generating Executive Presentation Slides" -Action {
        if ($SkipReports) {
            Write-Host "-SkipReports specified. Skipping slides build." -ForegroundColor Gray
            $global:LASTEXITCODE = 0
        } else {
            python -m atalaya.report.build_slides
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
