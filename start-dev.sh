#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

echo "Starting APIWeave development environment..."

# Start MongoDB if not running
if ! pgrep -x mongod >/dev/null 2>&1; then
  echo "MongoDB not running - attempting to start mongod (background)"
  mkdir -p /data/db 2>/dev/null || true
  nohup mongod --dbpath /data/db > "$LOG_DIR/mongod.log" 2>&1 &
  sleep 2
else
  echo "MongoDB already running"
fi

# Start Backend API
echo "Starting Backend API..."
if [ -d "$ROOT_DIR/backend/venv" ]; then
  # Activate venv and run uvicorn in background
  nohup bash -lc "source '$ROOT_DIR/backend/venv/bin/activate' && cd '$ROOT_DIR/backend' && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" > "$LOG_DIR/backend.log" 2>&1 &
else
  echo "Warning: virtualenv not found at backend/venv. Trying to run uvicorn from environment."
  nohup bash -lc "cd '$ROOT_DIR/backend' && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" > "$LOG_DIR/backend.log" 2>&1 &
fi

sleep 2

# Start Worker
echo "Starting Worker..."
if [ -d "$ROOT_DIR/backend/venv" ]; then
  nohup bash -lc "source '$ROOT_DIR/backend/venv/bin/activate' && cd '$ROOT_DIR/backend' && python -m app.worker" > "$LOG_DIR/worker.log" 2>&1 &
else
  nohup bash -lc "cd '$ROOT_DIR/backend' && python -m app.worker" > "$LOG_DIR/worker.log" 2>&1 &
fi

sleep 2

# Start Frontend (Vite)
echo "Starting Frontend..."
if [ -d "$ROOT_DIR/frontend" ]; then
  nohup bash -lc "cd '$ROOT_DIR/frontend' && npm run dev" > "$LOG_DIR/frontend.log" 2>&1 &
else
  echo "Frontend directory not found"
fi

echo
echo "All services started (logs in $LOG_DIR)"
echo "Frontend:  http://localhost:3000"
echo "Backend:   http://localhost:8000"
echo "API Docs:  http://localhost:8000/docs"

exit 0
