# Billing (Stripe) — operations

APIWeave billing is **multi_tenant + `BILLING_ENABLED=true` only**. Self-hosters
leave `BILLING_ENABLED=false` (the default) and get everything unlimited — none
of this applies to them.

## You do NOT run Stripe in production

There is **no Stripe process, daemon, or container** to run. Your backend
already exposes `POST /api/billing/webhook`; in production it has a public
HTTPS URL, and Stripe delivers events directly to it.

`stripe listen` (the Stripe CLI) is a **local-development tool only** — it
tunnels test events to your `localhost`, which Stripe's servers can't reach.
Never run it in production.

## Production setup (once per environment: test, then live)

1. **Create products/prices + register the webhook** with the helper:
   ```bash
   python scripts/stripe_setup.py \
     --api-key sk_live_xxx \
     --webhook-url https://YOUR-DOMAIN/api/billing/webhook \
     --write-env backend/.env
   ```
   It prints (and with `--write-env`, writes) `STRIPE_PRICE_INDIVIDUAL`,
   `STRIPE_PRICE_TEAM`, and—on first run—`STRIPE_WEBHOOK_SECRET`. The webhook
   signing secret is only shown at creation; store it securely.

2. **Set the environment variables** (deployment secrets, not the repo):
   | Var | Value |
   |---|---|
   | `BILLING_ENABLED` | `true` |
   | `STRIPE_SECRET_KEY` | `sk_live_…` |
   | `STRIPE_PUBLISHABLE_KEY` | `pk_live_…` |
   | `STRIPE_WEBHOOK_SECRET` | `whsec_…` (from step 1) |
   | `STRIPE_PRICE_INDIVIDUAL` | `price_…` |
   | `STRIPE_PRICE_TEAM` | `price_…` |
   | `FRONTEND_URL` | your app origin (used for Checkout success/cancel redirects) |

3. **Deploy.** That's it — the backend handles checkout, the customer portal,
   and webhooks. The endpoint is registered for: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.

## Local development

Stripe can't reach `localhost`, so forward test events with the CLI:

- **Native:** `scripts/stripe-listen.ps1` (Windows) or `scripts/stripe-listen.sh`
  (Linux/macOS). They read `STRIPE_SECRET_KEY` from `backend/.env` and run
  `stripe listen --forward-to http://localhost:8000/api/billing/webhook`.
  Install the CLI first: `winget install Stripe.StripeCli` (Windows) or
  https://docs.stripe.com/stripe-cli/install.
- **Docker:** `docker compose -f docker-compose.yml -f docker-compose.stripe-dev.yml up`
  adds a `stripe-cli` sidecar that forwards to the backend container.

Get the dev webhook secret once with `stripe listen --print-secret` (it is
stable per account) and put it in `backend/.env` as `STRIPE_WEBHOOK_SECRET`.

Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

## Tiers

| Tier | Price | Subject |
|---|---|---|
| Free | $0 | user |
| Individual | $1/mo min (adjustable quantity = pay more) | user |
| Teams | $5/seat/mo (≤100) | organization (created on checkout) |
| Enterprise | contact | organization |
