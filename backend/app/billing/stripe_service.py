"""Stripe integration (Phase 4, P4.2): Checkout, Customer Portal, webhooks.

Subjects: Individual subscribes a USER (pay-what-you-want, $1/unit, adjustable
quantity). Teams runs checkout-first — the org is created by the webhook once
payment succeeds. All plan state lands in the Subscription doc (single source
the entitlement resolver reads) and is denormalized onto Organization.plan.

Keys/price IDs come from settings (.env / deployment secrets), never the repo.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import stripe
from fastapi import HTTPException, status

from app.config import settings
from app.models import Subscription, User
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.subscription_repository import SubscriptionRepository
from app.utils.slug import validate_slug

logger = logging.getLogger(__name__)


def _client() -> None:
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Billing is not configured",
        )
    stripe.api_key = settings.STRIPE_SECRET_KEY


def _abs_url(path: str) -> str:
    """Resolve a frontend path to an absolute URL. Stripe success/cancel/return
    land on FRONTEND routes, so use the frontend origin (not the backend
    BASE_URL) — same resolution the auth redirects use."""
    if path.startswith("http"):
        return path
    base = settings.FRONTEND_URL
    if not base:
        origins = settings.get_allowed_origins_list()
        base = origins[0] if origins else "http://localhost:3000"
    return f"{base.rstrip('/')}{path if path.startswith('/') else '/' + path}"


async def create_checkout_session(
    *,
    user: User,
    plan: str,
    seats: int = 1,
    org_name: str | None = None,
    org_slug: str | None = None,
) -> str:
    """Return a Stripe Checkout URL for the chosen plan."""
    _client()
    if plan not in ("individual", "team"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown plan")

    success_url = _abs_url(settings.BILLING_SUCCESS_URL)
    cancel_url = _abs_url(settings.BILLING_CANCEL_URL)

    if plan == "individual":
        if not settings.STRIPE_PRICE_INDIVIDUAL:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Plan not configured")
        session = stripe.checkout.Session.create(
            line_items=[
                {
                    "price": settings.STRIPE_PRICE_INDIVIDUAL,
                    "quantity": max(1, seats),
                    "adjustable_quantity": {"enabled": True, "minimum": 1},
                }
            ],
            metadata={"subject_type": "user", "subject_id": user.userId, "plan": "individual"},
            mode="subscription",
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=user.userId,
            customer_email=user.verified_email,
        )
        return _session_url(session.url)

    # team — checkout-first: org is created by the webhook on success.
    if not settings.STRIPE_PRICE_TEAM:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Plan not configured")
    if not org_name or not org_slug:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "org_name and org_slug are required for Teams"
        )
    normalized_slug = await _normalize_available_org_slug(org_slug)
    session = stripe.checkout.Session.create(
        line_items=[{"price": settings.STRIPE_PRICE_TEAM, "quantity": max(1, seats)}],
        metadata={
            "subject_type": "organization",
            "plan": "team",
            "owner_user_id": user.userId,
            "org_name": org_name,
            "org_slug": normalized_slug,
        },
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        client_reference_id=user.userId,
        customer_email=user.verified_email,
    )
    return _session_url(session.url)


def _session_url(url: str | None) -> str:
    if not url:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Stripe did not return a session URL")
    return url


async def _normalize_available_org_slug(org_slug: str) -> str:
    try:
        normalized_slug = validate_slug(org_slug)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid organization slug") from exc

    existing = await OrganizationRepository.get_by_slug(normalized_slug)
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"error": "slug_conflict", "slug": normalized_slug},
        )
    return normalized_slug


async def _require_portal_access(*, user: User, owner_type: str, owner_id: str) -> None:
    if owner_type == "user":
        if owner_id != user.userId:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your subscription")
        return

    if owner_type == "organization":
        from app.services import org_service

        await org_service.require_org_owner(owner_id, user.userId)
        return

    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown billing owner")


async def create_portal_session(
    *, user: User, owner_type: str, owner_id: str, return_url: str
) -> str:
    """Return a Stripe Customer Portal URL for the subject's subscription."""
    _client()
    await _require_portal_access(user=user, owner_type=owner_type, owner_id=owner_id)
    sub = await SubscriptionRepository.get_for(owner_type, owner_id)
    if sub is None or not sub.stripeCustomerId:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No active subscription")
    session = stripe.billing_portal.Session.create(
        customer=sub.stripeCustomerId,
        return_url=_abs_url(return_url),
    )
    return session.url


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------


def parse_event(payload: bytes, sig_header: str) -> dict[str, Any]:
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Webhook not configured")
    try:
        return _as_dict(
            stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        )
    except (ValueError, stripe.SignatureVerificationError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook signature") from e


def _as_dict(obj: object) -> dict[str, Any]:
    """Stripe SDK objects don't expose dict.get the way plain dicts do; their
    str() is a JSON dump, so round-trip to a fully-plain nested dict."""
    if isinstance(obj, dict):
        return {str(key): value for key, value in obj.items()}
    parsed = json.loads(str(obj))
    if not isinstance(parsed, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Stripe payload")
    return {str(key): value for key, value in parsed.items()}


async def handle_event(event: dict[str, Any]) -> None:
    _client()  # webhook path also needs stripe.api_key set for retrieve()
    kind = event["type"]
    obj = _as_dict(event["data"]["object"])
    if kind == "checkout.session.completed":
        await _on_checkout_completed(obj)
    elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
        await _on_subscription_changed(obj)
    else:
        logger.debug("Ignoring Stripe event %s", kind)


def _period_end(stripe_sub: dict) -> datetime | None:
    # Stripe moved current_period_end onto subscription items (API 2024-+);
    # fall back to the top-level field for older versions.
    ts = stripe_sub.get("current_period_end")
    if not ts:
        items = stripe_sub.get("items", {}).get("data", [])
        if items:
            ts = items[0].get("current_period_end")
    return datetime.fromtimestamp(ts, tz=UTC) if ts else None


async def _upsert(
    *, owner_type: str, owner_id: str, plan: str, stripe_sub: dict, customer_id: str
) -> None:
    now = datetime.now(UTC)
    seats = 1
    items = stripe_sub.get("items", {}).get("data", [])
    if items:
        seats = items[0].get("quantity", 1)
    await SubscriptionRepository.upsert(
        Subscription(
            subscriptionId=f"bsub-{uuid.uuid4().hex[:12]}",
            ownerType=owner_type,
            ownerId=owner_id,
            plan=plan,
            status=stripe_sub.get("status", "active"),
            seats=seats,
            stripeCustomerId=customer_id,
            stripeSubscriptionId=stripe_sub.get("id"),
            currentPeriodEnd=_period_end(stripe_sub),
            cancelAtPeriodEnd=bool(stripe_sub.get("cancel_at_period_end")),
            createdAt=now,
            updatedAt=now,
        )
    )
    if owner_type == "organization":
        await OrganizationRepository.set_plan(owner_id, plan)


async def _on_checkout_completed(session: dict) -> None:
    meta = session.get("metadata") or {}
    plan = meta.get("plan")
    customer_id = session.get("customer")
    sub_id = session.get("subscription")
    if not isinstance(sub_id, str):
        return
    if not isinstance(customer_id, str):
        logger.error("Stripe checkout session %s has no customer", session.get("id"))
        return
    stripe_sub = _as_dict(stripe.Subscription.retrieve(sub_id))

    if meta.get("subject_type") == "user":
        await _upsert(
            owner_type="user",
            owner_id=meta["subject_id"],
            plan=plan or "individual",
            stripe_sub=stripe_sub,
            customer_id=customer_id,
        )
    elif meta.get("subject_type") == "organization":
        # Checkout-first: create the org now that payment succeeded.
        from app.repositories.auth_repositories import UserRepository
        from app.services import org_service

        owner = await UserRepository.get_by_id(meta["owner_user_id"])
        if owner is None:
            logger.error("Team checkout for unknown user %s", meta.get("owner_user_id"))
            return
        org_slug = _safe_checkout_org_slug(meta.get("org_slug"))
        try:
            org = await org_service.create_org(
                name=meta["org_name"],
                slug=org_slug,
                owner_user=owner,
                skip_entitlement=True,
            )
        except HTTPException as exc:
            if exc.status_code != status.HTTP_409_CONFLICT:
                raise
            org_slug = f"{org_slug}_{uuid.uuid4().hex[:8]}"
            logger.warning("Team checkout slug was claimed before webhook; using %s", org_slug)
            org = await org_service.create_org(
                name=meta["org_name"],
                slug=org_slug,
                owner_user=owner,
                skip_entitlement=True,
            )
        await _upsert(
            owner_type="organization",
            owner_id=org.orgId,
            plan="team",
            stripe_sub=stripe_sub,
            customer_id=customer_id,
        )


def _safe_checkout_org_slug(raw_slug: str | None) -> str:
    try:
        return validate_slug(raw_slug or "")
    except ValueError:
        fallback_slug = f"team_{uuid.uuid4().hex[:8]}"
        logger.warning("Team checkout had invalid org slug; using %s", fallback_slug)
        return fallback_slug


async def _on_subscription_changed(stripe_sub: dict) -> None:
    stripe_sub_id = stripe_sub.get("id")
    if not isinstance(stripe_sub_id, str):
        return
    existing = await SubscriptionRepository.get_by_stripe_subscription(stripe_sub_id)
    if existing is None:
        return  # not ours / not yet recorded
    customer_id = existing.stripeCustomerId or stripe_sub.get("customer")
    if not isinstance(customer_id, str):
        return
    await _upsert(
        owner_type=existing.ownerType,
        owner_id=existing.ownerId,
        plan=existing.plan,
        stripe_sub=stripe_sub,
        customer_id=customer_id,
    )
