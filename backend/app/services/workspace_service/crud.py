"""
Workspace CRUD — create, read, update, delete, restore, and list workspaces.
"""

import logging
import uuid
from typing import Any

from app.repositories.organization_repository import OrganizationRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ConflictError, ResourceNotFoundError

from ._helpers import (
    _assert_workspace_access,
    _assert_workspace_admin,
    _validate_slug,
    _workspace_to_response,
)

logger = logging.getLogger(__name__)


async def create_workspace(
    *,
    name: str,
    slug: str,
    owner_type: str,
    owner_user_id: str | None = None,
    org_id: str | None = None,
    description: str | None = None,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Create a new workspace.

    For personal workspaces: owner_type="user", owner_user_id is set.
    For org workspaces: owner_type="organization", org_id is set.
    The creating user becomes an admin member.
    """
    slug = _validate_slug(slug)

    # Check slug availability
    if owner_type == "organization" and org_id:
        available = await WorkspaceRepository.check_slug_available(slug, org_id=org_id)
    elif owner_type == "user" and owner_user_id:
        available = await WorkspaceRepository.check_slug_available(slug, user_id=owner_user_id)
    else:
        raise ValueError("Invalid owner_type: must be 'user' or 'organization'")

    if not available:
        raise ConflictError(f"Workspace slug '{slug}' is already taken in this scope")

    workspace_id = f"ws-{uuid.uuid4().hex[:16]}"
    ws = await WorkspaceRepository.create(
        workspace_id=workspace_id,
        slug=slug,
        name=name,
        owner_type=owner_type,
        owner_user_id=owner_user_id,
        org_id=org_id,
        description=description,
    )

    # Add creator as admin member
    member_id = f"wsm-{uuid.uuid4().hex[:16]}"
    await WorkspaceRepository.add_member(
        member_id=member_id,
        workspace_id=workspace_id,
        user_id=actor_user_id,
        role="admin",
    )

    # Audit
    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workspace.created",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="workspace",
            resource_id=workspace_id,
            context={"slug": slug, "ownerType": owner_type},
        )
    except Exception:
        logger.warning("Audit write failed for workspace creation", exc_info=True)

    return _workspace_to_response(ws)


async def get_workspace(
    workspace_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Get a workspace by ID. Enforces isolation — user must have access.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)
    return _workspace_to_response(ws)


async def get_workspace_by_slug(
    *,
    slug: str,
    org_id: str | None = None,
    user_id: str | None = None,
    actor_user_id: str,
) -> dict[str, Any]:
    """Get a workspace by slug within a scope."""
    slug = _validate_slug(slug)
    if org_id:
        ws = await WorkspaceRepository.get_by_slug_and_org(slug, org_id)
    elif user_id:
        ws = await WorkspaceRepository.get_by_slug_and_user(slug, user_id)
    else:
        raise ValueError("Either org_id or user_id must be provided")

    if not ws:
        raise ResourceNotFoundError(f"Workspace with slug '{slug}' not found")

    await _assert_workspace_access(ws, actor_user_id)
    return _workspace_to_response(ws)


async def update_workspace(
    workspace_id: str,
    *,
    name: str | None = None,
    slug: str | None = None,
    description: str | None = None,
    actor_user_id: str,
) -> dict[str, Any]:
    """Update workspace fields. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    if slug is not None:
        slug = _validate_slug(slug)
        if ws.ownerType == "organization" and ws.orgId:
            available = await WorkspaceRepository.check_slug_available(slug, org_id=ws.orgId)
        elif ws.ownerType == "user" and ws.ownerUserId:
            available = await WorkspaceRepository.check_slug_available(slug, user_id=ws.ownerUserId)
        else:
            available = True
        if not available:
            raise ConflictError(f"Workspace slug '{slug}' is already taken")

    updated = await WorkspaceRepository.update(
        workspace_id,
        name=name,
        slug=slug,
        description=description,
    )
    if not updated:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workspace.updated",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="workspace",
            resource_id=workspace_id,
            context={
                k: v
                for k, v in {"name": name, "slug": slug, "description": description}.items()
                if v is not None
            },
        )
    except Exception:
        logger.warning("Audit write failed for workspace update", exc_info=True)

    return _workspace_to_response(updated)


async def delete_workspace(
    workspace_id: str,
    actor_user_id: str,
) -> None:
    """Soft-delete a workspace. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    if ws.isPersonal:
        raise ConflictError("Cannot delete a personal workspace")

    await WorkspaceRepository.soft_delete(workspace_id)

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workspace.deleted",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="workspace",
            resource_id=workspace_id,
        )
    except Exception:
        logger.warning("Audit write failed for workspace deletion", exc_info=True)


async def restore_workspace(
    workspace_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Restore a soft-deleted workspace. Requires admin role."""
    ws = await WorkspaceRepository.get_by_id_including_deleted(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_admin(ws, actor_user_id)

    restored = await WorkspaceRepository.restore(workspace_id)
    if not restored:
        raise ResourceNotFoundError(f"Workspace {workspace_id} is not deleted")

    return _workspace_to_response(restored)


async def list_workspaces_for_user(
    user_id: str,
) -> list[dict[str, Any]]:
    """List all workspaces accessible to a user."""
    workspaces = await WorkspaceRepository.list_by_user(user_id)
    return [_workspace_to_response(ws) for ws in workspaces]


async def list_workspaces_for_org(
    org_id: str,
    actor_user_id: str,
) -> list[dict[str, Any]]:
    """List all workspaces in an organization. Actor must be org member."""
    org = await OrganizationRepository.get_by_id(org_id)
    if not org:
        raise ResourceNotFoundError(f"Organization {org_id} not found")

    member = await OrganizationRepository.get_member(org_id, actor_user_id)
    if not member:
        raise ResourceNotFoundError("Not a member of this organization")

    workspaces = await WorkspaceRepository.list_by_org(org_id)
    return [_workspace_to_response(ws) for ws in workspaces]
