"""
Shared helpers for workspace service — slug validation, response DTOs,
and isolation enforcement (access/admin assertions).
"""

import logging
import re
from typing import Any

from app.models import Workspace, WorkspaceMember
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ResourceNotFoundError

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
