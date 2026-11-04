#!/usr/bin/env bash
# Setup APIWeave (single-process Electron desktop app).
# Installs the single app dependency graph. Native addons are N-API and are
# never rebuilt for Electron's ABI, so installation is all that is needed.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"

echo "========================================"
echo "  APIWeave - Setup"
echo "========================================"
echo

if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 22.12 or newer from https://nodejs.org"
  exit 1
fi
NODE_VERSION="$(node -v | sed 's/^v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  echo "ERROR: Node.js 22.12 or newer is required (found $(node -v)). Download it from https://nodejs.org"
  exit 1
fi
echo "Node.js $(node -v) detected"

# node-pty 1.1.0 ships prebuilds for macOS and Windows, but not Linux, so the
# install script compiles it here. Fail with a useful message instead of a
# node-gyp stack trace.
if [ "$(uname -s)" = "Linux" ]; then
  for tool in make python3; do
    if ! command -v "$tool" &>/dev/null; then
      echo "ERROR: building on Linux needs $tool (install build-essential)." >&2
      exit 1
    fi
  done
  if ! command -v g++ &>/dev/null && ! command -v clang++ &>/dev/null; then
    echo "ERROR: building on Linux needs a C++ compiler (g++ or clang++)." >&2
    exit 1
  fi
fi
echo
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
echo "========================================"
echo "Setup complete!"
echo
echo "Run: ./scripts/start.sh"
echo
