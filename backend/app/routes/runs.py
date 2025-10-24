"""
Runs API routes
Trigger and manage workflow runs
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Run, RunCreate
from app.database import get_database

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=Run, status_code=status.HTTP_201_CREATED)
async def create_run(run_request: RunCreate):
    """Trigger a workflow run"""
    db = get_database()
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": run_request.workflowId})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {run_request.workflowId} not found"
        )
    
    run_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    # Merge workflow variables with run-specific variables
    variables = workflow.get("variables", {}).copy()
    if run_request.variables:
        variables.update(run_request.variables)
    
    run_doc = {
        "runId": run_id,
        "workflowId": run_request.workflowId,
        "status": "pending",
        "trigger": "manual",  # TODO: detect webhook vs manual
        "variables": variables,
        "callbackUrl": run_request.callbackUrl,
        "results": [],
        "createdAt": now,
        "startedAt": None,
        "completedAt": None,
        "duration": None,
        "error": None
    }
    
    await db.runs.insert_one(run_doc)
    
    return Run(**run_doc)


@router.get("", response_model=List[Run])
async def list_runs(
    workflow_id: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
):
    """List workflow runs"""
    db = get_database()
    
    query = {}
    if workflow_id:
        query["workflowId"] = workflow_id
    if status_filter:
        query["status"] = status_filter
    
    cursor = db.runs.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    runs = await cursor.to_list(length=limit)
    
    return [Run(**run) for run in runs]


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str):
    """Get a run by ID"""
    db = get_database()
    
    run = await db.runs.find_one({"runId": run_id})
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    return Run(**run)


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(run_id: str):
    """Cancel a pending or running run"""
    db = get_database()
    
    run = await db.runs.find_one({"runId": run_id})
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    if run["status"] not in ["pending", "running"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel run with status {run['status']}"
        )
    
    await db.runs.update_one(
        {"runId": run_id},
        {"$set": {"status": "cancelled", "completedAt": datetime.now(UTC)}}
    )
    
    return None
