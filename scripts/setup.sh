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

echo "Installing app dependencies..."
cd "$APP_DIR"
npm install

echo
echo "Rebuilding native modules for Electron..."
npm run rebuild:electron

echo
echo "========================================"
echo "Setup complete!"
echo
echo "Run: ./scripts/start.sh"
echo
