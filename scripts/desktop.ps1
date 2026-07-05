# Build/run the APIWeave desktop (Electron) app on Windows.
#   .\scripts\desktop.ps1          # dev: Vite dev server (HMR) + the Electron shell
#   .\scripts\desktop.ps1 build    # freeze sidecars + build the NSIS installer
#
# The shell spawns mongod/backend/worker itself (sidecars.cjs). Dev needs the
# backend venv (backend/venv) and mongod on PATH; packaged builds bundle a
# frozen backend/worker + pinned mongod (see build-desktop-sidecars.ps1).
param([ValidateSet('dev', 'build')][string]$Command = 'dev')
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $repo 'desktop'
$frontend = Join-Path $repo 'frontend'

if (-not (Test-Path (Join-Path $desktop 'node_modules'))) { npm --prefix $desktop install }

if ($Command -eq 'dev') {
    # Vite dev server in the background for HMR; the shell loads it via
    # APIWEAVE_DEV_SERVER. Kill Vite when the shell exits.
    $vite = Start-Process npm -ArgumentList 'run', 'dev' -WorkingDirectory $frontend -PassThru
    try {
        $env:APIWEAVE_DEV_SERVER = 'http://localhost:3000'
        Start-Sleep -Seconds 4  # let Vite bind :3000 before the shell loads it
        npm --prefix $desktop start
    } finally {
        if ($vite -and -not $vite.HasExited) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue }
    }
} else {
    & (Join-Path $PSScriptRoot 'build-desktop-sidecars.ps1')
    npm --prefix $frontend run build
    npm --prefix $desktop run build
}
