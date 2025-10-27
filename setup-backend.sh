#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/backend"

echo "Setting up Backend..."

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 not found on PATH. Install Python 3.8+ and try again." >&2
  exit 1
fi

if [ -d venv ]; then
  echo "Virtual environment already exists at ./venv. Skipping creation.";
else
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

echo "Activating virtual environment..."
# shellcheck disable=SC1091
source venv/bin/activate

echo "Upgrading pip..."
pip install --upgrade pip setuptools wheel

echo "Installing backend dependencies (editable)..."
pip install -e .

echo "Installing backend dev dependencies (if defined)..."
# Try the editable extras install; ignore failure if extras not defined
pip install -e "[dev]" || true

if [ -f .env.example ] && [ ! -f .env ]; then
  echo "Copying .env.example to .env"
  cp .env.example .env
else
  echo ".env already exists or .env.example missing; skipping copy."
fi

echo
echo "Backend setup complete!"
echo "Edit backend/.env to configure MongoDB connection if necessary."
echo
exit 0
