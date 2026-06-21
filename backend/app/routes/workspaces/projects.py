"""Project CRUD endpoints nested under workspaces."""

import logging
from typing import Any

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.models import User
from app.services import project_service
from app.services.exceptions import ResourceNotFoundError

from ._router import router

logger = logging.getLogger(__name__)


# ============================================================================
# Request / Response Models
# ============================================================================


class ProjectCreateRequest(BaseModel):
    name: str
    description: str | None = None
    color: str | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None


# ============================================================================
# Projects (nested under workspace)
# ============================================================================


@router.get("/{workspace_id}/projects", response_model=dict[str, Any])
async def list_projects(
    workspace_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List projects in a workspace."""
    try:
        projects = await project_service.list_projects(workspace_id, current_user.userId)
        return {"projects": projects, "total": len(projects)}
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{workspace_id}/projects",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    workspace_id: str,
    body: ProjectCreateRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Create a project in a workspace."""
    try:
        return await project_service.create_project(
            name=body.name,
            workspace_id=workspace_id,
            description=body.description,
            color=body.color,
            actor_user_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/{workspace_id}/projects/{project_id}", response_model=dict[str, Any])
async def get_project(
    workspace_id: str,
    project_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Get a project."""
    try:
        project = await project_service.get_project(project_id, current_user.userId)
        # Verify project belongs to workspace
        if project.get("workspaceId") and project["workspaceId"] != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id} not found in workspace",
            )
        return project
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch("/{workspace_id}/projects/{project_id}", response_model=dict[str, Any])
async def update_project(
    workspace_id: str,
    project_id: str,
    body: ProjectUpdateRequest,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Update a project."""
    try:
        return await project_service.update_project(
            project_id,
            name=body.name,
            description=body.description,
            color=body.color,
            actor_user_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete(
    "/{workspace_id}/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_project(
    workspace_id: str,
    project_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Delete a project."""
    try:
        await project_service.delete_project(project_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{workspace_id}/projects/{project_id}/workflows/{workflow_id}/assign",
    response_model=dict[str, Any],
)
async def assign_workflow_to_project(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Assign a workflow to a project."""
    try:
        return await project_service.assign_workflow_to_project(
            project_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete(
    "/{workspace_id}/projects/{project_id}/workflows/{workflow_id}",
    response_model=dict[str, Any],
)
async def remove_workflow_from_project(
    workspace_id: str,
    project_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Remove a workflow from a project."""
    try:
        return await project_service.remove_workflow_from_project(
            project_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
