"""Workflow CRUD, export, and templates endpoints nested under workspaces."""

import logging
from typing import Any

from fastapi import Depends, HTTPException, Query, status

from app.auth.dependencies import get_current_active_user
from app.config import settings
from app.models import User, WorkflowCreate, WorkflowUpdate
from app.services import scoped_workflow_service
from app.services.exceptions import ResourceNotFoundError

from ._router import router

logger = logging.getLogger(__name__)


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
            detail=f"Export failed: {e!s}",
        )


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
