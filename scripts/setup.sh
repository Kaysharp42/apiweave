#!/usr/bin/env bash
# Setup APIWeave (single-process Electron desktop app).
# Installs the single app dependency graph and rebuilds native Electron modules.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"

echo "========================================"
echo "  APIWeave - Setup"
echo "========================================"
echo

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi
echo "Node.js $(node -v) detected"
echo

# npm 12+ requires allow-remote to fetch tarball deps
cd "$APP_DIR"
if [ ! -f .npmrc ]; then
  echo "allow-remote=all" > .npmrc
  echo "Created .npmrc with allow-remote=all (required for npm 12+ remote tarball deps)"
fi

echo "Installing app dependencies..."
npm install

# Electron postinstall may be blocked by global allow-scripts=false
ELECTRON_DIR="node_modules/electron"
ELECTRON_BIN="$ELECTRON_DIR/dist/electron"
if [ -f "$ELECTRON_DIR/package.json" ] && [ ! -f "$ELECTRON_BIN" ] && [ -f "$ELECTRON_DIR/install.js" ]; then
  echo "  Electron binary not found — downloading..."
  # Extract electron version and download from GitHub
  VERSION=$(node -e "console.log(require('./$ELECTRON_DIR/package.json').version)")
  ARCH=$(node -e "console.log(process.arch)")
  PLATFORM=$(node -e "console.log(process.platform)")
  URL="https://github.com/electron/electron/releases/download/v${VERSION}/electron-v${VERSION}-${PLATFORM}-${ARCH}.zip"
  ZIPFILE="/tmp/electron-v${VERSION}-${PLATFORM}-${ARCH}.zip"
  if [ ! -f "$ZIPFILE" ]; then
    if command -v curl &>/dev/null; then
      curl -LsSfo "$ZIPFILE" "$URL"
    elif command -v wget &>/dev/null; then
      wget -qO "$ZIPFILE" "$URL"
    else
      echo "ERROR: curl or wget required to download electron binary." >&2
      exit 1
    fi
  fi
  rm -rf "$ELECTRON_DIR/dist"
  mkdir -p "$ELECTRON_DIR/dist"
  unzip -qo "$ZIPFILE" -d "$ELECTRON_DIR/dist/"
  printf "%s" "electron" > "$ELECTRON_DIR/path.txt"
  echo "  Done."
fi

echo
echo "Rebuilding native modules for Electron..."
npm run rebuild:electron

echo
echo "========================================"
echo "Setup complete!"
echo
echo "Run: ./scripts/start.sh"
echo
