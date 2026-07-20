# Start the APIWeave desktop app (dev) on Windows.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $repo 'app')
npm run dev
Pop-Location
