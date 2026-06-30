#!/usr/bin/env python3
"""One-time Stripe setup for APIWeave billing — cross-platform (Windows/Linux/macOS).

Idempotently creates the two recurring Prices (Individual = $1/unit pay-what-you-
want via adjustable quantity; Teams = $5/seat) and, when --webhook-url is given,
registers the production webhook endpoint. Prints the env values to set; with
--write-env it upserts them into a .env file.

PRODUCTION NOTE: you do NOT run `stripe listen` in production. Stripe delivers
webhooks directly to your public --webhook-url. `stripe listen` is only for local
dev (see scripts/stripe-listen.*). Run this once per environment (test + live).

Usage:
  python scripts/stripe_setup.py --api-key sk_test_xxx
  python scripts/stripe_setup.py --webhook-url https://api.example.com/api/billing/webhook --write-env backend/.env
  (api key is read from --api-key, then $STRIPE_SECRET_KEY, then the --env-file)
"""

from __future__ import annotations

import argparse
import os
import re
import sys

WEBHOOK_EVENTS = [
    "checkout.session.completed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
]


def _read_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if path and os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
            if m:
                out[m.group(1)] = m.group(2)
    return out


def _upsert_env(path: str, values: dict[str, str]) -> None:
    text = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    for key, val in values.items():
        if re.search(rf"^{key}=.*$", text, flags=re.MULTILINE):
            text = re.sub(rf"^{key}=.*$", f"{key}={val}", text, flags=re.MULTILINE)
        else:
            text = text.rstrip("\n") + f"\n{key}={val}\n"
    open(path, "w", encoding="utf-8").write(text)


def _ensure_product(stripe, name: str) -> str:
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if p.name == name:
            return p.id
    return stripe.Product.create(name=name).id


def _ensure_price(stripe, product_id: str, lookup_key: str, **create_kwargs) -> str:
    for pr in stripe.Price.list(product=product_id, active=True, limit=100).auto_paging_iter():
        if getattr(pr, "lookup_key", None) == lookup_key:
            return pr.id
    return stripe.Price.create(
        product=product_id, lookup_key=lookup_key, **create_kwargs
    ).id


def main() -> int:
    ap = argparse.ArgumentParser(description="APIWeave Stripe billing setup")
    ap.add_argument("--api-key", help="Stripe secret key (sk_test_/sk_live_)")
    ap.add_argument("--env-file", default="backend/.env", help="Read the key from this .env")
    ap.add_argument("--webhook-url", help="Public URL of /api/billing/webhook to register")
    ap.add_argument("--write-env", help="Upsert resulting values into this .env file")
    args = ap.parse_args()

    try:
        import stripe
    except ImportError:
        print("The 'stripe' package is required: pip install stripe", file=sys.stderr)
        return 1

    env = _read_env_file(args.env_file)
    api_key = args.api_key or os.environ.get("STRIPE_SECRET_KEY") or env.get("STRIPE_SECRET_KEY")
    if not api_key:
        print("No Stripe secret key (--api-key / $STRIPE_SECRET_KEY / .env)", file=sys.stderr)
        return 1
    stripe.api_key = api_key
    live = api_key.startswith("sk_live_")
    print(f"Stripe mode: {'LIVE' if live else 'test'}")

    ind = _ensure_price(
        stripe,
        _ensure_product(stripe, "APIWeave Individual"),
        "apiweave_individual_monthly",
        currency="usd",
        unit_amount=100,  # $1/unit; "pay more" = adjustable quantity at checkout
        recurring={"interval": "month"},
    )
    team = _ensure_price(
        stripe,
        _ensure_product(stripe, "APIWeave Teams"),
        "apiweave_team_monthly",
        currency="usd",
        unit_amount=500,  # $5 / seat / month
        recurring={"interval": "month"},
    )

    result = {"STRIPE_PRICE_INDIVIDUAL": ind, "STRIPE_PRICE_TEAM": team}

    if args.webhook_url:
        existing = next(
            (
                e
                for e in stripe.WebhookEndpoint.list(limit=100).auto_paging_iter()
                if e.url == args.webhook_url
            ),
            None,
        )
        if existing is None:
            ep = stripe.WebhookEndpoint.create(
                url=args.webhook_url, enabled_events=WEBHOOK_EVENTS
            )
            result["STRIPE_WEBHOOK_SECRET"] = ep.secret  # only returned at creation
            print(f"Created webhook endpoint {ep.id}")
        else:
            print(
                f"Webhook endpoint already exists ({existing.id}). Its signing secret "
                "is only shown at creation — reuse the stored STRIPE_WEBHOOK_SECRET, or "
                "roll it in the Stripe dashboard and update the env."
            )

    print("\n# Set these in your environment:")
    for k, v in result.items():
        print(f"{k}={v}")

    if args.write_env:
        _upsert_env(args.write_env, result)
        print(f"\nWrote {', '.join(result)} to {args.write_env}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
