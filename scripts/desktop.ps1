# Build/run the APIWeave desktop (Electron) app on Windows.
#   .\scripts\desktop.ps1          # dev: Electron + Vite HMR
#   .\scripts\desktop.ps1 build    # build the NSIS installer (electron-builder)
#
# Single-process Electron app — everything runs inside the Electron process.
param([ValidateSet('dev', 'build')][string]$Command = 'dev')
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $repo 'desktop'
$frontend = Join-Path $repo 'frontend'

if (-not (Test-Path (Join-Path $desktop 'node_modules'))) { npm --prefix $desktop install }

if ($Command -eq 'dev') {
    npm --prefix $desktop run dev
} else {
    npm --prefix $frontend run build
    npm --prefix $desktop run build
}
