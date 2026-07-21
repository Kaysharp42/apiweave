# Build the APIWeave desktop installer (renderer + Electron) on Windows.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $repo 'app')
npm run build
Pop-Location
