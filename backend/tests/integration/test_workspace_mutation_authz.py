"""Workspace mutation authorization lock-in (roadmap §3.6 / P1.6).

The §3.6 audit found workspace_service mutations are admin-gated via
_assert_workspace_admin (owner / org-owner / workspace-admin). These tests turn
that audit from "read the code" into executable proof for the highest-risk
mutations, so a future refactor can't silently drop the guard.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.models import WorkspaceMember
from app.services import workspace_service
from app.services.exceptions import ResourceNotFoundError

_T = datetime(2026, 6, 26, tzinfo=UTC)


async def _add_member(user_id: str, role: str, workspace_id: str = "ws-alice") -> None:
    await WorkspaceMember(
        memberId=f"wsm-{user_id}",
        workspaceId=workspace_id,
        userId=user_id,
        role=role,
        createdAt=_T,
        updatedAt=_T,
    ).insert()


async def test_non_member_cannot_update_workspace(seeded) -> None:
    with pytest.raises(ResourceNotFoundError):
        await workspace_service.update_workspace("ws-alice", name="Hijacked", actor_user_id="bob")


async def test_non_admin_member_cannot_update_workspace(seeded) -> None:
    await _add_member("writer", "write")
    with pytest.raises(ResourceNotFoundError):
        await workspace_service.update_workspace(
            "ws-alice", name="Hijacked", actor_user_id="writer"
        )


async def test_non_admin_member_cannot_delete_workspace(seeded) -> None:
    await _add_member("writer2", "write")
    with pytest.raises(ResourceNotFoundError):
        await workspace_service.delete_workspace("ws-alice", actor_user_id="writer2")


async def test_admin_can_update_workspace(seeded) -> None:
    # alice is seeded as an admin member of ws-alice.
    result = await workspace_service.update_workspace(
        "ws-alice", name="Renamed", actor_user_id="alice"
    )
    assert result["name"] == "Renamed"
