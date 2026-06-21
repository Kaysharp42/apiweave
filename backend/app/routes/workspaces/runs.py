"""Run-related endpoints scoped to workspaces and workflows."""

import logging
from typing import Any

from fastapi import Depends, HTTPException, Query, status

from app.auth.dependencies import get_current_active_user
from app.models import User
from app.services import scoped_workflow_service
from app.services.exceptions import ResourceNotFoundError

from ._router import router

logger = logging.getLogger(__name__)


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
