"""
Runs API routes
Trigger and manage workflow runs
Now using Beanie ODM with repository pattern
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Run, RunCreate
from app.database import get_database
from app.repositories import RunRepository, WorkflowRepository

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=Run, status_code=status.HTTP_201_CREATED)
async def create_run(run_request: RunCreate):
    """Trigger a workflow run (SQL injection safe)"""
    # Verify workflow exists using repository
    workflow = await WorkflowRepository.get_by_id(run_request.workflowId)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {run_request.workflowId} not found"
        )
    
    # Merge workflow variables with run-specific variables
    variables = workflow.variables.copy()
    if run_request.variables:
        variables.update(run_request.variables)
    
    # Update run_request with merged variables
    run_request.variables = variables
    
    # Create run using repository
    run = await RunRepository.create(run_request)
    
    return run


@router.get("", response_model=List[Run])
async def list_runs(
    workflow_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
):
    """List workflow runs (SQL injection safe)"""
    if workflow_id:
        # Get runs for specific workflow
        runs, _ = await RunRepository.list_by_workflow(workflow_id, skip, limit)
    else:
        # Get all runs
        runs, _ = await RunRepository.list_all(skip, limit)
    
    # Filter by status if provided (could be moved to repository)
    if status_filter:
        runs = [r for r in runs if r.status == status_filter]
    
    return runs


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str):
    """Get a run by ID (SQL injection safe)"""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    return run


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(run_id: str):
    """Cancel a pending or running run (SQL injection safe)"""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    if run.status not in ["pending", "running"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel run with status {run.status}"
        )
    
    await RunRepository.update_status(run_id, "cancelled")
    
    return None
