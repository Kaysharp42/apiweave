#!/usr/bin/env bash
# Build/run the APIWeave desktop (Tauri) app on Linux/macOS.
#   ./scripts/desktop.sh          # dev: live Vite dev server (HMR) + hot Rust reload
#   ./scripts/desktop.sh build    # produce OS installers (.AppImage/.deb)
# dev serves the frontend from the Vite dev server (devUrl in tauri.conf.json) so
# frontend edits hot-reload; build compiles the static frontend bundle first.
# Start the backend/worker/mongod yourself for now (Phase 1/2 wires sidecars in).
set -euo pipefail

cmd="${1:-dev}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo/desktop"

# Tauri CLI is a devDependency; install it on first run.
[ -d node_modules ] || npm install

# Linux needs webkit2gtk + friends — fail early with a clear hint instead of
# deep inside a cargo build.
if [ "$(uname -s)" = "Linux" ] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "Missing webkit2gtk-4.1 dev libraries. On Debian/Ubuntu:" >&2
  echo "  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf" >&2
  exit 1
fi

case "$cmd" in
  dev)   npx tauri dev ;;
  build) npx tauri build ;;
  *) echo "usage: $0 [dev|build]" >&2; exit 2 ;;
esac
