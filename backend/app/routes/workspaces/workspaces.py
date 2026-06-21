"""Workspace CRUD and health-check endpoints."""

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


class WorkspaceCreateRequest(BaseModel):
    name: str
    slug: str
    ownerType: str  # noqa: N815
    ownerUserId: str | None = None  # noqa: N815
    orgId: str | None = None  # noqa: N815
    description: str | None = None


class WorkspaceUpdateRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    description: str | None = None


@router.get("", response_model=dict[str, Any])
async def list_workspaces(
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List all workspaces accessible to the current user."""
    workspaces = await workspace_service.list_workspaces_for_user(current_user.userId)
    return {"workspaces": workspaces, "total": len(workspaces)}


@router.post("", response_model=dict[str, Any], status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreateRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Create a new workspace."""
    try:
        return await workspace_service.create_workspace(
            name=body.name,
            slug=body.slug,
            owner_type=body.ownerType,
            owner_user_id=body.ownerUserId or current_user.userId,
            org_id=body.orgId,
            description=body.description,
            actor_user_id=current_user.userId,
        )
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/healthz")
async def workspaces_healthz() -> dict[str, str]:
    """Health check for workspaces routes."""
    return {"status": "ok"}


@router.get("/{workspace_id}", response_model=dict[str, Any])
async def get_workspace(
    workspace_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Get a workspace by ID."""
    try:
        return await workspace_service.get_workspace(workspace_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch("/{workspace_id}", response_model=dict[str, Any])
async def update_workspace(
    workspace_id: str,
    body: WorkspaceUpdateRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Update a workspace."""
    try:
        return await workspace_service.update_workspace(
            workspace_id,
            name=body.name,
            slug=body.slug,
            description=body.description,
            actor_user_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Soft-delete a workspace."""
    try:
        await workspace_service.delete_workspace(workspace_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.post("/{workspace_id}/restore", response_model=dict[str, Any])
async def restore_workspace(
    workspace_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Restore a soft-deleted workspace."""
    try:
        return await workspace_service.restore_workspace(workspace_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
