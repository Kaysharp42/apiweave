# Freeze the backend + worker into standalone sidecar binaries and stage a
# pinned mongod into desktop/resources/sidecars/, which electron-builder bundles
# as extraResources (see desktop/package.json). sidecars.cjs runs these when
# APIWEAVE_SIDECAR_DIR is set (packaged builds).
#
# PyInstaller can't cross-compile, so this runs natively per OS (here: Windows).
# Verify a frozen binary with:  <binary> --check   (imports the full app, exits 0)
param([string]$MongodVersion = '7.0.14')
$ErrorActionPreference = 'Stop'

$repo    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo 'backend'
$sidecar = Join-Path $repo 'desktop/sidecar'
$binDir  = Join-Path $repo 'desktop/resources/sidecars'
$work    = Join-Path $repo 'desktop/.pyi'
New-Item -ItemType Directory -Force $binDir, $work | Out-Null

$py = Join-Path $backend 'venv/Scripts/python.exe'
if (-not (Test-Path $py)) {
    throw "Backend venv not found at $py. Create it first: python -m venv backend/venv; backend/venv/Scripts/python.exe -m pip install -e backend"
}
& $py -m pip install --quiet --disable-pip-version-check pyinstaller

# Let `--collect-submodules app` import app.* during analysis (config.Settings
# requires these at import time). Throwaway values — config reads env at runtime,
# nothing here is baked into the frozen binary.
$env:BASE_URL = 'http://127.0.0.1:8000'
$env:MONGODB_URL = 'mongodb://127.0.0.1:27017'
$env:MONGODB_DB_NAME = 'apiweave'
$env:ALLOWED_ORIGINS = 'http://localhost:3000'
$env:SECRET_KEY = 'build'
$env:DEPLOYMENT_MODE = 'single_user'
$env:APP_ENV = 'development'

function Freeze($name, $entry, $extraArgs) {
    & $py -m PyInstaller --onefile --clean --noconfirm `
        --name $name `
        --distpath "$work/dist" --workpath "$work/build" --specpath $work `
        --paths $backend `
        --collect-submodules app `
        --collect-all nacl `
        --collect-all aiohttp `
        --collect-submodules pymongo `
        --collect-submodules motor `
        @extraArgs `
        (Join-Path $sidecar $entry)
    Copy-Item "$work/dist/$name.exe" (Join-Path $binDir "$name.exe") -Force
}

# uvicorn loads its protocol implementations dynamically → needs --collect-all.
Freeze 'apiweave-backend' 'apiweave_backend.py' @('--collect-all', 'uvicorn')
Freeze 'apiweave-worker'  'apiweave_worker.py'  @()

# Prove each frozen bundle imports the full app graph (catches a missing hidden
# import before it ships). --check supplies throwaway config env itself.
foreach ($bin in 'apiweave-backend', 'apiweave-worker') {
    & (Join-Path $binDir "$bin.exe") --check
    if ($LASTEXITCODE -ne 0) { throw "$bin failed --check: frozen bundle is missing imports" }
}

# --- mongod: fetch + pin (not frozen) --------------------------------------
$mongoOut = Join-Path $binDir 'mongod.exe'
if (Test-Path $mongoOut) {
    Write-Host "mongod already staged: $mongoOut"
} else {
    $url = "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$MongodVersion.zip"
    $zip = Join-Path $work "mongodb.zip"
    Write-Host "Fetching $url"
    Invoke-WebRequest -Uri $url -OutFile $zip
    $extract = Join-Path $work 'mongodb'
    Remove-Item -Recurse -Force $extract -ErrorAction SilentlyContinue
    Expand-Archive $zip -DestinationPath $extract
    $mongod = Get-ChildItem $extract -Recurse -Filter 'mongod.exe' | Select-Object -First 1
    Copy-Item $mongod.FullName $mongoOut -Force
}

Write-Host "Staged sidecars in $binDir :"
Get-ChildItem $binDir | ForEach-Object { Write-Host "  $($_.Name)" }
