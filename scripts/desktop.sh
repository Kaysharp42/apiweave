#!/usr/bin/env bash
# Build/run the APIWeave desktop (Electron) app on Linux/macOS.
#   ./scripts/desktop.sh          # dev: build and run embedded Electron app
#   ./scripts/desktop.sh build    # build OS installers (AppImage/.deb/.dmg)
#
# Single-process Electron app — everything runs inside the Electron process.
set -euo pipefail

cmd="${1:-dev}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo/app"

[ -d "$app/node_modules" ] || npm --prefix "$app" install

case "$cmd" in
  dev)
    npm --prefix "$app" run dev
    ;;
  build)
    npm --prefix "$app" run build
    ;;
  *) echo "usage: $0 [dev|build]" >&2; exit 2 ;;
esac
