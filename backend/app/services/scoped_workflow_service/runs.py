"""
Scoped Run operations — list runs, trigger runs, run status, node results.

Names that tests monkeypatch (``WorkspaceRepository``, ``WorkflowRepository``,
``_assert_workspace_access``) are looked up lazily inside each function via
``from . import X`` so patches applied to the package are observed at call time.
"""

from __future__ import annotations

from typing import Any

from . import ResourceNotFoundError, _run_to_summary, _verify_workspace_and_workflow


async def list_scoped_runs(
    workspace_id: str,
    actor_user_id: str,
    workflow_id: str | None = None,
    skip: int = 0,
    limit: int = 20,
) -> dict[str, Any]:
    """
    List runs scoped to a workspace. Runs are workspace-owned.
    """
    from . import (
        RunRepository,
        WorkflowRepository,
        WorkspaceRepository,
        _assert_workspace_access,
    )

    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    if workflow_id:
        # Verify workflow belongs to workspace
        wf = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
        if not wf:
            raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")
        runs, total = await RunRepository.list_by_workflow(workflow_id, skip, limit)
    else:
        runs, total = await RunRepository.list_by_workspace(workspace_id, skip, limit)

    return {
        "runs": [_run_to_summary(r) for r in runs],
        "total": total,
        "skip": skip,
        "limit": limit,
        "hasMore": skip + limit < total,
    }


async def trigger_scoped_run(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
    environment_id: str | None = None,
    resume: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Trigger a workflow run scoped to a workspace."""
    await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)

    from app.models import RunActorContext
    from app.services.run_service import trigger_workflow_run

    actor = RunActorContext(actorType="user", actorId=actor_user_id)
    return await trigger_workflow_run(
        workflow_id,
        environment_id=environment_id,
        resume=resume,
        workspace_id=workspace_id,
        actor=actor,
    )


async def get_scoped_latest_failed_run(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Get latest failed run metadata for a workflow scoped to a workspace."""
    await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)

    from app.services.run_service import get_latest_failed_run

    return await get_latest_failed_run(workflow_id)


async def get_scoped_run_status(
    workspace_id: str,
    workflow_id: str,
    run_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Get run status with full node results, scoped to workspace."""
    await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)

    from app.services.run_service import get_run_with_node_results

    return await get_run_with_node_results(run_id, workflow_id)


async def get_scoped_node_result(
    workspace_id: str,
    workflow_id: str,
    run_id: str,
    node_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Get full result for a specific node, scoped to workspace."""
    await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)

    from app.services.run_service import get_node_result

    return await get_node_result(run_id, workflow_id, node_id)
