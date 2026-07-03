"""Workspace creation authorization (roadmap §3.5 / P3.5).

create_workspace must not let an arbitrary authenticated user provision a
workspace inside an org they don't belong to (cross-tenant privilege
escalation — they'd become its admin), nor create a personal workspace owned
by another user.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.models import Organization, OrganizationMember
from app.services import workspace_service
from fastapi import HTTPException

_T = datetime(2026, 6, 26, tzinfo=UTC)


async def _org(org_id: str, owner: str = "someone") -> None:
    await Organization(
        orgId=org_id,
        slug=org_id,
        name=org_id.upper(),
        ownerUserId=owner,
        createdAt=_T,
        updatedAt=_T,
    ).insert()


async def test_non_member_cannot_create_org_workspace(seeded) -> None:
    await _org("org-x")
    with pytest.raises(HTTPException) as exc:
        await workspace_service.create_workspace(
            name="W",
            slug="w",
            owner_type="organization",
            org_id="org-x",
            actor_user_id="bob",
        )
    assert exc.value.status_code == 403


async def test_member_can_create_org_workspace(seeded) -> None:
    await _org("org-y")
    await OrganizationMember(
        memberId="om-1",
        orgId="org-y",
        userId="alice",
        role="member",
        createdAt=_T,
        updatedAt=_T,
    ).insert()

    result = await workspace_service.create_workspace(
        name="Team WS",
        slug="team",
        owner_type="organization",
        org_id="org-y",
        actor_user_id="alice",
    )
    assert result["workspaceId"]
    assert result["orgId"] == "org-y"


async def test_cannot_create_personal_workspace_for_another_user(seeded) -> None:
    with pytest.raises(HTTPException) as exc:
        await workspace_service.create_workspace(
            name="P",
            slug="p2",
            owner_type="user",
            owner_user_id="victim",
            actor_user_id="alice",
        )
    assert exc.value.status_code == 403


async def test_can_create_own_personal_workspace(seeded) -> None:
    result = await workspace_service.create_workspace(
        name="Mine",
        slug="mine",
        owner_type="user",
        actor_user_id="alice",
    )
    assert result["workspaceId"]
    assert result["ownerUserId"] == "alice"
