#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/frontend"

echo "Setting up Frontend..."

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm not found on PATH. Install Node.js and npm and try again." >&2
  exit 1
fi

echo "Installing npm dependencies..."
npm install

if [ -f .env.example ] && [ ! -f .env ]; then
  echo "Copying .env.example to .env"
  cp .env.example .env
else
  echo ".env already exists or .env.example missing; skipping copy."
fi

echo
echo "Frontend setup complete!"
echo
exit 0
