"""
Workspace membership — add, update, remove, and list workspace members.
"""

import logging
import uuid
from typing import Any

from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ConflictError, ResourceNotFoundError

from ._helpers import (
    _assert_workspace_access,
    _assert_workspace_admin,
    _member_to_response,
)

logger = logging.getLogger(__name__)


async def add_member(
    workspace_id: str,
    user_id: str,
    role: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Add a member to a workspace. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    existing = await WorkspaceRepository.get_member(workspace_id, user_id)
    if existing:
        raise ConflictError("User is already a member of this workspace")

    member_id = f"wsm-{uuid.uuid4().hex[:16]}"
    member = await WorkspaceRepository.add_member(
        member_id=member_id,
        workspace_id=workspace_id,
        user_id=user_id,
        role=role,
    )

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workspace.member_added",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="workspace_member",
            resource_id=member_id,
            context={"userId": user_id, "role": role},
        )
    except Exception:
        logger.warning("Audit write failed for member add", exc_info=True)

    return _member_to_response(member)


async def update_member_role(
    workspace_id: str,
    user_id: str,
    role: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Update a workspace member's role. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    member = await WorkspaceRepository.update_member_role(workspace_id, user_id, role)
    if not member:
        raise ResourceNotFoundError("Member not found in workspace")

    return _member_to_response(member)


async def remove_member(
    workspace_id: str,
    user_id: str,
    actor_user_id: str,
) -> None:
    """Remove a member from a workspace. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    removed = await WorkspaceRepository.remove_member(workspace_id, user_id)
    if not removed:
        raise ResourceNotFoundError("Member not found in workspace")


async def list_members(
    workspace_id: str,
    actor_user_id: str,
) -> list[dict[str, Any]]:
    """List all members of a workspace."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    members = await WorkspaceRepository.list_members(workspace_id)
    return [_member_to_response(m) for m in members]
