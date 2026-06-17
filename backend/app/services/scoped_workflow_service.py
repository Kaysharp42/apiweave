"""
Scoped Workflow Service — workspace-scoped workflow CRUD and run listing.

All workflow operations are scoped to a workspace. A user can only
access workflows within workspaces they have access to.
"""
import logging
from datetime import UTC, datetime
from typing import Any

from app.models import Run, Workflow, WorkflowCreate, WorkflowUpdate
from app.repositories.run_repository import RunRepository
from app.repositories.workflow_repository import WorkflowRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ResourceNotFoundError
from app.services.workspace_service import _assert_workspace_access

logger = logging.getLogger(__name__)


# ============================================================================
# Response DTOs
# ============================================================================

def _workflow_to_response(wf: Workflow) -> dict[str, Any]:
    """Convert a Workflow document to a response dict."""
    return {
        "workflowId": wf.workflowId,
        "name": wf.name,
        "description": wf.description,
        "workspaceId": wf.workspaceId,
        "projectId": wf.collectionId,
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


# ============================================================================
# Scoped Workflow CRUD
# ============================================================================

async def create_scoped_workflow(
    workspace_id: str,
    workflow_data: WorkflowCreate,
    actor_user_id: str,
    project_id: str | None = None,
) -> dict[str, Any]:
    """
    Create a workflow scoped to a workspace (and optionally a project).
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.create_scoped(
        workflow_data=workflow_data,
        workspace_id=workspace_id,
        org_id=ws.orgId,
        owner_type=ws.ownerType,
    )

    # If project_id is provided, set the collectionId
    if project_id:
        workflow.collectionId = project_id
        workflow.updatedAt = datetime.now(UTC)
        await workflow.save()

    try:
        from app.services.audit_service import append_event
        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workflow.created",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="workflow",
            resource_id=workflow.workflowId,
            context={"name": workflow_data.name, "projectId": project_id},
        )
    except Exception:
        logger.warning("Audit write failed for workflow creation", exc_info=True)

    return _workflow_to_response(workflow)


async def get_scoped_workflow(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Get a workflow ensuring it belongs to the workspace.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")

    return _workflow_to_response(workflow)


async def update_scoped_workflow(
    workspace_id: str,
    workflow_id: str,
    update_data: WorkflowUpdate,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Update a workflow scoped to a workspace.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")

    updated = await WorkflowRepository.update(workflow_id, update_data)
    if not updated:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found")

    return _workflow_to_response(updated)


async def delete_scoped_workflow(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> None:
    """
    Delete a workflow scoped to a workspace.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")

    await WorkflowRepository.delete(workflow_id)

    try:
        from app.services.audit_service import append_event
        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="workflow.deleted",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="workflow",
            resource_id=workflow_id,
        )
    except Exception:
        logger.warning("Audit write failed for workflow deletion", exc_info=True)


async def list_scoped_workflows(
    workspace_id: str,
    actor_user_id: str,
    project_id: str | None = None,
    skip: int = 0,
    limit: int = 20,
) -> dict[str, Any]:
    """
    List workflows in a workspace, optionally filtered by project.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    if project_id:
        workflows, total = await WorkflowRepository.list_by_workspace_and_project(
            workspace_id, project_id, skip, limit
        )
    else:
        workflows, total = await WorkflowRepository.list_by_workspace(
            workspace_id, skip, limit
        )

    return {
        "workflows": [_workflow_to_response(wf) for wf in workflows],
        "total": total,
        "skip": skip,
        "limit": limit,
        "hasMore": skip + limit < total,
    }


# ============================================================================
# Scoped Run Listing
# ============================================================================

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
