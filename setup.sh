#!/usr/bin/env bash
# Setup APIWeave Desktop (single-process Electron)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo "  APIWeave - Setup"
echo "========================================"
echo

# Check Node.js 20+
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi
NODE_VER=$(node -v)
echo "Node.js $NODE_VER detected"
echo

echo "Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install

echo
echo "Installing desktop dependencies..."
cd "$ROOT_DIR/desktop"
npm install

echo
echo "Rebuilding native modules for Electron..."
npm run rebuild:electron || echo "WARNING: electron-rebuild failed (may need Visual Studio Build Tools / build-essential)"

echo
echo "========================================"
echo "Setup complete!"
echo
echo "Run: ./start-dev.sh"
echo
