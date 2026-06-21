"""
Run service — shared business logic for run creation, status, results, and node results.
Called by both FastAPI routes and MCP tools.

Runs are workspace-owned. The actor (user/service_token/webhook/system) is recorded
separately from workspace ownership. Edge cases:
- Soft-deleted env while queued: run fails with audit.
- User removed mid-run: run continues (secrets resolved at start), audit records removal.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app import models
from app.auth.permissions import WORKFLOWS_RUN, ScopedPermissionEvaluator
from app.models import RunActorContext
from app.repositories import EnvironmentRepository, RunRepository, WorkflowRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.runner.executor import RunContext
from app.services import audit_service
from app.services.exceptions import ConflictError, ResourceNotFoundError

from . import execution as execution
from . import lifecycle as lifecycle
from . import queries as queries
from .execution import VALID_RESUME_MODES as VALID_RESUME_MODES
from .lifecycle import cancel_run as cancel_run
from .lifecycle import create_run as create_run
from .queries import get_latest_failed_run as get_latest_failed_run
from .queries import get_node_result as get_node_result
from .queries import get_run as get_run
from .queries import get_run_results as get_run_results
from .queries import get_run_with_node_results as get_run_with_node_results
from .queries import list_runs as list_runs

logger = logging.getLogger(__name__)

__all__ = [
    "VALID_RESUME_MODES",
    "EnvironmentRepository",
    "RunRepository",
    "ScopedEnvironmentRepository",
    "ScopedPermissionEvaluator",
    "WorkflowRepository",
    "WorkspaceRepository",
    "asyncio",
    "audit_service",
    "cancel_run",
    "check_and_handle_deleted_env",
    "create_run",
    "get_latest_failed_run",
    "get_node_result",
    "get_run",
    "get_run_results",
    "get_run_with_node_results",
    "list_runs",
    "models",
    "notify_actor_removed_during_run",
    "trigger_workflow_run",
]


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

    from .execution import _derive_failed_node_ids, _node_id

    node_ids = {_node_id(node) for node in workflow.nodes}
    node_ids.discard(None)

    if resume_mode in VALID_RESUME_MODES:
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

        invalid_node_ids = [node_id for node_id in start_node_ids if node_id not in node_ids]
        if invalid_node_ids:
            raise ValueError(f"Invalid resume node(s): {invalid_node_ids}")

        if not start_node_ids:
            raise ValueError("No failed nodes found to resume from")
    elif resume_from_run_id or start_node_ids:
        raise ValueError("Resume source and start nodes require a resume mode.")

    if environment_id:
        environment = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if not environment:
            environment = await EnvironmentRepository.get_by_id(environment_id)
        if not environment:
            raise ValueError(f"Environment {environment_id} not found")

    run_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    workflow_variables = workflow.variables.copy() if workflow.variables else {}

    # Resolve workspace ownership from workflow or explicit param
    effective_workspace_id = workspace_id or workflow.workspaceId
    effective_org_id = workflow.orgId
    effective_owner_type = workflow.ownerType

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

    # Build RunContext for scoped execution
    run_context: RunContext | None = None
    if effective_workspace_id and actor:
        # Resolve environment scope info
        env_scope_type = "workspace"
        env_scope_id = effective_workspace_id
        if environment_id:
            env_doc = await ScopedEnvironmentRepository.get_by_id(environment_id)
            if env_doc:
                env_scope_type = env_doc.scopeType
                env_scope_id = env_doc.scopeId or effective_workspace_id

        # Resolve actor's workspace role for permission check
        workspace_role: str | None = None
        if actor.actorType == "user":
            member = await WorkspaceRepository.get_member(effective_workspace_id, actor.actorId)
            if member:
                workspace_role = member.role
            elif effective_owner_type == "user" and workflow.ownerUserId == actor.actorId:
                workspace_role = "admin"  # Owner gets admin

        # Evaluate effective permissions
        effective_perms = ScopedPermissionEvaluator.evaluate(
            workspace_role=workspace_role,
            service_token_permissions=set() if actor.actorType != "service_token" else None,
        )

        # Permission check: actor must have workflows:run
        if not ScopedPermissionEvaluator.has_permission(effective_perms, WORKFLOWS_RUN):
            raise ConflictError(
                f"Actor {actor.actorType}:{actor.actorId} lacks permission to run workflows "
                f"in workspace {effective_workspace_id}"
            )

        run_context = RunContext(
            workspace_id=effective_workspace_id,
            org_id=effective_org_id,
            actor_type=actor.actorType,
            actor_id=actor.actorId,
            environment_id=environment_id,
            environment_scope_type=env_scope_type,
            environment_scope_id=env_scope_id,
            effective_permissions=effective_perms,
        )

    from .execution import _execute_workflow_background

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
