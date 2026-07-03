"""P4.2: Stripe webhook handling (individual subscription upsert) + guards.

The Team checkout-first path (org creation in the webhook) is exercised via
manual/e2e since it spans org_service + audit; here we lock the core upsert and
the not-configured guards.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.billing import stripe_service
from app.config import settings
from app.models import AuditEvent, Organization, OrganizationMember, Subscription, User
from beanie import init_beanie
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient


@pytest.fixture
async def db():
    client = AsyncMongoMockClient()
    await init_beanie(
        database=client["billing_stripe_test"],
        document_models=[Subscription, Organization, OrganizationMember, User, AuditEvent],
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


async def test_portal_rejects_other_user_subscription(db, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_123")
    now = datetime.now(UTC)
    await Subscription(
        subscriptionId="bsub-other",
        ownerType="user",
        ownerId="u-2",
        plan="individual",
        status="active",
        stripeCustomerId="cus_other",
        stripeSubscriptionId="sub_other",
        createdAt=now,
        updatedAt=now,
    ).insert()

    def fail_create(**kwargs):
        raise AssertionError("portal should not be created for another user")

    monkeypatch.setattr(stripe_service.stripe.billing_portal.Session, "create", fail_create)
    user = User(
        userId="u-1",
        verified_email="one@example.test",
        created_at=now,
        updated_at=now,
    )

    with pytest.raises(HTTPException) as exc:
        await stripe_service.create_portal_session(
            user=user,
            owner_type="user",
            owner_id="u-2",
            return_url="/billing",
        )

    assert exc.value.status_code == 403


async def test_team_checkout_rejects_taken_slug_before_stripe(db, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(settings, "STRIPE_PRICE_TEAM", "price_team")
    now = datetime.now(UTC)
    await Organization(
        orgId="org-existing",
        slug="acme",
        name="Existing",
        ownerUserId="u-owner",
        createdAt=now,
        updatedAt=now,
    ).insert()

    def fail_create(**kwargs):
        raise AssertionError("checkout should not be created for a reserved slug")

    monkeypatch.setattr(stripe_service.stripe.checkout.Session, "create", fail_create)
    user = User(
        userId="u-1",
        verified_email="one@example.test",
        created_at=now,
        updated_at=now,
    )

    with pytest.raises(HTTPException) as exc:
        await stripe_service.create_checkout_session(
            user=user,
            plan="team",
            org_name="Acme",
            org_slug="Acme",
        )

    assert exc.value.status_code == 409


async def test_team_checkout_normalizes_slug_metadata(db, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setattr(settings, "STRIPE_PRICE_TEAM", "price_team")
    now = datetime.now(UTC)
    captured = {}

    class FakeSession:
        url = "https://checkout.example.test/session"

    def fake_create(**kwargs):
        captured.update(kwargs)
        return FakeSession()

    monkeypatch.setattr(stripe_service.stripe.checkout.Session, "create", fake_create)
    user = User(
        userId="u-1",
        verified_email="one@example.test",
        created_at=now,
        updated_at=now,
    )

    url = await stripe_service.create_checkout_session(
        user=user,
        plan="team",
        org_name="Acme Team",
        org_slug="Acme Team",
    )

    assert url == "https://checkout.example.test/session"
    assert captured["metadata"]["org_slug"] == "acme_team"


async def test_checkout_completed_uses_fallback_slug_when_reserved_after_payment(db, monkeypatch):
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_123")
    now = datetime.now(UTC)
    await User(
        userId="u-1",
        verified_email="one@example.test",
        created_at=now,
        updated_at=now,
    ).insert()
    await Organization(
        orgId="org-existing",
        slug="acme",
        name="Existing",
        ownerUserId="u-other",
        createdAt=now,
        updatedAt=now,
    ).insert()
    monkeypatch.setattr(
        stripe_service.stripe.Subscription,
        "retrieve",
        lambda sub_id: {
            "id": sub_id,
            "status": "active",
            "current_period_end": 1893456000,
            "cancel_at_period_end": False,
            "items": {"data": [{"quantity": 5}]},
        },
    )
    event = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": "cus_team",
                "subscription": "sub_team",
                "metadata": {
                    "subject_type": "organization",
                    "owner_user_id": "u-1",
                    "org_name": "Acme",
                    "org_slug": "acme",
                    "plan": "team",
                },
            }
        },
    }

    await stripe_service.handle_event(event)

    orgs = await Organization.find(Organization.ownerUserId == "u-1").to_list()
    assert len(orgs) == 1
    assert orgs[0].slug.startswith("acme_")
    sub = await Subscription.find_one(Subscription.ownerId == orgs[0].orgId)
    assert sub is not None
    assert sub.plan == "team"
    assert sub.stripeCustomerId == "cus_team"
