#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/backend"

echo "Setting up Backend..."

PYTHON_BIN=""
for candidate in python3.13 python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON_BIN="$candidate"
    break
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "Error: Python 3.12+ not found on PATH. Install Python 3.12 or 3.13 and try again." >&2
  exit 1
fi

PYTHON_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
PYTHON_MAJOR="${PYTHON_VERSION%%.*}"
PYTHON_MINOR="${PYTHON_VERSION#*.}"

if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 12 ]; }; then
  echo "Error: $PYTHON_BIN is Python $PYTHON_VERSION, but APIWeave requires Python 3.12+." >&2
  echo "Install Python 3.12 or 3.13, then rerun setup with that interpreter available on PATH." >&2
  exit 1
fi

if [ -d venv ]; then
  VENV_VERSION="$(./venv/bin/python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo unknown)"
  if [ "$VENV_VERSION" != "unknown" ] && { [ "${VENV_VERSION%%.*}" -lt 3 ] || { [ "${VENV_VERSION%%.*}" -eq 3 ] && [ "${VENV_VERSION#*.}" -lt 12 ]; }; }; then
    echo "Existing virtual environment uses Python $VENV_VERSION, which is too old for APIWeave."
    echo "Remove backend/venv and rerun setup after installing Python 3.12 or 3.13."
    exit 1
  fi
  echo "Virtual environment already exists at ./venv and is compatible. Skipping creation."
else
  echo "Creating virtual environment..."
  "$PYTHON_BIN" -m venv venv
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
