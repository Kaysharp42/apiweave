#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting APIWeave desktop app..."
echo
cd "$ROOT_DIR/desktop"
npm run dev
