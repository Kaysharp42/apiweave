#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "Stopping APIWeave services..."

# Kill processes listening on port 8000 and 3000 if any
if command -v fuser >/dev/null 2>&1; then
  echo "Killing processes on port 8000 and 3000 (if any)"
  fuser -k 8000/tcp || true
  fuser -k 3000/tcp || true
else
  # Fallback: use lsof
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti :8000 | xargs -r kill -9 || true
    lsof -ti :3000 | xargs -r kill -9 || true
  else
    echo "Neither fuser nor lsof available - can't kill by port. Please stop services manually."
  fi
fi

# Attempt to stop mongod gracefully
if pgrep -x mongod >/dev/null 2>&1; then
  echo "Stopping mongod"
  pkill -15 mongod || true
  sleep 1
  pkill -9 mongod || true
fi

echo "Services stopped."

exit 0
