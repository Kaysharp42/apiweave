#!/usr/bin/env bash
# Build/run the APIWeave desktop (Electron) app on Linux/macOS.
#   ./scripts/desktop.sh          # dev: Vite dev server (HMR) + the Electron shell
#   ./scripts/desktop.sh build    # freeze sidecars + build OS installers (.AppImage/.deb/.dmg)
#
# The shell spawns mongod/backend/worker itself (sidecars.cjs). Dev needs the
# backend venv (backend/venv) and mongod on PATH; packaged builds bundle a
# frozen backend/worker + pinned mongod (see build-desktop-sidecars.sh).
set -euo pipefail

cmd="${1:-dev}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
desktop="$repo/desktop"
frontend="$repo/frontend"

[ -d "$desktop/node_modules" ] || npm --prefix "$desktop" install

case "$cmd" in
  dev)
    # Vite dev server in the background for HMR; the shell loads it via
    # APIWEAVE_DEV_SERVER. Kill Vite when the shell exits.
    ( cd "$frontend" && npm run dev ) &
    vite=$!
    trap 'kill "$vite" 2>/dev/null || true' EXIT
    sleep 4  # let Vite bind :3000 before the shell loads it
    APIWEAVE_DEV_SERVER='http://localhost:3000' npm --prefix "$desktop" start
    ;;
  build)
    "$(dirname "$0")/build-desktop-sidecars.sh"
    npm --prefix "$frontend" run build
    npm --prefix "$desktop" run build
    ;;
  *) echo "usage: $0 [dev|build]" >&2; exit 2 ;;
esac
