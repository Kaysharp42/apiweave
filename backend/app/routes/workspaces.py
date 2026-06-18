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
  POST   /api/workspaces/{workspace_id}/workflows/{workflow_id}/run — trigger run
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/runs — list workflow runs
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/runs/latest-failed
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/runs/{run_id}
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/result
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/export
  GET    /api/workspaces/{workspace_id}/workflows/{workflow_id}/templates
  POST   /api/workspaces/{workspace_id}/workflows/{workflow_id}/templates
  PUT    /api/workspaces/{workspace_id}/workflows/{workflow_id}/templates
  DELETE /api/workspaces/{workspace_id}/workflows/{workflow_id}/templates
  POST   /api/workspaces/{workspace_id}/workflows/import
  POST   /api/workspaces/{workspace_id}/workflows/import/dry-run
  POST   /api/workspaces/{workspace_id}/workflows/import/har
  POST   /api/workspaces/{workspace_id}/workflows/import/har/dry-run
  POST   /api/workspaces/{workspace_id}/workflows/import/openapi
  GET    /api/workspaces/{workspace_id}/workflows/import/openapi/url
  POST   /api/workspaces/{workspace_id}/workflows/import/openapi/dry-run
  POST   /api/workspaces/{workspace_id}/workflows/import/curl
  POST   /api/workspaces/{workspace_id}/workflows/import/curl/dry-run

  GET    /api/workspaces/{workspace_id}/runs              — list runs
"""
import json
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.config import settings
from app.models import User, WorkflowCreate, WorkflowUpdate
from app.services import project_service, scoped_workflow_service, workspace_service
from app.services.exceptions import ConflictError, ResourceNotFoundError
from app.services.safe_http import SafeUrlError, validate_url
from app.utils.openapi_import_limits import DEFAULT_FETCH_TIMEOUT_SECONDS, DEFAULT_FETCH_CONCURRENCY

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


# ============================================================================
# Run Trigger (scoped)
# ============================================================================

@router.post(
    "/{workspace_id}/workflows/{workflow_id}/run",
    response_model=dict[str, Any],
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_workflow_run(
    workspace_id: str,
    workflow_id: str,
    environmentId: str | None = Query(None),
    body: dict[str, Any] | None = None,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    resume_payload = (body or {}).get("resume", {}) if body else {}
    try:
        return await scoped_workflow_service.trigger_scoped_run(
            workspace_id,
            workflow_id,
            current_user.userId,
            environment_id=environmentId,
            resume=resume_payload,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        message = str(e)
        if "not found" in message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        if message.startswith("No failed"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


# ============================================================================
# Run Status / Latest Failed / Node Result (scoped)
# ============================================================================

@router.get(
    "/{workspace_id}/workflows/{workflow_id}/runs/latest-failed",
    response_model=dict[str, Any],
)
async def get_latest_failed_run(
    workspace_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.get_scoped_latest_failed_run(
            workspace_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/{workspace_id}/workflows/{workflow_id}/runs/{run_id}",
    response_model=dict[str, Any],
)
async def get_run_status(
    workspace_id: str,
    workflow_id: str,
    run_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.get_scoped_run_status(
            workspace_id, workflow_id, run_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/{workspace_id}/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/result",
    response_model=dict[str, Any],
)
async def get_node_result(
    workspace_id: str,
    workflow_id: str,
    run_id: str,
    node_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.get_scoped_node_result(
            workspace_id, workflow_id, run_id, node_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=msg)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=msg)


# ============================================================================
# Export (scoped)
# ============================================================================

@router.get(
    "/{workspace_id}/workflows/{workflow_id}/export",
    response_model=dict[str, Any],
)
async def export_workflow(
    workspace_id: str,
    workflow_id: str,
    include_environment: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.export_scoped_workflow(
            workspace_id,
            workflow_id,
            current_user.userId,
            include_environment=include_environment,
            app_version=settings.VERSION,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.exception("Scoped export error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {str(e)}",
        )


# ============================================================================
# Import (scoped)
# ============================================================================

@router.post(
    "/{workspace_id}/workflows/import",
    response_model=dict[str, Any],
)
async def import_workflow(
    workspace_id: str,
    bundle: dict[str, Any],
    environment_mapping: dict[str, str] | None = None,
    create_missing_environments: bool = True,
    sanitize: bool = False,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.import_scoped_workflow(
            workspace_id,
            bundle,
            current_user.userId,
            environment_mapping=environment_mapping,
            create_missing_environments=create_missing_environments,
            sanitize=sanitize,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/{workspace_id}/workflows/import/dry-run",
    response_model=dict[str, Any],
)
async def import_workflow_dry_run(
    workspace_id: str,
    bundle: dict[str, Any],
) -> dict[str, Any]:
    return await scoped_workflow_service.import_scoped_workflow_dry_run(bundle)


@router.post(
    "/{workspace_id}/workflows/import/har",
    response_model=dict[str, Any],
)
async def import_har(
    workspace_id: str,
    file: UploadFile | None = File(None),
    import_mode: str = Query("linear"),
    environment_id: str | None = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="HAR file is required")
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON in HAR file: {str(e)}")
        if "log" not in har_data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid HAR file: missing 'log' key")
        return await scoped_workflow_service.import_scoped_har(
            workspace_id, har_data, current_user.userId,
            import_mode=import_mode, sanitize=sanitize, parse_only=parse_only,
            environment_id=environment_id,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("HAR import error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to import HAR file: {str(e)}")


@router.post(
    "/{workspace_id}/workflows/import/har/dry-run",
    response_model=dict[str, Any],
)
async def import_har_dry_run(
    workspace_id: str,
    file: UploadFile | None = File(None),
    import_mode: str = Query("linear"),
    sanitize: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="HAR file is required")
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON in HAR file: {str(e)}")
        if "log" not in har_data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid HAR file: missing 'log' key")
        return await scoped_workflow_service.import_scoped_har_dry_run(
            workspace_id, har_data, current_user.userId,
            import_mode=import_mode, sanitize=sanitize,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("HAR dry-run error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to preview HAR file: {str(e)}")


@router.post(
    "/{workspace_id}/workflows/import/openapi",
    response_model=dict[str, Any],
)
async def import_openapi(
    workspace_id: str,
    file: UploadFile | None = File(None),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OpenAPI file is required")
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON in OpenAPI file: {str(e)}")
        if "paths" not in openapi_data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OpenAPI file: missing 'paths' key")
        return await scoped_workflow_service.import_scoped_openapi(
            workspace_id, openapi_data, current_user.userId,
            base_url=base_url, tag_filter=tag_filter, sanitize=sanitize, parse_only=parse_only,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("OpenAPI import error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to import OpenAPI file: {str(e)}")


@router.get(
    "/{workspace_id}/workflows/import/openapi/url",
    response_model=dict[str, Any],
)
async def import_openapi_from_url(
    workspace_id: str,
    swagger_url: str = Query(...),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    url = (swagger_url or "").strip()
    if not url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="swagger_url is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="swagger_url must start with http:// or https://")
    try:
        validate_url(url)
    except SafeUrlError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"URL blocked by safety policy: {exc}")

    try:
        ws = await _get_verified_workspace(workspace_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    from app.utils.swagger_discovery import (
        parse_swagger_ui_query_hints,
        extract_swagger_ui_hints_from_html,
        resolve_url,
        build_swagger_config_candidates,
        extract_definitions_from_swagger_config,
        make_definition_scope,
    )
    from app.utils.openapi_import_limits import (
        validate_definition_limit,
        validate_endpoint_limit,
    )
    from app.services.import_service import parse_openapi_to_workflow
    import asyncio

    try:
        tags = tag_filter.split(",") if tag_filter else None

        async with httpx.AsyncClient(timeout=DEFAULT_FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            initial_response = await client.get(
                url,
                headers={"Accept": "application/json, application/vnd.oai.openapi+json, text/html"},
            )
            initial_response.raise_for_status()

            direct_spec = _extract_openapi_document(initial_response)
            discovered_definitions: list[dict[str, str]] = []
            primary_name: str | None = None

            if direct_spec:
                discovered_definitions = [{
                    "name": direct_spec.get("info", {}).get("title") or "Default",
                    "specUrl": url,
                    "source": "direct-url",
                }]
            else:
                query_hints = parse_swagger_ui_query_hints(url)
                html_hints = extract_swagger_ui_hints_from_html(initial_response.text)
                if query_hints.get("url"):
                    discovered_definitions.append({
                        "name": query_hints.get("primaryName") or "Default",
                        "specUrl": resolve_url(url, query_hints["url"]),
                        "source": "swagger-ui.query.url",
                    })
                for entry in html_hints.get("urls") or []:
                    discovered_definitions.append({
                        "name": (entry.get("name") or "").strip() or (entry.get("url") or "").strip(),
                        "specUrl": resolve_url(url, entry.get("url") or ""),
                        "source": "swagger-ui.html.urls",
                    })
                if html_hints.get("url"):
                    discovered_definitions.append({
                        "name": query_hints.get("primaryName") or "Default",
                        "specUrl": resolve_url(url, html_hints["url"]),
                        "source": "swagger-ui.html.url",
                    })
                primary_name = query_hints.get("primaryName")
                config_candidates = build_swagger_config_candidates(url, query_hints, html_hints)
                for candidate in config_candidates:
                    try:
                        validate_url(candidate)
                    except SafeUrlError:
                        continue
                    try:
                        resp = await client.get(candidate, headers={"Accept": "application/json, application/vnd.oai.openapi+json"})
                        resp.raise_for_status()
                        config_data = resp.json()
                        if not isinstance(config_data, dict):
                            continue
                        extracted = extract_definitions_from_swagger_config(config_data, str(resp.url))
                        if extracted.get("primaryName") and not primary_name:
                            primary_name = extracted["primaryName"]
                        discovered_definitions.extend(extracted.get("definitions") or [])
                        if extracted.get("definitions"):
                            break
                    except Exception:
                        continue

                if not discovered_definitions:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Could not discover OpenAPI definitions from Swagger UI URL.",
                    )

        limit_err = validate_definition_limit(len(discovered_definitions))
        if limit_err:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=limit_err)

        successful_specs: list[dict[str, Any]] = []
        failed_definitions: list[dict[str, str]] = []

        async def fetch_def(definition: dict[str, str]) -> dict[str, Any]:
            spec_url = (definition.get("specUrl") or "").strip()
            if not spec_url:
                return {"status": "failed", "name": definition.get("name", "Definition"), "specUrl": spec_url, "error": "Missing spec URL"}
            try:
                validate_url(spec_url)
            except SafeUrlError as exc:
                return {"status": "failed", "name": definition.get("name", "Definition"), "specUrl": spec_url, "error": f"URL blocked: {exc}"}
            try:
                resp = await client.get(spec_url, headers={"Accept": "application/json, application/vnd.oai.openapi+json"})
                resp.raise_for_status()
                odata = _extract_openapi_document(resp)
                if not odata:
                    raise ValueError("Invalid OpenAPI document")
                return {"status": "imported", "definition": definition, "openapi_data": odata}
            except Exception as exc:
                return {"status": "failed", "name": definition.get("name", "Definition"), "specUrl": spec_url, "error": str(exc)}

        semaphore = asyncio.Semaphore(DEFAULT_FETCH_CONCURRENCY)

        async def fetch_limited(d: dict[str, str]) -> dict[str, Any]:
            async with semaphore:
                return await fetch_def(d)

        results = await asyncio.gather(*(fetch_limited(d) for d in discovered_definitions))
        for r in results:
            if r.get("status") == "imported":
                successful_specs.append({"definition": r["definition"], "openapi_data": r["openapi_data"]})
            else:
                failed_definitions.append({"name": r["name"], "specUrl": r["specUrl"], "error": r["error"]})

        if not successful_specs:
            first_err = failed_definitions[0]["error"] if failed_definitions else "Unknown"
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to fetch any OpenAPI definitions: {first_err}")

        is_multi = len(discovered_definitions) > 1
        all_http_nodes: list[dict[str, Any]] = []
        definition_summaries: list[dict[str, Any]] = []

        for bundle in successful_specs:
            defn = bundle["definition"]
            defn_name = defn.get("name") or "Definition"
            defn_url = defn.get("specUrl") or ""
            defn_scope = make_definition_scope(defn_name, defn_url)
            wd = parse_openapi_to_workflow(
                bundle["openapi_data"], base_url, tags, sanitize,
                source_context={"definitionName": defn_name, "definitionSpecUrl": defn_url, "definitionScope": defn_scope, "sourceUiUrl": url},
            )
            http_nodes = [n for n in wd["nodes"] if n["type"] == "http-request"]
            if is_multi:
                for node in http_nodes:
                    label = node.get("label") or node.get("config", {}).get("url") or "Request"
                    node["label"] = f"[{defn_name}] {label}"
            all_http_nodes.extend(http_nodes)
            ep_err = validate_endpoint_limit(len(all_http_nodes))
            if ep_err:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=ep_err)
            definition_summaries.append({
                "name": defn_name, "specUrl": defn_url, "status": "imported",
                "endpointCount": len(http_nodes), "source": defn.get("source") or "discovered",
            })

        for failed in failed_definitions:
            definition_summaries.append({
                "name": failed["name"], "specUrl": failed["specUrl"], "status": "failed",
                "endpointCount": 0, "error": failed["error"],
            })

        api_title = "Multiple APIs" if len(successful_specs) > 1 else (
            successful_specs[0]["openapi_data"].get("info", {}).get("title", "API")
        )

        return {
            "nodes": all_http_nodes,
            "definitions": definition_summaries,
            "stats": {
                "totalEndpoints": len(all_http_nodes),
                "apiTitle": api_title,
                "sourceUrl": url,
                "definitionCount": len(discovered_definitions),
                "importedDefinitionCount": len(successful_specs),
                "failedDefinitionCount": len(failed_definitions),
                "primaryName": primary_name,
            },
            "warnings": [
                {"type": "definition-fetch-failed", "name": i["name"], "specUrl": i["specUrl"], "message": i["error"]}
                for i in failed_definitions
            ],
        }
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to fetch Swagger URL ({e.response.status_code})")
    except httpx.RequestError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to fetch Swagger URL: {str(e)}")
    except Exception as e:
        logger.exception("OpenAPI URL import error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to import OpenAPI from URL: {str(e)}")


@router.post(
    "/{workspace_id}/workflows/import/openapi/dry-run",
    response_model=dict[str, Any],
)
async def import_openapi_dry_run(
    workspace_id: str,
    file: UploadFile | None = File(None),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OpenAPI file is required")
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON in OpenAPI file: {str(e)}")
        if "paths" not in openapi_data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OpenAPI file: missing 'paths' key")
        return await scoped_workflow_service.import_scoped_openapi_dry_run(
            workspace_id, openapi_data, current_user.userId,
            base_url=base_url, tag_filter=tag_filter, sanitize=sanitize,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("OpenAPI dry-run error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to preview OpenAPI file: {str(e)}")


@router.post(
    "/{workspace_id}/workflows/import/curl",
    response_model=dict[str, Any],
)
async def import_curl(
    workspace_id: str,
    sanitize: bool = Query(True),
    curl_command: str | None = Query(None),
    workflowId: str | None = Query(None),
    parse_only: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not curl_command:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="curl command is required")
        return await scoped_workflow_service.import_scoped_curl(
            workspace_id, curl_command, current_user.userId,
            sanitize=sanitize, workflow_id=workflowId, parse_only=parse_only,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Curl import error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to import curl command: {str(e)}")


@router.post(
    "/{workspace_id}/workflows/import/curl/dry-run",
    response_model=dict[str, Any],
)
async def import_curl_dry_run(
    workspace_id: str,
    sanitize: bool = Query(True),
    curl_command: str | None = Query(None),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not curl_command:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="curl command is required")
        return await scoped_workflow_service.import_scoped_curl_dry_run(
            workspace_id, curl_command, current_user.userId, sanitize=sanitize,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Curl dry-run error")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to preview curl command: {str(e)}")


# ============================================================================
# Templates (scoped)
# ============================================================================

@router.get(
    "/{workspace_id}/workflows/{workflow_id}/templates",
    response_model=dict[str, Any],
)
async def get_workflow_templates(
    workspace_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.get_scoped_templates(
            workspace_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/{workspace_id}/workflows/{workflow_id}/templates",
    response_model=dict[str, Any],
)
async def add_workflow_templates(
    workspace_id: str,
    workflow_id: str,
    templates: list[dict[str, Any]],
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.add_scoped_templates(
            workspace_id, workflow_id, current_user.userId, templates
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.put(
    "/{workspace_id}/workflows/{workflow_id}/templates",
    response_model=dict[str, Any],
)
async def replace_workflow_templates(
    workspace_id: str,
    workflow_id: str,
    templates: list[dict[str, Any]],
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.replace_scoped_templates(
            workspace_id, workflow_id, current_user.userId, templates
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete(
    "/{workspace_id}/workflows/{workflow_id}/templates",
    status_code=status.HTTP_200_OK,
)
async def clear_workflow_templates(
    workspace_id: str,
    workflow_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.clear_scoped_templates(
            workspace_id, workflow_id, current_user.userId
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ============================================================================
# Helpers
# ============================================================================

async def _get_verified_workspace(workspace_id: str, actor_user_id: str):
    from app.repositories.workspace_repository import WorkspaceRepository
    from app.services.workspace_service import _assert_workspace_access
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)
    return ws


def _extract_openapi_document(response: httpx.Response) -> dict[str, Any] | None:
    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError):
        data = None
    if isinstance(data, dict) and "paths" in data:
        return data
    content_type = (response.headers.get("content-type") or "").lower()
    body_text = response.text or ""
    should_try_yaml = (
        "yaml" in content_type
        or body_text.lstrip().startswith("openapi:")
        or body_text.lstrip().startswith("swagger:")
    )
    if not should_try_yaml:
        return None
    try:
        import yaml
    except Exception:
        return None
    try:
        yaml_data = yaml.safe_load(body_text)
    except Exception:
        return None
    if isinstance(yaml_data, dict) and "paths" in yaml_data:
        return yaml_data
    return None
