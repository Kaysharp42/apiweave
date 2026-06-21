"""
Run service (queries) — run retrieval, status, results, and node result inspection.
"""

import json
import logging
from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.database import get_database
from app.models import Run
from app.repositories import RunRepository, WorkflowRepository
from app.repositories.environment_repository import EnvironmentRepository
from app.services.secret_utils import SecretMasker

logger = logging.getLogger(__name__)


async def _build_masker_for_run(run_doc: Any) -> SecretMasker:
    """Build a SecretMasker from the run's environment secrets (defense in depth)."""
    env_id = getattr(run_doc, "environmentId", None) or (
        run_doc.get("environmentId") if isinstance(run_doc, dict) else None
    )
    if not env_id:
        return SecretMasker()
    try:
        env_secrets = await EnvironmentRepository.get_decrypted_secrets(env_id)
        return SecretMasker(env_secrets)
    except Exception:
        logger.debug(
            "Could not resolve env secrets for masking on run %s",
            getattr(run_doc, "runId", "?"),
        )
        return SecretMasker()


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


async def get_run_with_node_results(run_id: str, workflow_id: str) -> dict[str, Any]:
    """Get run status with full node results from GridFS-backed storage."""
    run_doc = await RunRepository.get_by_id(run_id)
    if not run_doc or run_doc.workflowId != workflow_id:
        raise ValueError(f"Run {run_id} not found")

    masker = await _build_masker_for_run(run_doc)
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
                                "result": (
                                    masker.mask_struct(actual_result)
                                    if masker.has_secrets
                                    else actual_result
                                ),
                                "timestamp": full_result.get("timestamp"),
                                "metadata": {
                                    "stored_in_gridfs": True,
                                    "size_mb": result.get("size_mb"),
                                },
                            }
                        except Exception as e:
                            run["nodeStatuses"][node_id] = {
                                "status": full_result.get("status"),
                                "result": {"error": f"Failed to retrieve large result: {e!s}"},
                                "timestamp": full_result.get("timestamp"),
                            }
                else:
                    run["nodeStatuses"][node_id] = {
                        "status": full_result.get("status"),
                        "result": masker.mask_struct(result) if masker.has_secrets else result,
                        "timestamp": full_result.get("timestamp"),
                    }

    return run


async def get_node_result(run_id: str, workflow_id: str, node_id: str) -> dict[str, Any]:
    """Get the full result for a specific node, including GridFS-backed results."""
    run = await RunRepository.get_by_id(run_id)
    if not run or run.workflowId != workflow_id:
        raise ValueError(f"Run {run_id} not found")

    masker = await _build_masker_for_run(run)
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
            grid_out = await gridfs_bucket.open_download_stream(ObjectId(gridfs_file_id))
            file_data = await grid_out.read()
            full_result = json.loads(file_data.decode("utf-8"))

            return {
                "nodeId": node_id,
                "runId": run_id,
                "status": node_result.get("status"),
                "timestamp": node_result.get("timestamp"),
                "result": masker.mask_struct(full_result) if masker.has_secrets else full_result,
                "metadata": {
                    "stored_in_gridfs": True,
                    "size_mb": result.get("size_mb"),
                    "gridfs_file_id": gridfs_file_id,
                },
            }
        except Exception as e:
            raise ValueError(f"Failed to retrieve result from GridFS: {e!s}")

    return {
        "nodeId": node_id,
        "runId": run_id,
        "status": node_result.get("status"),
        "timestamp": node_result.get("timestamp"),
        "result": masker.mask_struct(result) if masker.has_secrets else result,
        "metadata": {"stored_in_gridfs": False},
    }


async def get_run_results(run_id: str) -> dict[str, Any]:
    """Get human-readable test results for a workflow run."""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")

    masker = await _build_masker_for_run(run)
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
        raw_response = result.get("response")
        raw_request = result.get("request")
        err = result.get("error")
        formatted_results.append(
            {
                "nodeId": result.get("nodeId"),
                "nodeType": result.get("nodeType"),
                "status": node_status.upper(),
                "duration": f"{result.get('duration', 0)}ms",
                "durationSeconds": round(result.get("duration", 0) / 1000, 2),
                "error": (masker.mask_text(err) if masker.has_secrets and err else err),
                "request": (
                    masker.mask_struct(raw_request)
                    if masker.has_secrets and raw_request
                    else raw_request
                ),
                "response": (
                    masker.mask_struct(raw_response)
                    if masker.has_secrets and raw_response
                    else raw_response
                ),
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
        "environment": {"environmentId": run.environmentId} if run.environmentId else None,
        "variables": run.variables or {},
        "error": run.error,
        "failedNodes": run.failedNodes or [],
        "failureMessage": run.failureMessage,
        "nodeResults": formatted_results,
        "callbackUrl": run.callbackUrl,
    }


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

    from .execution import _derive_failed_node_ids, _node_id, _node_label, _node_type

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
