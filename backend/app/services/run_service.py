"""
Run service — shared business logic for run creation, status, results, and node results.
Called by both FastAPI routes and MCP tools.
"""
import json
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.database import get_database
from app.models import Run, RunCreate
from app.repositories import RunRepository, WorkflowRepository


async def create_run(run_request: RunCreate) -> Run:
    """Create a run, merging workflow variables."""
    workflow = await WorkflowRepository.get_by_id(run_request.workflowId)
    if not workflow:
        raise ValueError(f"Workflow {run_request.workflowId} not found")

    variables = workflow.variables.copy()
    if run_request.variables:
        variables.update(run_request.variables)
    run_request.variables = variables

    return await RunRepository.create(run_request)


async def list_runs(
    workflow_id: str | None = None,
    status_filter: str | None = None,
    skip: int = 0,
    limit: int = 100,
) -> list[Run]:
    """List runs with optional filters."""
    if workflow_id:
        runs, _ = await RunRepository.list_by_workflow(workflow_id, skip, limit)
    else:
        runs, _ = await RunRepository.list_all(skip, limit)

    if status_filter:
        runs = [r for r in runs if r.status == status_filter]
    return runs


async def get_run(run_id: str) -> Run:
    """Get a run by ID. Raises ValueError if not found."""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    return run


async def cancel_run(run_id: str) -> None:
    """Cancel a pending or running run. Raises ValueError if invalid."""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    if run.status not in ("pending", "running"):
        raise ValueError(f"Cannot cancel run with status {run.status}")
    await RunRepository.update_status(run_id, "cancelled")


async def get_run_with_node_results(run_id: str, workflow_id: str) -> dict[str, Any]:
    """Get run status with full node results from GridFS-backed storage."""
    run_doc = await RunRepository.get_by_id(run_id)
    if not run_doc or run_doc.workflowId != workflow_id:
        raise ValueError(f"Run {run_id} not found")

    run = run_doc.model_dump(by_alias=True)
    run.pop("_id", None)

    if run.get("nodeStatuses"):
        db = get_database()
        gridfs_bucket = AsyncIOMotorGridFSBucket(db)

        for node_id in run["nodeStatuses"].keys():
            full_result = await db.node_results.find_one(
                {"runId": run_id, "nodeId": node_id},
                {"_id": 0},
            )
            if full_result:
                result = full_result.get("result", {})
                if isinstance(result, dict) and result.get("stored_in_gridfs"):
                    gridfs_file_id = result.get("gridfs_file_id")
                    if gridfs_file_id:
                        try:
                            grid_out = await gridfs_bucket.open_download_stream(
                                ObjectId(gridfs_file_id)
                            )
                            file_data = await grid_out.read()
                            actual_result = json.loads(file_data.decode("utf-8"))
                            run["nodeStatuses"][node_id] = {
                                "status": full_result.get("status"),
                                "result": actual_result,
                                "timestamp": full_result.get("timestamp"),
                                "metadata": {
                                    "stored_in_gridfs": True,
                                    "size_mb": result.get("size_mb"),
                                },
                            }
                        except Exception as e:
                            run["nodeStatuses"][node_id] = {
                                "status": full_result.get("status"),
                                "result": {
                                    "error": f"Failed to retrieve large result: {str(e)}"
                                },
                                "timestamp": full_result.get("timestamp"),
                            }
                else:
                    run["nodeStatuses"][node_id] = {
                        "status": full_result.get("status"),
                        "result": result,
                        "timestamp": full_result.get("timestamp"),
                    }

    return run


async def get_node_result(
    run_id: str, workflow_id: str, node_id: str
) -> dict[str, Any]:
    """Get the full result for a specific node, including GridFS-backed results."""
    run = await RunRepository.get_by_id(run_id)
    if not run or run.workflowId != workflow_id:
        raise ValueError(f"Run {run_id} not found")

    db = get_database()
    node_result = await db.node_results.find_one(
        {"runId": run_id, "nodeId": node_id},
        {"_id": 0},
    )
    if not node_result:
        raise ValueError(f"Result for node {node_id} not found")

    result = node_result.get("result", {})
    if result.get("stored_in_gridfs"):
        gridfs_file_id = result.get("gridfs_file_id")
        if not gridfs_file_id:
            raise ValueError("GridFS file ID missing")

        try:
            gridfs_bucket = AsyncIOMotorGridFSBucket(db)
            grid_out = await gridfs_bucket.open_download_stream(
                ObjectId(gridfs_file_id)
            )
            file_data = await grid_out.read()
            full_result = json.loads(file_data.decode("utf-8"))

            return {
                "nodeId": node_id,
                "runId": run_id,
                "status": node_result.get("status"),
                "timestamp": node_result.get("timestamp"),
                "result": full_result,
                "metadata": {
                    "stored_in_gridfs": True,
                    "size_mb": result.get("size_mb"),
                    "gridfs_file_id": gridfs_file_id,
                },
            }
        except Exception as e:
            raise ValueError(f"Failed to retrieve result from GridFS: {str(e)}")

    return {
        "nodeId": node_id,
        "runId": run_id,
        "status": node_result.get("status"),
        "timestamp": node_result.get("timestamp"),
        "result": result,
        "metadata": {"stored_in_gridfs": False},
    }


async def get_run_results(run_id: str) -> dict[str, Any]:
    """Get human-readable test results for a workflow run."""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")

    workflow = await WorkflowRepository.get_by_id(run.workflowId)
    workflow_name = workflow.name if workflow else "Unknown Workflow"

    db = get_database()
    node_results_cursor = db.node_results.find({"runId": run_id})
    node_results_data = await node_results_cursor.to_list(length=None)

    total_nodes = len(node_results_data)
    passed_nodes = sum(1 for r in node_results_data if r.get("status") == "success")
    failed_nodes = sum(1 for r in node_results_data if r.get("status") == "error")
    skipped_nodes = sum(1 for r in node_results_data if r.get("status") == "skipped")

    status_display = {
        "completed": "PASSED" if failed_nodes == 0 else "FAILED",
        "running": "RUNNING",
        "pending": "PENDING",
        "failed": "FAILED",
        "cancelled": "CANCELLED",
    }
    overall_status = status_display.get(run.status, run.status)

    formatted_results = []
    status_map = {"success": "passed", "error": "failed", "skipped": "skipped"}
    for result in node_results_data:
        node_status = status_map.get(result.get("status", ""), "unknown")
        formatted_results.append(
            {
                "nodeId": result.get("nodeId"),
                "nodeType": result.get("nodeType"),
                "status": node_status.upper(),
                "duration": f"{result.get('duration', 0)}ms",
                "durationSeconds": round(result.get("duration", 0) / 1000, 2),
                "error": result.get("error"),
                "request": result.get("request"),
                "response": result.get("response"),
                "assertions": result.get("assertions", []),
            }
        )

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
            "successRate": f"{(passed_nodes / total_nodes * 100) if total_nodes > 0 else 0:.1f}%",
        },
        "timing": {
            "createdAt": run.createdAt.isoformat() if run.createdAt else None,
            "startedAt": run.startedAt.isoformat() if run.startedAt else None,
            "completedAt": run.completedAt.isoformat() if run.completedAt else None,
            "duration": f"{run.duration}ms" if run.duration else None,
            "durationSeconds": round(run.duration / 1000, 2) if run.duration else None,
        },
        "environment": {"environmentId": run.environmentId}
        if run.environmentId
        else None,
        "variables": run.variables or {},
        "error": run.error,
        "failedNodes": run.failedNodes or [],
        "failureMessage": run.failureMessage,
        "nodeResults": formatted_results,
        "callbackUrl": run.callbackUrl,
    }


def _node_id(node: Any) -> str | None:
    if isinstance(node, dict):
        return node.get("nodeId")
    return getattr(node, "nodeId", None)


def _node_label(node: Any, fallback: str) -> str:
    if isinstance(node, dict):
        return node.get("label", fallback)
    return getattr(node, "label", fallback)


def _node_type(node: Any) -> str | None:
    if isinstance(node, dict):
        return node.get("type")
    return getattr(node, "type", None)


def _derive_failed_node_ids(run: Any) -> list[str]:
    """Resolve failed node IDs from failedNodes, or fallback to nodeStatuses error states."""
    explicit_failed = list(getattr(run, "failedNodes", None) or [])
    explicit_failed = [
        nid for nid in explicit_failed if isinstance(nid, str) and nid
    ]
    if explicit_failed:
        return explicit_failed

    node_statuses = getattr(run, "nodeStatuses", None) or {}
    if not isinstance(node_statuses, dict):
        return []

    error_like = {"error", "failed", "client_error", "server_error"}
    ordered = sorted(
        node_statuses.items(),
        key=lambda item: (item[1] or {}).get("timestamp") or "",
    )
    return [
        nid
        for nid, status_meta in ordered
        if isinstance(nid, str) and ((status_meta or {}).get("status") in error_like)
    ]


async def get_latest_failed_run(workflow_id: str) -> dict[str, Any]:
    """Get latest failed run and failed node metadata for resume actions."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")

    latest_run = await RunRepository.get_latest_run(workflow_id)
    if not latest_run or latest_run.status != "failed":
        return {
            "hasFailedRun": False,
            "workflowId": workflow_id,
            "runId": None,
            "failedNodes": [],
        }

    failed_node_ids = _derive_failed_node_ids(latest_run)
    node_map = {_node_id(node): node for node in workflow.nodes}
    node_map.pop(None, None)

    failed_nodes = []
    for nid in failed_node_ids:
        node = node_map.get(nid, {})
        node_status = latest_run.nodeStatuses.get(nid, {}) if latest_run.nodeStatuses else {}
        failed_nodes.append(
            {
                "nodeId": nid,
                "label": _node_label(node, nid),
                "type": _node_type(node),
                "status": node_status.get("status"),
                "timestamp": node_status.get("timestamp"),
            }
        )

    return {
        "hasFailedRun": True,
        "workflowId": workflow_id,
        "runId": latest_run.runId,
        "failedNodes": failed_nodes,
        "failedNodeIds": failed_node_ids,
        "failedCount": len(failed_nodes),
        "createdAt": latest_run.createdAt,
    }
