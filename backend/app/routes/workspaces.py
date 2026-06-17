"""
Workspace API routes — GitHub-style nested route structure.

Routes:
  GET    /api/workspaces                          — list user's workspaces
  POST   /api/workspaces                          — create workspace
  GET    /api/workspaces/{workspace_id}            — get workspace
  PATCH  /api/workspaces/{workspace_id}            — update workspace
  DELETE /api/workspaces/{workspace_id}            — soft-delete workspace
  POST   /api/workspaces/{workspace_id}/restore    — restore soft-deleted
  GET    /api/workspaces/{workspace_id}/members    — list members
  POST   /api/workspaces/{workspace_id}/members    — add member
  PATCH  /api/workspaces/{workspace_id}/members/{user_id} — update member role
  DELETE /api/workspaces/{workspace_id}/members/{user_id} — remove member
  GET    /api/workspaces/{workspace_id}/collaborators     — list outside collaborators
  POST   /api/workspaces/{workspace_id}/collaborators     — add outside collaborator
  DELETE /api/workspaces/{workspace_id}/collaborators/{collaborator_id} — remove

Nested resource routes:
  GET    /api/workspaces/{workspace_id}/projects          — list projects
  POST   /api/workspaces/{workspace_id}/projects          — create project
  GET    /api/workspaces/{workspace_id}/projects/{project_id} — get project
  PATCH  /api/workspaces/{workspace_id}/projects/{project_id} — update project
  DELETE /api/workspaces/{workspace_id}/projects/{project_id} — delete project

  GET    /api/workspaces/{workspace_id}/workflows         — list workflows
  POST   /api/workspaces/{workspace_id}/workflows         — create workflow
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id} — get workflow
  PATCH  /api/workspaces/{workspace_id}/workflows/{workflow_id} — update workflow
  DELETE /api/workspaces/{workspace_id}/workflows/{workflow_id} — delete workflow

  GET    /api/workspaces/{workspace_id}/runs              — list runs
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/runs — list workflow runs
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.models import User, WorkflowCreate, WorkflowUpdate
from app.services import project_service, scoped_workflow_service, workspace_service
from app.services.exceptions import ConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


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


class MemberAddRequest(BaseModel):
    userId: str  # noqa: N815
    role: str = "write"


class MemberRoleUpdateRequest(BaseModel):
    role: str


class CollaboratorAddRequest(BaseModel):
    userId: str  # noqa: N815
    role: str = "read"


class ProjectCreateRequest(BaseModel):
    name: str
    description: str | None = None
    color: str | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None

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


# ============================================================================
# Workflows (nested under workspace)
# ============================================================================

@router.get("/{workspace_id}/workflows", response_model=dict[str, Any])
async def list_workflows(
    workspace_id: str,
    project_id: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List workflows in a workspace, optionally filtered by project."""
    try:
        return await scoped_workflow_service.list_scoped_workflows(
            workspace_id, current_user.userId, project_id=project_id, skip=skip, limit=limit
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{workspace_id}/workflows",
    response_model=dict[str, Any],
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow(
    workspace_id: str,
    body: WorkflowCreate,
    project_id: str | None = Query(None),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Create a workflow in a workspace."""
    try:
        return await scoped_workflow_service.create_scoped_workflow(
            workspace_id, body, current_user.userId, project_id=project_id
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/{workspace_id}/workflows/{workflow_id}",
    response_model=dict[str, Any],
)
async def get_workflow(
    workspace_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Get a workflow scoped to a workspace."""
    try:
        return await scoped_workflow_service.get_scoped_workflow(
            workspace_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch(
    "/{workspace_id}/workflows/{workflow_id}",
    response_model=dict[str, Any],
)
async def update_workflow(
    workspace_id: str,
    workflow_id: str,
    body: WorkflowUpdate,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Update a workflow scoped to a workspace."""
    try:
        return await scoped_workflow_service.update_scoped_workflow(
            workspace_id, workflow_id, body, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete(
    "/{workspace_id}/workflows/{workflow_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_workflow(
    workspace_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
):
    """Delete a workflow scoped to a workspace."""
    try:
        await scoped_workflow_service.delete_scoped_workflow(
            workspace_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ============================================================================
# Runs (scoped to workspace)
# ============================================================================

@router.get("/{workspace_id}/runs", response_model=dict[str, Any])
async def list_workspace_runs(
    workspace_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List runs scoped to a workspace."""
    try:
        return await scoped_workflow_service.list_scoped_runs(
            workspace_id, current_user.userId, skip=skip, limit=limit
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/{workspace_id}/workflows/{workflow_id}/runs",
    response_model=dict[str, Any],
)
async def list_workflow_runs(
    workspace_id: str,
    workflow_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """List runs for a specific workflow in a workspace."""
    try:
        return await scoped_workflow_service.list_scoped_runs(
            workspace_id, current_user.userId, workflow_id=workflow_id, skip=skip, limit=limit
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
