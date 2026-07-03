#!/usr/bin/env bash
# Local-dev Stripe webhook forwarder (Linux/macOS).
# NOT for production — in prod Stripe POSTs directly to your public URL.
# Forwards Stripe test events to the local backend so checkout/subscription
# webhooks work on localhost. Reads STRIPE_SECRET_KEY from backend/.env.
#
# Usage:  ./scripts/stripe-listen.sh [forward-url]
#   default forward-url: http://localhost:8000/api/billing/webhook
set -euo pipefail

FORWARD_TO="${1:-http://localhost:8000/api/billing/webhook}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env"

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI not found. Install it: https://docs.stripe.com/stripe-cli/install" >&2
  exit 1
fi
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }

KEY="$(grep -E '^STRIPE_SECRET_KEY=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
[ -n "$KEY" ] || { echo "STRIPE_SECRET_KEY not set in $ENV_FILE" >&2; exit 1; }

echo "Forwarding Stripe events -> $FORWARD_TO (Ctrl+C to stop)"
exec stripe listen --api-key "$KEY" --forward-to "$FORWARD_TO"
