# Build/run the APIWeave desktop (Electron) app on Windows.
#   .\scripts\desktop.ps1          # dev: build and run embedded Electron app
#   .\scripts\desktop.ps1 build    # build the NSIS installer (electron-builder)
#
# Single-process Electron app — everything runs inside the Electron process.
param([ValidateSet('dev', 'build')][string]$Command = 'dev')
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'app'

if (-not (Test-Path (Join-Path $app 'node_modules'))) { npm --prefix $app install }

if ($Command -eq 'dev') {
    npm --prefix $app run dev
} else {
    npm --prefix $app run build
}
