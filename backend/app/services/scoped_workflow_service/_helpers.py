"""
Private helpers shared across scoped_workflow_service submodules.

These functions reference shared dependencies (``WorkspaceRepository``,
``_assert_workspace_access``, etc.) via the *package* namespace rather than
importing them directly from their source modules. This is deliberate: tests
monkeypatch ``scoped_workflow_service._assert_workspace_access`` (etc.) and
expect the patch to be observed by helper code. Looking the names up through
the package (``from . import X`` inside functions) means the lookup happens at
call time against the package's current attributes — so patches applied to the
package are seen here.
"""

from __future__ import annotations

from typing import Any

from app.models import Run, Workflow
from app.repositories.workflow_repository import WorkflowRepository
from app.services.exceptions import ResourceNotFoundError


def _workflow_to_response(wf: Workflow) -> dict[str, Any]:
    """Convert a Workflow document to a response dict."""
    return {
        "workflowId": wf.workflowId,
        "name": wf.name,
        "description": wf.description,
        "workspaceId": wf.workspaceId,
        "projectId": wf.collectionId,
        "collectionId": wf.collectionId,
        "orgId": wf.orgId,
        "ownerType": wf.ownerType,
        "nodes": [n.model_dump() if hasattr(n, "model_dump") else n for n in wf.nodes],
        "edges": [e.model_dump() if hasattr(e, "model_dump") else e for e in wf.edges],
        "variables": wf.variables,
        "tags": wf.tags,
        "selectedEnvironmentId": wf.selectedEnvironmentId,
        "createdAt": wf.createdAt.isoformat() if wf.createdAt else None,
        "updatedAt": wf.updatedAt.isoformat() if wf.updatedAt else None,
        "version": wf.version,
    }


def _run_to_summary(run: Run) -> dict[str, Any]:
    """Convert a Run document to a summary response dict."""
    return {
        "runId": run.runId,
        "workflowId": run.workflowId,
        "workspaceId": run.workspaceId,
        "status": run.status,
        "trigger": run.trigger,
        "selectedEnvironmentId": run.selectedEnvironmentId,
        "actorType": run.actorType,
        "actorId": run.actorId,
        "createdAt": run.createdAt.isoformat() if run.createdAt else None,
        "startedAt": run.startedAt.isoformat() if run.startedAt else None,
        "completedAt": run.completedAt.isoformat() if run.completedAt else None,
        "duration": run.duration,
        "error": run.error,
    }


async def _verify_workspace_and_workflow(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> Workflow:
    """Verify workspace access and that workflow belongs to workspace. Returns workflow."""
    # Lazy imports from the package so test monkeypatches on
    # ``scoped_workflow_service.WorkspaceRepository`` / ``_assert_workspace_access``
    # are observed here at call time.
    from . import WorkspaceRepository, _assert_workspace_access

    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")
    return workflow
