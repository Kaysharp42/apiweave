"""
Outside collaborators — add, remove, and list outside collaborators on a workspace.
"""

import logging
import uuid
from typing import Any

from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ConflictError, ResourceNotFoundError

from ._helpers import _assert_workspace_access, _assert_workspace_admin

logger = logging.getLogger(__name__)


async def add_outside_collaborator(
    workspace_id: str,
    user_id: str,
    role: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Add an outside collaborator to a workspace. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    existing = await OutsideCollaboratorRepository.get_by_workspace_and_user(workspace_id, user_id)
    if existing:
        raise ConflictError("User is already an outside collaborator")

    # Ensure user is not already a member
    member = await WorkspaceRepository.get_member(workspace_id, user_id)
    if member:
        raise ConflictError("User is already a workspace member")

    collab_id = f"oc-{uuid.uuid4().hex[:16]}"
    collab = await OutsideCollaboratorRepository.create(
        collaborator_id=collab_id,
        workspace_id=workspace_id,
        user_id=user_id,
        role=role,
        granted_by=actor_user_id,
    )

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workspace.collaborator_added",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="outside_collaborator",
            resource_id=collab_id,
            context={"userId": user_id, "role": role},
        )
    except Exception:
        logger.warning("Audit write failed for collaborator add", exc_info=True)

    return {
        "collaboratorId": collab.collaboratorId,
        "workspaceId": collab.workspaceId,
        "userId": collab.userId,
        "role": collab.role,
        "grantedBy": collab.grantedBy,
        "createdAt": collab.createdAt.isoformat() if collab.createdAt else None,
    }


async def remove_outside_collaborator(
    workspace_id: str,
    collaborator_id: str,
    actor_user_id: str,
) -> None:
    """Remove an outside collaborator. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    removed = await OutsideCollaboratorRepository.remove(collaborator_id)
    if not removed:
        raise ResourceNotFoundError("Outside collaborator not found")


async def list_outside_collaborators(
    workspace_id: str,
    actor_user_id: str,
) -> list[dict[str, Any]]:
    """List outside collaborators for a workspace."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    collabs = await OutsideCollaboratorRepository.list_by_workspace(workspace_id)
    return [
        {
            "collaboratorId": c.collaboratorId,
            "workspaceId": c.workspaceId,
            "userId": c.userId,
            "role": c.role,
            "grantedBy": c.grantedBy,
            "createdAt": c.createdAt.isoformat() if c.createdAt else None,
        }
        for c in collabs
    ]


async def get_workspace_role(
    workspace_id: str,
    user_id: str,
) -> str | None:
    """
    Get the effective role of a user in a workspace.
    Returns None if the user has no access.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        return None

    # Owner
    if ws.ownerType == "user" and ws.ownerUserId == user_id:
        return "admin"

    # Org owner
    if ws.ownerType == "organization" and ws.orgId:
        org_member = await OrganizationRepository.get_member(ws.orgId, user_id)
        if org_member and org_member.role == "owner":
            return "admin"

    # Workspace member
    member = await WorkspaceRepository.get_member(workspace_id, user_id)
    if member:
        return member.role

    # Outside collaborator
    collab = await OutsideCollaboratorRepository.get_by_workspace_and_user(workspace_id, user_id)
    if collab:
        return collab.role

    return None
