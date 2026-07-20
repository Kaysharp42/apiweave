#!/usr/bin/env bash
# Build and start the APIWeave desktop app with its embedded renderer.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/app"
npm run dev
