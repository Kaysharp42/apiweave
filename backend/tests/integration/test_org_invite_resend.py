"""Org invite resend (roadmap P3.5).

resend_org_invite rotates the token (cancel-old + create-new, reusing
create_org_invite's validation) and returns a fresh raw token. Owner gating is
enforced at the route; the service requires org membership.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.models import Organization, OrganizationMember, OrgInvite
from app.repositories.org_invite_repository import OrgInviteRepository
from app.services import org_invite_service
from fastapi import HTTPException

_T = datetime(2026, 6, 26, tzinfo=UTC)
_FUTURE = datetime(2030, 1, 1, tzinfo=UTC)
_EMAIL = "invitee@example.com"


async def _seed(role_for_alice: str | None) -> None:
    await Organization(
        orgId="org-1",
        slug="org-1",
        name="Org 1",
        ownerUserId="alice",
        createdAt=_T,
        updatedAt=_T,
    ).insert()
    if role_for_alice:
        await OrganizationMember(
            memberId="om-alice",
            orgId="org-1",
            userId="alice",
            role=role_for_alice,
            createdAt=_T,
            updatedAt=_T,
        ).insert()


async def _seed_invite(invite_id: str = "oi-1", *, consumed: bool = False) -> None:
    await OrgInvite(
        inviteId=invite_id,
        orgId="org-1",
        email=_EMAIL,
        token_hash="oldhash",
        role="member",
        invited_by="alice",
        created_at=_T,
        expires_at=_FUTURE,
        consumed=consumed,
    ).insert()


async def test_owner_resend_rotates_token(seeded) -> None:
    await _seed("owner")
    await _seed_invite()

    resp = await org_invite_service.resend_org_invite("org-1", "oi-1", actor=seeded.alice)

    assert resp.token  # a fresh raw token is returned
    assert resp.email == _EMAIL
    assert resp.role == "member"
    # Old invite is gone; a new active one exists for the same email.
    assert await OrgInviteRepository.get_by_id("oi-1") is None
    active = await OrgInviteRepository.find_active_by_org_and_email("org-1", _EMAIL)
    assert active is not None
    assert active.inviteId != "oi-1"


async def test_non_member_cannot_resend(seeded) -> None:
    await _seed(role_for_alice=None)  # alice not a member
    await _seed_invite()
    with pytest.raises(HTTPException) as exc:
        await org_invite_service.resend_org_invite("org-1", "oi-1", actor=seeded.alice)
    assert exc.value.status_code == 403


async def test_cannot_resend_accepted_invite(seeded) -> None:
    await _seed("owner")
    await _seed_invite(consumed=True)
    with pytest.raises(HTTPException) as exc:
        await org_invite_service.resend_org_invite("org-1", "oi-1", actor=seeded.alice)
    assert exc.value.status_code == 409
