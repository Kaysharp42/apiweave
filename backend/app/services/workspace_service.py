"""
Workspace Service — business logic for workspace CRUD, membership,
outside collaborators, and per-workspace isolation enforcement.

All workspace operations are scoped: a user can only access workspaces
they own, are members of, or are outside collaborators on.
"""

import logging
import re
import uuid
from typing import Any

from app.models import Workspace, WorkspaceMember
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
SLUG_MAX_LENGTH = 63


def _validate_slug(slug: str) -> str:
    """Validate and normalize a workspace slug."""
    slug = slug.strip().lower()
    if not slug:
        raise ValueError("Slug cannot be empty")
    if len(slug) > SLUG_MAX_LENGTH:
        raise ValueError(f"Slug must be {SLUG_MAX_LENGTH} characters or fewer")
    if not SLUG_PATTERN.match(slug):
        raise ValueError(
            "Slug must start and end with alphanumeric characters "
            "and contain only lowercase letters, numbers, and hyphens"
        )
    return slug


# ============================================================================
# Response DTOs
# ============================================================================


def _workspace_to_response(ws: Workspace) -> dict[str, Any]:
    """Convert a Workspace document to a response dict."""
    return {
        "workspaceId": ws.workspaceId,
        "slug": ws.slug,
        "name": ws.name,
        "description": ws.description,
        "ownerType": ws.ownerType,
        "ownerUserId": ws.ownerUserId,
        "orgId": ws.orgId,
        "isPersonal": ws.isPersonal,
        "createdAt": ws.createdAt.isoformat() if ws.createdAt else None,
        "updatedAt": ws.updatedAt.isoformat() if ws.updatedAt else None,
    }


def _member_to_response(member: WorkspaceMember) -> dict[str, Any]:
    """Convert a WorkspaceMember document to a response dict."""
    return {
        "memberId": member.memberId,
        "workspaceId": member.workspaceId,
        "userId": member.userId,
        "role": member.role,
        "createdAt": member.createdAt.isoformat() if member.createdAt else None,
        "updatedAt": member.updatedAt.isoformat() if member.updatedAt else None,
    }


# ============================================================================
# Workspace CRUD
# ============================================================================


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


# ============================================================================
# Workspace Membership
# ============================================================================


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


# ============================================================================
# Outside Collaborators
# ============================================================================


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


# ============================================================================
# Isolation Enforcement
# ============================================================================


async def _assert_workspace_access(ws: Workspace, user_id: str) -> None:
    """
    Assert that a user has access to a workspace.
    Access is granted if:
    - User is the owner (for personal workspaces)
    - User is a workspace member
    - User is an outside collaborator
    - User is an org member (for org-owned workspaces)
    """
    # Owner check
    if ws.ownerType == "user" and ws.ownerUserId == user_id:
        return

    # Org owner check
    if ws.ownerType == "organization" and ws.orgId:
        org_member = await OrganizationRepository.get_member(ws.orgId, user_id)
        if org_member:
            return

    # Workspace member check
    member = await WorkspaceRepository.get_member(ws.workspaceId, user_id)
    if member:
        return

    # Outside collaborator check
    collab = await OutsideCollaboratorRepository.get_by_workspace_and_user(ws.workspaceId, user_id)
    if collab:
        return

    raise ResourceNotFoundError(f"Workspace {ws.workspaceId} not found")


async def _assert_workspace_admin(ws: Workspace, user_id: str) -> None:
    """Assert that a user has admin access to a workspace."""
    # Owner is always admin
    if ws.ownerType == "user" and ws.ownerUserId == user_id:
        return

    # Org owner is always admin of org workspaces
    if ws.ownerType == "organization" and ws.orgId:
        org_member = await OrganizationRepository.get_member(ws.orgId, user_id)
        if org_member and org_member.role == "owner":
            return

    # Check workspace member role
    member = await WorkspaceRepository.get_member(ws.workspaceId, user_id)
    if member and member.role == "admin":
        return

    raise ResourceNotFoundError(f"Workspace {ws.workspaceId} not found")


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
