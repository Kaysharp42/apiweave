"""Billing API (Phase 4, P4.2): Stripe Checkout, Customer Portal, webhook.

Checkout/portal require an authenticated user; the webhook is unauthenticated
but signature-verified by Stripe.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.billing import stripe_service
from app.config import settings
from app.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/billing", tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str  # "individual" | "team"
    seats: int = 1
    org_name: str | None = None
    org_slug: str | None = None


class PortalRequest(BaseModel):
    owner_type: str  # "user" | "organization"
    owner_id: str
    return_url: str = "/settings/billing"


@router.get("/config")
async def billing_config() -> dict:
    """Public-ish billing config for the frontend (no secrets)."""
    return {
        "billingEnabled": settings.BILLING_ENABLED,
        "publishableKey": settings.STRIPE_PUBLISHABLE_KEY,
    }


@router.post("/checkout")
async def checkout(
    body: CheckoutRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict:
    url = await stripe_service.create_checkout_session(
        user=current_user,
        plan=body.plan,
        seats=body.seats,
        org_name=body.org_name,
        org_slug=body.org_slug,
    )
    return {"url": url}


@router.post("/portal")
async def portal(
    body: PortalRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict:
    # ponytail: org-owner check happens in the resolver via subscription ownership;
    # a user can only reach a portal for a subscription whose customer is theirs.
    url = await stripe_service.create_portal_session(
        user=current_user,
        owner_type=body.owner_type,
        owner_id=body.owner_id,
        return_url=body.return_url,
    )
    return {"url": url}


@router.post("/webhook", status_code=status.HTTP_200_OK)
async def webhook(request: Request) -> dict:
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    event = stripe_service.parse_event(payload, sig)
    await stripe_service.handle_event(event)
    return {"received": True}
