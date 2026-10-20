# ATALAYA - Caddy v2.11.7 downloader and verifier
# Compatible with PowerShell 5.1 (no &&, ??, or ternary operators)

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$toolsCaddyDir = Join-Path $repoRoot "tools\caddy"
$caddyExe = Join-Path $toolsCaddyDir "caddy.exe"
$targetVersion = "2.11.7"

# Check if already installed with the target version
if (Test-Path $caddyExe) {
    try {
        $verOut = (& $caddyExe version 2>&1 | Out-String).Trim()
        if ($verOut -match "v2\.11\.7") {
            Write-Host "[+] Caddy v2.11.7 is already installed at $caddyExe" -ForegroundColor Green
            exit 0
        }
    } catch {
        Write-Host "[!] Existing caddy.exe failed version check; redownloading..." -ForegroundColor Yellow
    }
}

if (-not (Test-Path $toolsCaddyDir)) {
    New-Item -ItemType Directory -Path $toolsCaddyDir -Force | Out-Null
}

$zipName = "caddy_${targetVersion}_windows_amd64.zip"
$chkName = "caddy_${targetVersion}_checksums.txt"
$zipUrl = "https://github.com/caddyserver/caddy/releases/download/v${targetVersion}/$zipName"
$chkUrl = "https://github.com/caddyserver/caddy/releases/download/v${targetVersion}/$chkName"

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    $zipPath = Join-Path $tempDir $zipName
    $chkPath = Join-Path $tempDir $chkName

    Write-Host "Downloading Caddy v${targetVersion} checksums..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $chkUrl -OutFile $chkPath -UseBasicParsing

    Write-Host "Downloading Caddy v${targetVersion} binary..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

    # Verify SHA-512 checksum
    $chkLines = Get-Content -Path $chkPath
    $expectedHash = $null
    foreach ($line in $chkLines) {
        $trimmed = $line.Trim()
        if ($trimmed -match "\s+$([regex]::Escape($zipName))$") {
            $parts = -split $trimmed
            if ($parts.Length -ge 2) {
                $expectedHash = $parts[0].Trim().ToLower()
                break
            }
        }
    }

    if (-not $expectedHash) {
        Write-Host "[-] Could not find checksum entry for $zipName in $chkName." -ForegroundColor Red
        exit 1
    }

    $actualHash = (Get-FileHash -Path $zipPath -Algorithm SHA512).Hash.ToLower()
    if ($actualHash -ne $expectedHash) {
        Write-Host "[-] SHA-512 checksum mismatch!" -ForegroundColor Red
        Write-Host "    Expected: $expectedHash" -ForegroundColor Red
        Write-Host "    Actual:   $actualHash" -ForegroundColor Red
        exit 1
    }

    Write-Host "[+] SHA-512 checksum verified successfully." -ForegroundColor Green

    # Extract archive
    Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
    $extractedExe = Join-Path $tempDir "caddy.exe"
    if (-not (Test-Path $extractedExe)) {
        Write-Host "[-] caddy.exe was not found inside the downloaded archive." -ForegroundColor Red
        exit 1
    }

    Copy-Item -Path $extractedExe -Destination $caddyExe -Force
    Write-Host "[+] Caddy v${targetVersion} successfully installed to $caddyExe." -ForegroundColor Green

    # Final check
    & $caddyExe version
    exit 0
} catch {
    Write-Host "[-] Failed to download or verify Caddy: $_" -ForegroundColor Red
    exit 1
} finally {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
