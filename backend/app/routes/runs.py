"""
Runs API routes
Trigger and manage workflow runs
Now using shared service layer
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Run, RunCreate
from app.repositories import RunRepository, WorkflowRepository
from app.services import (
    create_run as svc_create_run,
    list_runs as svc_list_runs,
    get_run as svc_get_run,
    cancel_run as svc_cancel_run,
    get_run_with_node_results as svc_get_run_with_node_results,
    get_node_result as svc_get_node_result,
    get_run_results as svc_get_run_results,
    get_latest_failed_run as svc_get_latest_failed_run,
)

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=Run, status_code=status.HTTP_201_CREATED)
async def create_run(run_request: RunCreate):
    """Trigger a workflow run"""
    try:
        return await svc_create_run(run_request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("", response_model=List[Run])
async def list_runs(
    workflow_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    """List workflow runs"""
    return await svc_list_runs(workflow_id, status_filter, skip, limit)


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str):
    """Get a run by ID"""
    try:
        return await svc_get_run(run_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(run_id: str):
    """Cancel a pending or running run"""
    try:
        await svc_cancel_run(run_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return None


@router.get("/{run_id}/results")
async def get_run_results(run_id: str):
    """Get human-readable test results for a workflow run"""
    try:
        return await svc_get_run_results(run_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
