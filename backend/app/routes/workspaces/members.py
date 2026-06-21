"""Workspace members and outside collaborators endpoints."""

import logging
from typing import Any

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.models import User
from app.services import workspace_service
from app.services.exceptions import ConflictError, ResourceNotFoundError

from ._router import router

logger = logging.getLogger(__name__)


# ============================================================================
# Request / Response Models
# ============================================================================


class MemberAddRequest(BaseModel):
    userId: str  # noqa: N815
    role: str = "write"


class MemberRoleUpdateRequest(BaseModel):
    role: str


class CollaboratorAddRequest(BaseModel):
    userId: str  # noqa: N815
    role: str = "read"


# ============================================================================
# Workspace Members
# ============================================================================


@router.get("/{workspace_id}/members", response_model=dict[str, Any])
async def list_members(
    workspace_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List workspace members."""
    try:
        members = await workspace_service.list_members(workspace_id, current_user.userId)
        return {"members": members, "total": len(members)}
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{workspace_id}/members",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    workspace_id: str,
    body: MemberAddRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Add a member to a workspace."""
    try:
        return await workspace_service.add_member(
            workspace_id, body.userId, body.role, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.patch("/{workspace_id}/members/{user_id}", response_model=dict[str, Any])
async def update_member_role(
    workspace_id: str,
    user_id: str,
    body: MemberRoleUpdateRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Update a workspace member's role."""
    try:
        return await workspace_service.update_member_role(
            workspace_id, user_id, body.role, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete(
    "/{workspace_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    workspace_id: str,
    user_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Remove a member from a workspace."""
    try:
        await workspace_service.remove_member(workspace_id, user_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ============================================================================
# Outside Collaborators
# ============================================================================


@router.get("/{workspace_id}/collaborators", response_model=dict[str, Any])
async def list_collaborators(
    workspace_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List outside collaborators for a workspace."""
    try:
        collabs = await workspace_service.list_outside_collaborators(
            workspace_id, current_user.userId
        )
        return {"collaborators": collabs, "total": len(collabs)}
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{workspace_id}/collaborators",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
)
async def add_collaborator(
    workspace_id: str,
    body: CollaboratorAddRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Add an outside collaborator to a workspace."""
    try:
        return await workspace_service.add_outside_collaborator(
            workspace_id, body.userId, body.role, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.delete(
    "/{workspace_id}/collaborators/{collaborator_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_collaborator(
    workspace_id: str,
    collaborator_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Remove an outside collaborator."""
    try:
        await workspace_service.remove_outside_collaborator(
            workspace_id, collaborator_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
