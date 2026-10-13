# Setup APIWeave (single-process Electron desktop app) on Windows.
# Installs the single app dependency graph. Native addons are N-API and are
# never rebuilt for Electron's ABI, so installation is all that is needed.
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repo 'app'

Write-Host "========================================"
Write-Host "  APIWeave - Setup"
Write-Host "========================================"
Write-Host

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js not found. Install Node.js 20+ from https://nodejs.org"
    exit 1
}
Write-Host "Node.js $(node -v) detected"
Write-Host

Write-Host "Installing app dependencies..."
Push-Location $appDir
npm install
Pop-Location

Write-Host
Write-Host "========================================"
Write-Host "Setup complete!"
Write-Host
Write-Host "Run: .\scripts\start.ps1"
Write-Host
