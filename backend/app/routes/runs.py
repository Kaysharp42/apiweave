"""
Runs API routes
Trigger and manage workflow runs
Now using Beanie ODM with repository pattern
"""

from fastapi import APIRouter, HTTPException, status

from app.database import get_database
from app.models import Run, RunCreate
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
            detail=f"Workflow {run_request.workflowId} not found",
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


@router.get("", response_model=list[Run])
async def list_runs(
    workflow_id: str | None = None,
    status_filter: str | None = None,
    skip: int = 0,
    limit: int = 100,
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")

    return run


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_run(run_id: str):
    """Cancel a pending or running run (SQL injection safe)"""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")

    if run.status not in ["pending", "running"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel run with status {run.status}",
        )

    await RunRepository.update_status(run_id, "cancelled")

    return None


@router.get("/{run_id}/results")
async def get_run_results(run_id: str):
    """
    Get human-readable test results for a workflow run
    Designed for testers and CI/CD reporting
    """
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")

    # Get workflow details
    workflow = await WorkflowRepository.get_by_id(run.workflowId)
    workflow_name = workflow.name if workflow else "Unknown Workflow"

    # Fetch actual node results from node_results collection
    db = get_database()
    node_results_cursor = db.node_results.find({"runId": run_id})
    node_results_data = await node_results_cursor.to_list(length=None)

    # Calculate summary
    total_nodes = len(node_results_data)
    passed_nodes = sum(1 for r in node_results_data if r.get("status") == "success")
    failed_nodes = sum(1 for r in node_results_data if r.get("status") == "error")
    skipped_nodes = sum(1 for r in node_results_data if r.get("status") == "skipped")

    # Determine overall status
    overall_status = run.status
    if run.status == "completed":
        overall_status = "✅ PASSED" if failed_nodes == 0 else "❌ FAILED"
    elif run.status == "running":
        overall_status = "⏳ RUNNING"
    elif run.status == "pending":
        overall_status = "⏸️ PENDING"
    elif run.status == "failed":
        overall_status = "❌ FAILED"
    elif run.status == "cancelled":
        overall_status = "🚫 CANCELLED"

    # Format node results
    formatted_results = []
    for result in node_results_data:
        status_map = {"success": "passed", "error": "failed", "skipped": "skipped"}
        node_status = status_map.get(result.get("status", ""), "unknown")

        node_result = {
            "nodeId": result.get("nodeId"),
            "nodeType": result.get("nodeType"),
            "status": node_status.upper(),
            "statusIcon": {"passed": "✅", "failed": "❌", "skipped": "⏭️"}.get(node_status, "❓"),
            "duration": f"{result.get('duration', 0)}ms",
            "durationSeconds": round(result.get("duration", 0) / 1000, 2),
            "error": result.get("error"),
            "request": result.get("request"),
            "response": result.get("response"),
            "assertions": result.get("assertions", []),
        }
        formatted_results.append(node_result)

    # Build human-readable response
    return {
        "runId": run.runId,
        "workflowId": run.workflowId,
        "workflowName": workflow_name,
        "status": overall_status,
        "trigger": run.trigger,
        "summary": {
            "totalNodes": total_nodes,
            "passed": passed_nodes,
            "failed": failed_nodes,
            "skipped": skipped_nodes,
            "successRate": f"{round((passed_nodes / total_nodes * 100) if total_nodes > 0 else 0, 1)}%",
        },
        "timing": {
            "createdAt": run.createdAt.isoformat() if run.createdAt else None,
            "startedAt": run.startedAt.isoformat() if run.startedAt else None,
            "completedAt": run.completedAt.isoformat() if run.completedAt else None,
            "duration": f"{run.duration}ms" if run.duration else None,
            "durationSeconds": round(run.duration / 1000, 2) if run.duration else None,
        },
        "environment": {"environmentId": run.environmentId} if run.environmentId else None,
        "variables": run.variables or {},
        "error": run.error,
        "failedNodes": run.failedNodes or [],
        "failureMessage": run.failureMessage,
        "nodeResults": formatted_results,
        "callbackUrl": run.callbackUrl,
    }
