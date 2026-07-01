# Local-dev Stripe webhook forwarder (Windows).
# NOT for production — in prod Stripe POSTs directly to your public URL.
# Forwards Stripe test events to the local backend so checkout/subscription
# webhooks work on localhost. Reads STRIPE_SECRET_KEY from backend/.env.
#
# Usage:  pwsh scripts/stripe-listen.ps1 [forward-url]
#   default forward-url: http://localhost:8000/api/billing/webhook

param([string]$ForwardTo = "http://localhost:8000/api/billing/webhook")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root "backend/.env"

# Find the Stripe CLI.
$stripe = (Get-Command stripe -ErrorAction SilentlyContinue).Source
if (-not $stripe) {
  $candidate = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\stripe.exe"
  if (Test-Path $candidate) { $stripe = $candidate }
}
if (-not $stripe) {
  Write-Error "Stripe CLI not found. Install it: winget install Stripe.StripeCli"
  exit 1
}

if (-not (Test-Path $envFile)) { Write-Error "Missing $envFile"; exit 1 }
$key = (Select-String -Path $envFile -Pattern '^STRIPE_SECRET_KEY=(.+)$').Matches.Groups[1].Value
if (-not $key) { Write-Error "STRIPE_SECRET_KEY not set in $envFile"; exit 1 }

Write-Host "Forwarding Stripe events -> $ForwardTo (Ctrl+C to stop)"
& $stripe listen --api-key $key --forward-to $ForwardTo
