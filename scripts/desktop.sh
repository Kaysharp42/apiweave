#!/usr/bin/env bash
# Build/run the APIWeave desktop (Electron) app on Linux/macOS.
#   ./scripts/desktop.sh          # dev: Electron + Vite HMR
#   ./scripts/desktop.sh build    # build OS installers (AppImage/.deb/.dmg)
#
# Single-process Electron app — everything runs inside the Electron process.
set -euo pipefail

cmd="${1:-dev}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
desktop="$repo/desktop"
frontend="$repo/frontend"

[ -d "$desktop/node_modules" ] || npm --prefix "$desktop" install

case "$cmd" in
  dev)
    npm --prefix "$desktop" run dev
    ;;
  build)
    npm --prefix "$frontend" run build
    npm --prefix "$desktop" run build
    ;;
  *) echo "usage: $0 [dev|build]" >&2; exit 2 ;;
esac
