#!/usr/bin/env bash
# Freeze the backend + worker into standalone sidecar binaries and stage a
# pinned mongod into desktop/resources/sidecars/, which electron-builder bundles
# as extraResources (see desktop/package.json). sidecars.cjs runs these when
# APIWEAVE_SIDECAR_DIR is set (packaged builds).
#
# PyInstaller can't cross-compile, so this runs natively per OS (Linux/macOS).
# Verify a frozen binary with:  <binary> --check   (imports the full app, exits 0)
set -euo pipefail

MONGOD_VERSION="${MONGOD_VERSION:-7.0.14}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
backend="$repo/backend"
sidecar="$repo/desktop/sidecar"
bin_dir="$repo/desktop/resources/sidecars"
work="$repo/desktop/.pyi"
mkdir -p "$bin_dir" "$work"

py="$backend/venv/bin/python"
[ -x "$py" ] || py="python3"
"$py" -m pip install --quiet --disable-pip-version-check pyinstaller

# Let `--collect-submodules app` import app.* during analysis (config.Settings
# requires these at import time). Throwaway values — config reads env at runtime,
# nothing here is baked into the frozen binary.
export BASE_URL=http://127.0.0.1:8000 MONGODB_URL=mongodb://127.0.0.1:27017 \
  MONGODB_DB_NAME=apiweave ALLOWED_ORIGINS=http://localhost:3000 \
  SECRET_KEY=build DEPLOYMENT_MODE=single_user APP_ENV=development

freeze() {
  local name="$1" entry="$2"; shift 2
  "$py" -m PyInstaller --onefile --clean --noconfirm \
    --name "$name" \
    --distpath "$work/dist" --workpath "$work/build" --specpath "$work" \
    --paths "$backend" \
    --collect-submodules app \
    --collect-all nacl \
    --collect-all aiohttp \
    --collect-submodules pymongo \
    --collect-submodules motor \
    "$@" \
    "$sidecar/$entry"
  cp "$work/dist/$name" "$bin_dir/$name"
}

# uvicorn loads its protocol implementations dynamically → needs --collect-all.
freeze apiweave-backend apiweave_backend.py --collect-all uvicorn
freeze apiweave-worker  apiweave_worker.py

# Prove each frozen bundle imports the full app graph (catches a missing hidden
# import before it ships). --check supplies throwaway config env itself.
for bin in apiweave-backend apiweave-worker; do
  "$bin_dir/$bin" --check || { echo "$bin failed --check: frozen bundle is missing imports" >&2; exit 1; }
done

# --- mongod: fetch + pin (not frozen) --------------------------------------
mongo_out="$bin_dir/mongod"
if [ -f "$mongo_out" ]; then
  echo "mongod already staged: $mongo_out"
else
  case "$(uname -s)" in
    Linux)  os_url="linux/mongodb-linux-x86_64-ubuntu2204-${MONGOD_VERSION}.tgz" ;;
    Darwin) arch="$(uname -m)"; [ "$arch" = "arm64" ] && plat="arm64" || plat="x86_64"
            os_url="osx/mongodb-macos-${plat}-${MONGOD_VERSION}.tgz" ;;
    *) echo "unsupported OS for mongod fetch" >&2; exit 1 ;;
  esac
  url="https://fastdl.mongodb.org/${os_url}"
  echo "Fetching $url"
  tgz="$work/mongodb.tgz"
  curl -fSL "$url" -o "$tgz"
  tar -xzf "$tgz" -C "$work"
  cp "$(find "$work" -name mongod -type f | head -1)" "$mongo_out"
  chmod +x "$mongo_out"
fi

echo "Staged sidecars in $bin_dir:"
ls -1 "$bin_dir"
