# Setup APIWeave (single-process Electron desktop app) on Windows.
# Installs the single app dependency graph and rebuilds native Electron modules.
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
Write-Host
Write-Host "Rebuilding native modules for Electron..."
npm run rebuild:electron
Pop-Location

Write-Host
Write-Host "========================================"
Write-Host "Setup complete!"
Write-Host
Write-Host "Run: .\scripts\start.ps1"
Write-Host
