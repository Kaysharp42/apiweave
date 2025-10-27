#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "  APIWeave - Complete Setup (Linux)"
echo "========================================="
echo

# Try to call setup-backend.sh and setup-frontend.sh if they exist
if [ -x ./setup-backend.sh ]; then
  echo "Running backend setup..."
  ./setup-backend.sh
else
  echo "Note: ./setup-backend.sh not found or not executable. Please run backend setup manually if needed."
fi

echo
if [ -x ./setup-frontend.sh ]; then
  echo "Running frontend setup..."
  ./setup-frontend.sh
else
  echo "Note: ./setup-frontend.sh not found or not executable. Please run frontend setup manually (e.g. cd frontend && npm install)."
fi

echo
echo "========================================"
echo
echo "Setup Complete!"
echo
echo "Next steps:"
echo "1. Make sure MongoDB is installed and running (see /data/db or your distro's service)."
echo "2. Run: ./start-dev.sh"
echo
exit 0
