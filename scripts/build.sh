#!/usr/bin/env bash
# Build the APIWeave desktop installer (renderer + Electron).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/app"
npm run build
