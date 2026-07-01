"""
Runs API routes
Trigger and manage workflow runs
Now using shared service layer.

Scope binding (roadmap §3.4): these flat routes previously used only a GLOBAL
require_permission check, so any session holding the global runs role could
read/cancel ANY tenant's run, and list_runs returned every tenant's runs.
Each route now resolves the run (or target workflow) to its workspace and
evaluates the scoped permission against the caller's membership — 404 for
non-members (existence-hiding), 403 for members lacking the action.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import evaluate_scoped_permission, get_current_active_user
from app.models import Run, RunCreate, User
from app.repositories.run_repository import RunRepository
from app.repositories.workflow_repository import WorkflowRepository
from app.services import (
    cancel_run as svc_cancel_run,
)
from app.services import (
    create_run as svc_create_run,
)
from app.services import (
    get_run as svc_get_run,
)
from app.services import (
    get_run_results as svc_get_run_results,
)
from app.services import (
    list_runs as svc_list_runs,
)
from app.services.exceptions import ConflictError

router = APIRouter(prefix="/api/runs", tags=["runs"])

_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")


async def _authorize_workspace(user: User, workspace_id: str | None, action: str) -> None:
    """404 if the caller can't access the workspace, 403 if they lack the action.

    A run/workflow with no workspaceId predates scoping; treat it as not found
    rather than globally readable.
    """
    if not workspace_id:
        raise _NOT_FOUND
    if not await evaluate_scoped_permission(user, "runs", action, workspace_id=workspace_id):
        # Distinguish "not a member" (404) from "member without permission" (403)
        # would require a second lookup; a 404 here is the safe, existence-hiding
        # default and matches the secret routes.
        raise _NOT_FOUND


async def _load_run_in_scope(run_id: str, user: User, action: str) -> Run:
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise _NOT_FOUND
    await _authorize_workspace(user, getattr(run, "workspaceId", None), action)
    return run


@router.post("", response_model=Run, status_code=status.HTTP_201_CREATED)
async def create_run(
    run_request: RunCreate,
    current_user: User = Depends(get_current_active_user),
):
    """Trigger a workflow run (scoped to the target workflow's workspace)."""
    workflow = await WorkflowRepository.get_by_id(run_request.workflowId)
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    # Triggering a run is a workflows:run capability, evaluated at the workspace.
    if not await evaluate_scoped_permission(
        current_user, "workflows", "run", workspace_id=getattr(workflow, "workspaceId", None)
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    try:
        return await svc_create_run(run_request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("", response_model=list[Run])
async def list_runs(
    workflow_id: str,
    status_filter: str | None = None,
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_active_user),
):
    """List runs for a workflow. workflow_id is required — an unfiltered list
    would expose every tenant's runs."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    await _authorize_workspace(current_user, getattr(workflow, "workspaceId", None), "read")
    return await svc_list_runs(workflow_id, status_filter, skip, limit)


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str, current_user: User = Depends(get_current_active_user)):
    """Get a run by ID."""
    await _load_run_in_scope(run_id, current_user, "read")
    try:
        return await svc_get_run(run_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(run_id: str, current_user: User = Depends(get_current_active_user)):
    """Cancel a pending or running run."""
    await _load_run_in_scope(run_id, current_user, "cancel")
    try:
        await svc_cancel_run(run_id)
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return None


@router.get("/{run_id}/results")
async def get_run_results(run_id: str, current_user: User = Depends(get_current_active_user)):
    """Get human-readable test results for a workflow run."""
    await _load_run_in_scope(run_id, current_user, "read")
    try:
        return await svc_get_run_results(run_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
