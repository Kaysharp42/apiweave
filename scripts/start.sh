#!/usr/bin/env bash
# Start the APIWeave desktop app with the Vite renderer and Electron shell.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/app"
npm run dev
