# ============================================================
# build-sidecar.ps1 — Compile le backend HIMYC en .exe autonome
# puis lance le build Tauri complet.
#
# Usage :
#   .\scripts\build-sidecar.ps1           # sidecar + tauri build
#   .\scripts\build-sidecar.ps1 -SidecarOnly   # sidecar uniquement
# ============================================================

param(
    [switch]$SidecarOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root    = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root "backend"
$Dist    = Join-Path $Backend "dist"
$OutExe  = Join-Path $Dist "himyc-backend.exe"

# ── 1. Vérifier PyInstaller ──────────────────────────────────
Write-Host "`n[1/3] Vérification de PyInstaller..." -ForegroundColor Cyan
try {
    py -3 -m PyInstaller --version | Out-Null
} catch {
    Write-Host "PyInstaller absent — installation..." -ForegroundColor Yellow
    py -3 -m pip install pyinstaller
}

# ── 2. Compiler le backend ───────────────────────────────────
Write-Host "`n[2/3] Compilation du backend avec PyInstaller..." -ForegroundColor Cyan
Push-Location $Backend
try {
    py -3 -m PyInstaller himyc-backend.spec --noconfirm
} finally {
    Pop-Location
}

if (-not (Test-Path $OutExe)) {
    Write-Error "ERREUR : $OutExe introuvable après PyInstaller."
    exit 1
}

$size = [math]::Round((Get-Item $OutExe).Length / 1MB, 1)
Write-Host "✓ Sidecar compilé : $OutExe ($size MB)" -ForegroundColor Green

# ── 3. Build Tauri (optionnel) ───────────────────────────────
if ($SidecarOnly) {
    Write-Host "`nMode --SidecarOnly : build Tauri ignoré." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n[3/3] Build Tauri (avec config release + sidecar)..." -ForegroundColor Cyan
Push-Location $Root
try {
    # tauri.release.conf.json ajoute le sidecar dans bundle.resources
    npm run tauri build -- --config src-tauri/tauri.release.conf.json
} finally {
    Pop-Location
}

Write-Host "`n✓ Build complet terminé." -ForegroundColor Green
