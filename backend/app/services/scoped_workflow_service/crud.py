"""
Scoped Workflow CRUD — create, read, update, delete, list workflows scoped to a workspace.

Names that tests monkeypatch (``WorkspaceRepository``, ``WorkflowRepository``,
``_assert_workspace_access``) are looked up lazily inside each function via
``from . import X``. This ensures the lookup happens at call time against the
package's current attributes, so patches applied to the package are observed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from . import ResourceNotFoundError, WorkflowCreate, WorkflowUpdate, _workflow_to_response, logger


async def create_scoped_workflow(
    workspace_id: str,
    workflow_data: WorkflowCreate,
    actor_user_id: str,
    project_id: str | None = None,
) -> dict[str, Any]:
    """
    Create a workflow scoped to a workspace (and optionally a project).
    """
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    if project_id:
        workflows, total = await WorkflowRepository.list_by_workspace_and_project(
            workspace_id, project_id, skip, limit
        )
    else:
        workflows, total = await WorkflowRepository.list_by_workspace(workspace_id, skip, limit)

    return {
        "workflows": [_workflow_to_response(wf) for wf in workflows],
        "total": total,
        "skip": skip,
        "limit": limit,
        "hasMore": skip + limit < total,
    }
