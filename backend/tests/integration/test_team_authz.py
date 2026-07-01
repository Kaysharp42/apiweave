"""Org/team mutation authorization lock-in (roadmap §3.5/§3.6).

Audit found every team_service mutation calls require_org_owner. This locks in
the representative path (create_team): a non-member and a non-owner member are
denied; an org owner is allowed.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.models import Organization, OrganizationMember
from app.services import team_service
from fastapi import HTTPException

_T = datetime(2026, 6, 26, tzinfo=UTC)


async def _org_with_member(org_id: str, user_id: str | None, role: str | None) -> None:
    await Organization(
        orgId=org_id,
        slug=org_id,
        name=org_id.upper(),
        ownerUserId="founder",
        createdAt=_T,
        updatedAt=_T,
    ).insert()
    if user_id and role:
        await OrganizationMember(
            memberId=f"om-{org_id}-{user_id}",
            orgId=org_id,
            userId=user_id,
            role=role,
            createdAt=_T,
            updatedAt=_T,
        ).insert()


async def test_non_member_cannot_create_team(seeded) -> None:
    await _org_with_member("org-nm", None, None)
    with pytest.raises(HTTPException) as exc:
        await team_service.create_team(
            "org-nm", name="T", slug="t", description=None, actor=seeded.bob
        )
    assert exc.value.status_code == 403


async def test_non_owner_member_cannot_create_team(seeded) -> None:
    await _org_with_member("org-mem", "alice", "member")
    with pytest.raises(HTTPException) as exc:
        await team_service.create_team(
            "org-mem", name="T", slug="t", description=None, actor=seeded.alice
        )
    assert exc.value.status_code == 403


async def test_org_owner_can_create_team(seeded) -> None:
    await _org_with_member("org-own", "alice", "owner")
    result = await team_service.create_team(
        "org-own", name="Platform", slug="platform", description=None, actor=seeded.alice
    )
    assert result.name == "Platform"
