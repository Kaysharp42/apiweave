"""
Run service — shared business logic for run creation, status, results, and node results.
Called by both FastAPI routes and MCP tools.

Runs are workspace-owned. The actor (user/service_token/webhook/system) is recorded
separately from workspace ownership. Edge cases:
- Soft-deleted env while queued: run fails with audit.
- User removed mid-run: run continues (secrets resolved at start), audit records removal.
"""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, cast

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app import models
from app.auth.permissions import WORKFLOWS_RUN, ScopedPermissionEvaluator
from app.database import get_database
from app.models import Run, RunActorContext, RunCreate
from app.repositories import EnvironmentRepository, RunRepository, WorkflowRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.runner.executor import RunContext, WorkflowExecutor, _StopBranch
from app.services import audit_service
from app.services.exceptions import ConflictError, ResourceNotFoundError
from app.services.secret_utils import SecretMasker

logger = logging.getLogger(__name__)
VALID_RESUME_MODES = {"single", "all-failed"}

_active_executors: dict[str, WorkflowExecutor] = {}
_active_cancel_events: dict[str, asyncio.Event] = {}


def _register_executor(
    run_id: str,
    executor: WorkflowExecutor,
    cancel_event: asyncio.Event,
) -> None:
    _active_executors[run_id] = executor
    _active_cancel_events[run_id] = cancel_event


def _unregister_executor(run_id: str) -> None:
    _active_executors.pop(run_id, None)
    _active_cancel_events.pop(run_id, None)


def _get_executor(run_id: str) -> WorkflowExecutor | None:
    return _active_executors.get(run_id)


def _get_cancel_event(run_id: str) -> asyncio.Event | None:
    return _active_cancel_events.get(run_id)


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


async def _execute_workflow_background(
    run_id: str,
    workflow_id: str,
    start_node_ids: list[str] | None,
    resume_from_run_id: str | None,
    cancel_event: asyncio.Event,
    run_context: RunContext | None = None,
) -> None:
    """Run the workflow executor as a background task."""
    executor = WorkflowExecutor(
        run_id,
        workflow_id,
        start_node_ids=start_node_ids,
        resume_from_run_id=resume_from_run_id,
        cancel_event=cancel_event,
        run_context=run_context,
    )
    _register_executor(run_id, executor, cancel_event)
    try:
        await executor.execute()
    except _StopBranch:
        # Normal control-flow signal; status already persisted by execute().
        pass
    except asyncio.CancelledError:
        # Never swallow cancellation — let the event loop unwind cleanly.
        raise
    except Exception:
        logger.exception("Background workflow execution failed for run %s", run_id)
    finally:
        _unregister_executor(run_id)


def _resume_value(
    resume: dict[str, Any] | None,
    snake_name: str,
    camel_name: str,
) -> Any:
    if not resume:
        return None
    if snake_name in resume:
        return resume[snake_name]
    return resume.get(camel_name)


def _normalize_start_node_ids(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [node_id for node_id in value if isinstance(node_id, str) and node_id]
    return []


async def trigger_workflow_run(
    workflow_id: str,
    environment_id: str | None = None,
    resume: dict[str, Any] | None = None,
    workspace_id: str | None = None,
    actor: RunActorContext | None = None,
) -> dict[str, Any]:
    """Trigger workflow execution and return run metadata.

    Runtime/ad-hoc secrets are NOT supported. All secrets must be stored
    before runs and are resolved through the scoped Environment > Workspace
    > Organization chain.

    When workspace_id and actor are provided, the run is workspace-scoped with
    full audit trail. Legacy calls without workspace/actor still work for
    backward compatibility during migration.
    """
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")

    resume_mode = _resume_value(resume, "mode", "mode")
    resume_from_run_id = _resume_value(resume, "source_run_id", "sourceRunId")
    start_node_ids = _normalize_start_node_ids(
        _resume_value(resume, "start_node_ids", "startNodeIds")
    )

    if resume_mode is not None and resume_mode not in VALID_RESUME_MODES:
        raise ValueError("Invalid resume mode. Expected 'single' or 'all-failed'.")

    node_ids = {_node_id(node) for node in workflow.nodes}
    node_ids.discard(None)

    if resume_mode in VALID_RESUME_MODES:
        # Billing seam: re-running from the last failed node is a paid feature.
        from app.services import entitlements

        ws_id = workspace_id or getattr(workflow, "workspaceId", None)
        if ws_id:
            await entitlements.require_can_rerun_from_failed(ws_id)

        if not resume_from_run_id:
            latest_failed = await RunRepository.get_latest_failed_run(workflow_id)
            if not latest_failed:
                raise ValueError("No failed run found to resume from")
            resume_from_run_id = latest_failed.runId
            if not start_node_ids:
                start_node_ids = _derive_failed_node_ids(latest_failed)

        source_run = await RunRepository.get_by_id(resume_from_run_id)
        if not source_run or source_run.workflowId != workflow_id:
            raise ValueError("Invalid resume source run")

        if not start_node_ids:
            start_node_ids = _derive_failed_node_ids(source_run)

        if resume_mode == "single" and len(start_node_ids) > 1:
            start_node_ids = [start_node_ids[0]]

        # Resume entry points must be workflow nodes AND failed nodes of the
        # source run — a run can only retry from nodes that actually failed.
        source_failed = set(_derive_failed_node_ids(source_run))
        invalid_node_ids = [
            node_id
            for node_id in start_node_ids
            if node_id not in node_ids or node_id not in source_failed
        ]
        if invalid_node_ids:
            raise ValueError(f"Invalid resume node(s): {invalid_node_ids}")

        if not start_node_ids:
            raise ValueError("No failed nodes found to resume from")
    elif resume_from_run_id or start_node_ids:
        raise ValueError("Resume source and start nodes require a resume mode.")

    requested_environment_id = (
        environment_id
        or getattr(workflow, "selectedEnvironmentId", None)
        or getattr(workflow, "environmentId", None)
    )

    run_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    workflow_variables = workflow.variables.copy() if workflow.variables else {}

    # Resolve workspace ownership from workflow or explicit param
    effective_workspace_id = workspace_id or workflow.workspaceId
    effective_org_id = workflow.orgId
    effective_owner_type = workflow.ownerType

    if effective_workspace_id:
        from app.services.scoped_environment_service import resolve_run_environment

        environment_selection = await resolve_run_environment(
            workspace_id=effective_workspace_id,
            org_id=effective_org_id,
            explicit_environment_id=requested_environment_id,
        )
        environment_id = environment_selection.environmentId
    elif requested_environment_id:
        environment = await ScopedEnvironmentRepository.get_by_id(requested_environment_id)
        if not environment:
            environment = await EnvironmentRepository.get_by_id(requested_environment_id)
        if not environment:
            raise ValueError(f"Environment {requested_environment_id} not found")
        environment_id = requested_environment_id
    else:
        environment_id = None

    run = models.Run(
        runId=run_id,
        workflowId=workflow_id,
        environmentId=environment_id,
        selectedEnvironmentId=environment_id,
        status="pending",
        trigger="manual",
        variables=workflow_variables,
        resumeFromRunId=resume_from_run_id,
        resumeFromNodeIds=start_node_ids or None,
        resumeMode=resume_mode if resume_mode in VALID_RESUME_MODES else None,
        callbackUrl=None,
        results=[],
        createdAt=now,
        startedAt=None,
        completedAt=None,
        duration=None,
        error=None,
        workspaceId=effective_workspace_id,
        orgId=effective_org_id,
        ownerType=effective_owner_type,
        actorType=actor.actorType if actor else None,
        actorId=actor.actorId if actor else None,
    )
    await run.insert()

    # Billing seam: Free tier keeps only the latest run — prune older ones.
    if effective_workspace_id:
        from app.services import entitlements

        await entitlements.enforce_run_history_retention(effective_workspace_id, workflow_id)

    # Audit: run created
    if effective_workspace_id and actor:
        try:
            evt = await audit_service.append_event(
                actor=actor.actorType,  # type: ignore[arg-type]
                actor_id=actor.actorId,
                action="run.created",
                scope="workspace",
                scope_id=effective_workspace_id,
                resource_type="run",
                resource_id=run_id,
                context={
                    "workflowId": workflow_id,
                    "environmentId": environment_id,
                    "trigger": "manual",
                },
            )
            run.auditEventIds.append(evt.eventId)
            await run.save()
        except Exception:
            logger.warning("Audit write failed for run.created %s", run_id, exc_info=True)

    cancel_event = asyncio.Event()

    # Build RunContext for scoped execution (also enforces workflows:run).
    run_context = await _build_run_context(
        workflow=workflow,
        environment_id=environment_id,
        workspace_id=effective_workspace_id,
        org_id=effective_org_id,
        owner_type=effective_owner_type,
        actor=actor,
    )

    # Environment protection gate (roadmap §3.3): a protected environment must
    # not execute without approval. Manual / scoped / UI runs previously skipped
    # this entirely — only webhooks consulted it. Hold the run as
    # pending_approval and do NOT start execution when gated.
    if environment_id and effective_workspace_id:
        # Lazy import avoids a circular import via app.services.__init__.
        from app.services import environment_protection_service

        gate_actor_type = actor.actorType if actor else "system"
        gate_actor_id = actor.actorId if actor else "system"
        decision, approval = await environment_protection_service.check_protection_and_maybe_gate(
            run_id=run_id,
            environment_id=environment_id,
            workspace_id=effective_workspace_id,
            actor_type=gate_actor_type,
            actor_id=gate_actor_id,
            requested_by_user_id=(actor.actorId if actor and actor.actorType == "user" else None),
        )
        if decision == "pending_approval":
            run.status = "pending_approval"
            await run.save()
            return {
                "message": "Workflow run requires approval",
                "runId": run_id,
                "workflowId": workflow_id,
                "environmentId": environment_id,
                "workspaceId": effective_workspace_id,
                "actorType": actor.actorType if actor else None,
                "actorId": actor.actorId if actor else None,
                "approvalId": approval.approvalId if approval else None,
                "status": "pending_approval",
            }

    asyncio.create_task(
        _execute_workflow_background(
            run_id,
            workflow_id,
            start_node_ids or None,
            resume_from_run_id,
            cancel_event,
            run_context=run_context,
        )
    )

    return {
        "message": "Workflow run triggered",
        "runId": run_id,
        "workflowId": workflow_id,
        "environmentId": environment_id,
        "workspaceId": effective_workspace_id,
        "actorType": actor.actorType if actor else None,
        "actorId": actor.actorId if actor else None,
        "resumeMode": resume_mode if resume_mode in VALID_RESUME_MODES else None,
        "resumeFromRunId": resume_from_run_id,
        "startNodeIds": start_node_ids or None,
        "status": "pending",
        "polling": {
            "tool": "run_get_status",
            "recommendedIntervalSeconds": 1,
            "instructions": (
                "Call run_get_status with this workflow_id and run_id until status is "
                "completed, failed, or cancelled. Use run_get_results for a summary and "
                "run_get_node_result only when a full node payload is needed."
            ),
            "terminalStatuses": ["completed", "failed", "cancelled"],
        },
    }


async def _build_run_context(
    *,
    workflow: Any,
    environment_id: str | None,
    workspace_id: str | None,
    org_id: str | None,
    owner_type: str | None,
    actor: RunActorContext | None,
) -> RunContext | None:
    """Build the scoped RunContext and enforce workflows:run for the actor.

    Shared by the initial trigger and the resume-on-approval path so a held run
    executes with the same scoped context it would have had originally.
    """
    if not (workspace_id and actor):
        return None

    env_scope_type = "workspace"
    env_scope_id = workspace_id
    if environment_id:
        env_doc = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if env_doc:
            env_scope_type = env_doc.scopeType
            env_scope_id = env_doc.scopeId or workspace_id

    workspace_role: str | None = None
    if actor.actorType == "user":
        member = await WorkspaceRepository.get_member(workspace_id, actor.actorId)
        if member:
            workspace_role = member.role
        elif owner_type == "user" and workflow.ownerUserId == actor.actorId:
            workspace_role = "admin"  # Owner gets admin

    effective_perms = ScopedPermissionEvaluator.evaluate(
        workspace_role=workspace_role,
        service_token_permissions=set() if actor.actorType != "service_token" else None,
    )
    if not ScopedPermissionEvaluator.has_permission(effective_perms, WORKFLOWS_RUN):
        raise ConflictError(
            f"Actor {actor.actorType}:{actor.actorId} lacks permission to run workflows "
            f"in workspace {workspace_id}"
        )

    return RunContext(
        workspace_id=workspace_id,
        org_id=org_id,
        actor_type=actor.actorType,
        actor_id=actor.actorId,
        environment_id=environment_id,
        environment_scope_type=env_scope_type,
        environment_scope_id=env_scope_id,
        effective_permissions=effective_perms,
    )


async def resume_approved_run(run_id: str) -> dict[str, Any]:
    """Start a run that was held in pending_approval after its gate cleared.

    Called by the approvals route after approve/bypass. Reconstructs the scoped
    context from the stored run and starts background execution. Idempotent:
    a run that is not pending_approval is left untouched.
    """
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    if run.status != "pending_approval":
        return {"runId": run_id, "status": run.status, "message": "Run is not pending approval"}

    workflow = await WorkflowRepository.get_by_id(run.workflowId)
    if not workflow:
        raise ValueError(f"Workflow {run.workflowId} not found")

    actor = (
        RunActorContext(actorType=run.actorType, actorId=run.actorId)
        if run.actorType and run.actorId
        else None
    )
    run_context = await _build_run_context(
        workflow=workflow,
        environment_id=run.environmentId,
        workspace_id=run.workspaceId,
        org_id=run.orgId,
        owner_type=run.ownerType,
        actor=actor,
    )

    run.status = "pending"
    await run.save()

    cancel_event = asyncio.Event()
    asyncio.create_task(
        _execute_workflow_background(
            run_id,
            run.workflowId,
            run.resumeFromNodeIds or None,
            run.resumeFromRunId,
            cancel_event,
            run_context=run_context,
        )
    )
    return {"runId": run_id, "status": "pending"}


async def cancel_pending_run(run_id: str) -> dict[str, str]:
    """Cancel a run that was held in pending_approval (gate rejected)."""
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    if run.status != "pending_approval":
        return {"runId": run_id, "status": run.status}
    run.status = "cancelled"
    run.completedAt = datetime.now(UTC)
    await run.save()
    return {"runId": run_id, "status": "cancelled"}


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


async def cancel_run(run_id: str) -> dict[str, str]:
    """Cancel a pending or running run.

    Raises ValueError if not found, ConflictError if invalid state.
    """
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    if run.status not in ("pending", "running"):
        raise ConflictError(f"Cannot cancel run with status {run.status}")

    cancel_event = _get_cancel_event(run_id)
    if cancel_event:
        cancel_event.set()
        executor = _get_executor(run_id)
        if executor:
            executor.cancel()
        logger.info("Signalled cancellation for running run %s", run_id)

    await RunRepository.update_status(run_id, "cancelled")
    return {"message": f"Run {run_id} cancelled", "runId": run_id, "status": "cancelled"}


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
                            file_data: bytes = await grid_out.read()
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
                                "result": {"error": f"Failed to retrieve large result: {str(e)}"},
                                "timestamp": full_result.get("timestamp"),
                            }
                else:
                    run["nodeStatuses"][node_id] = {
                        "status": full_result.get("status"),
                        "result": masker.mask_struct(result) if masker.has_secrets else result,
                        "timestamp": full_result.get("timestamp"),
                    }

    return cast(dict[str, Any], run)


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
            file_data: bytes = await grid_out.read()
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
            raise ValueError(f"Failed to retrieve result from GridFS: {str(e)}")

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


def _node_id(node: Any) -> str | None:
    if isinstance(node, dict):
        return node.get("nodeId")
    return getattr(node, "nodeId", None)


def _node_label(node: Any, fallback: str) -> str:
    if isinstance(node, dict):
        return str(node.get("label", fallback))
    return getattr(node, "label", fallback)


def _node_type(node: Any) -> str | None:
    if isinstance(node, dict):
        return node.get("type")
    return getattr(node, "type", None)


def _derive_failed_node_ids(run: Any) -> list[str]:
    """Resolve failed node IDs from failedNodes, or fallback to nodeStatuses error states."""
    explicit_failed = list(getattr(run, "failedNodes", None) or [])
    explicit_failed = [nid for nid in explicit_failed if isinstance(nid, str) and nid]
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

    failed_nodes: list[dict[str, Any]] = []
    for nid in failed_node_ids:
        node: Any = node_map.get(nid, {})
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


# ============================================================================
# Edge Case: Soft-deleted environment while run is queued
# ============================================================================


async def check_and_handle_deleted_env(run_id: str) -> dict[str, Any]:
    """Check if a pending/queued run's environment has been soft-deleted.

    If the environment no longer exists, fail the run with an audit event.
    Returns a dict with the outcome: {"action": "failed"|"proceed", "reason": ...}.
    """
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ResourceNotFoundError(f"Run {run_id} not found")

    if run.status not in ("pending", "pending_approval"):
        return {"action": "proceed", "reason": "run already active"}

    env_id = run.selectedEnvironmentId or run.environmentId
    if not env_id:
        return {"action": "proceed", "reason": "no environment selected"}

    env = await ScopedEnvironmentRepository.get_by_id(env_id)
    if env is not None:
        return {"action": "proceed", "reason": "environment exists"}

    # Environment has been deleted — fail the run
    await RunRepository.update_status(
        run_id, "failed", error="Environment was deleted while run was queued"
    )

    if run.workspaceId and run.actorType and run.actorId:
        try:
            evt = await audit_service.append_event(
                actor=run.actorType,  # type: ignore[arg-type]
                actor_id=run.actorId,
                action="run.failed.env_deleted",
                scope="workspace",
                scope_id=run.workspaceId,
                resource_type="run",
                resource_id=run_id,
                context={
                    "environmentId": env_id,
                    "reason": "environment_deleted_while_queued",
                },
            )
            run.auditEventIds.append(evt.eventId)
            await run.save()
        except Exception:
            logger.warning(
                "Audit write failed for run.failed.env_deleted %s", run_id, exc_info=True
            )

    logger.info("Run %s failed: environment %s deleted while queued", run_id, env_id)
    return {
        "action": "failed",
        "reason": "environment_deleted_while_queued",
        "environmentId": env_id,
    }


# ============================================================================
# Edge Case: User removed mid-run
# ============================================================================


async def notify_actor_removed_during_run(
    run_id: str,
    removed_user_id: str,
    removed_by_user_id: str,
) -> dict[str, Any]:
    """Record that the run's actor (user) was removed from the workspace mid-run.

    Policy: The run continues to completion because secrets are resolved at start.
    The removal is recorded in the run document and an audit event is created.
    No new secrets are resolved after this point.

    Returns a dict with the outcome.
    """
    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ResourceNotFoundError(f"Run {run_id} not found")

    if run.status in ("completed", "failed", "cancelled"):
        return {"action": "no_op", "reason": "run already terminal"}

    run.actorRemovedDuringRun = True
    await run.save()

    if run.workspaceId:
        try:
            evt = await audit_service.append_event(
                actor="user",
                actor_id=removed_by_user_id,
                action="run.actor_removed_mid_run",
                scope="workspace",
                scope_id=run.workspaceId,
                resource_type="run",
                resource_id=run_id,
                context={
                    "removedUserId": removed_user_id,
                    "actorType": run.actorType,
                    "actorId": run.actorId,
                    "runStatus": run.status,
                    "policy": "run_continues_secrets_already_resolved",
                },
            )
            run.auditEventIds.append(evt.eventId)
            await run.save()
        except Exception:
            logger.warning(
                "Audit write failed for run.actor_removed_mid_run %s",
                run_id,
                exc_info=True,
            )

    logger.info(
        "Actor %s removed during run %s — run continues, no new secret resolution",
        removed_user_id,
        run_id,
    )
    return {
        "action": "recorded",
        "runId": run_id,
        "removedUserId": removed_user_id,
        "policy": "run_continues_secrets_already_resolved",
    }
