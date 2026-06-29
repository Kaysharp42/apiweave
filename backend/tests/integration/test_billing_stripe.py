"""P4.2: Stripe webhook handling (individual subscription upsert) + guards.

The Team checkout-first path (org creation in the webhook) is exercised via
manual/e2e since it spans org_service + audit; here we lock the core upsert and
the not-configured guards.
"""

from __future__ import annotations

import pytest
from app.billing import stripe_service
from app.config import settings
from app.models import Organization, OrganizationMember, Subscription, User
from beanie import init_beanie
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient


@pytest.fixture
async def db():
    client = AsyncMongoMockClient()
    await init_beanie(
        database=client["billing_stripe_test"],
        document_models=[Subscription, Organization, OrganizationMember, User],
    )


def test_as_dict_handles_stripe_objects_and_plain_dicts():
    # Plain dict passes through; a Stripe-like object (str() is JSON) is parsed.
    assert stripe_service._as_dict({"a": 1}) == {"a": 1}

    class FakeStripeObj:
        def __str__(self) -> str:
            return '{"metadata": {"plan": "individual"}, "items": {"data": [{"quantity": 2}]}}'

    out = stripe_service._as_dict(FakeStripeObj())
    assert out["metadata"]["plan"] == "individual"
    assert out["items"]["data"][0]["quantity"] == 2  # nested is plain too


def test_parse_event_requires_webhook_secret(monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", "")
    with pytest.raises(HTTPException) as exc:
        stripe_service.parse_event(b"{}", "sig")
    assert exc.value.status_code == 503


async def test_checkout_completed_upserts_user_subscription(db, monkeypatch):
    # Stub the Stripe SDK call the handler makes.
    monkeypatch.setattr(
        stripe_service.stripe.Subscription,
        "retrieve",
        lambda sub_id: {
            "id": sub_id,
            "status": "active",
            "current_period_end": 1893456000,
            "cancel_at_period_end": False,
            "items": {"data": [{"quantity": 3}]},
        },
    )
    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": "cus_123",
                "subscription": "sub_123",
                "metadata": {
                    "subject_type": "user",
                    "subject_id": "u-1",
                    "plan": "individual",
                },
            }
        },
    }
    await stripe_service.handle_event(event)

    sub = await Subscription.find_one(Subscription.ownerId == "u-1")
    assert sub is not None
    assert sub.plan == "individual"
    assert sub.status == "active"
    assert sub.seats == 3
    assert sub.stripeSubscriptionId == "sub_123"
    assert sub.stripeCustomerId == "cus_123"
