"""P3.7-B: the billing seam allows everything while BILLING_ENABLED is off."""

from types import SimpleNamespace

import pytest
from app.config import settings
from app.services import entitlements
from fastapi import HTTPException

# Allow-all path never inspects the user, so a stub avoids Beanie init.
_user = SimpleNamespace(userId="u1")


async def test_seam_allows_all_when_billing_disabled(monkeypatch):
    monkeypatch.setattr(settings, "BILLING_ENABLED", False)
    # None of these should raise.
    await entitlements.require_can_create_org(_user)
    await entitlements.require_can_create_workspace(actor_user_id="u1", org_id=None)
    await entitlements.require_can_create_workspace(actor_user_id="u1", org_id="org-1")
    await entitlements.require_can_add_org_member("org-1")


def test_deny_raises_402():
    with pytest.raises(HTTPException) as exc:
        entitlements.deny("nope")
    assert exc.value.status_code == 402
