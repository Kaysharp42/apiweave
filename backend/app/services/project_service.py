"""
Project Service — business logic for project CRUD.

Projects replace Collections in the public API. The underlying DB model
still uses the Project document (DB collection name 'collections' for
migration compatibility), but all API-facing DTOs use 'project' terminology.
"""

import logging
import uuid
from typing import Any

from app.repositories.project_repository import ProjectRepository
from app.repositories.workflow_repository import WorkflowRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ResourceNotFoundError
from app.services.workspace_service import _assert_workspace_access, _assert_workspace_admin

logger = logging.getLogger(__name__)


# ============================================================================
# Response DTOs
# ============================================================================


def _project_to_response(project: Any) -> dict[str, Any]:
    """Convert a Project document to a response dict using project terminology."""
    return {
        "projectId": project.projectId or project.collectionId,
        "collectionId": project.collectionId,
        "name": project.name,
        "description": project.description,
        "color": project.color,
        "workspaceId": project.workspaceId,
        "orgId": project.orgId,
        "ownerType": project.ownerType,
        "workflowCount": project.workflowCount,
        "createdAt": project.createdAt.isoformat() if project.createdAt else None,
        "updatedAt": project.updatedAt.isoformat() if project.updatedAt else None,
    }


# ============================================================================
# Project CRUD
# ============================================================================


async def create_project(
    *,
    name: str,
    workspace_id: str,
    description: str | None = None,
    color: str | None = None,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Create a new project in a workspace.
    Requires write or higher workspace role.
    """
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    project_id = f"prj-{uuid.uuid4().hex[:16]}"
    project = await ProjectRepository.create(
        project_id=project_id,
        name=name,
        workspace_id=workspace_id,
        org_id=ws.orgId,
        owner_type=ws.ownerType,
        description=description,
        color=color,
    )

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="project.created",
            scope="workspace",
            scope_id=workspace_id,
            resource_type="project",
            resource_id=project_id,
            context={"name": name},
        )
    except Exception:
        logger.warning("Audit write failed for project creation", exc_info=True)

    return _project_to_response(project)


async def get_project(
    project_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Get a project by ID. Enforces workspace isolation.
    """
    project = await ProjectRepository.get_by_id(project_id)
    if not project:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    if project.workspaceId:
        ws = await WorkspaceRepository.get_by_id(project.workspaceId)
        if not ws:
            raise ResourceNotFoundError(f"Project {project_id} not found")
        await _assert_workspace_access(ws, actor_user_id)

    return _project_to_response(project)


async def update_project(
    project_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    color: str | None = None,
    actor_user_id: str,
) -> dict[str, Any]:
    """Update a project. Requires write or higher workspace role."""
    project = await ProjectRepository.get_by_id(project_id)
    if not project:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    if project.workspaceId:
        ws = await WorkspaceRepository.get_by_id(project.workspaceId)
        if not ws:
            raise ResourceNotFoundError(f"Project {project_id} not found")
        await _assert_workspace_access(ws, actor_user_id)

    updated = await ProjectRepository.update(
        project_id,
        name=name,
        description=description,
        color=color,
    )
    if not updated:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="project.updated",
            scope="workspace",
            scope_id=project.workspaceId or "",
            resource_type="project",
            resource_id=project_id,
            context={
                k: v
                for k, v in {"name": name, "description": description, "color": color}.items()
                if v is not None
            },
        )
    except Exception:
        logger.warning("Audit write failed for project update", exc_info=True)

    return _project_to_response(updated)


async def delete_project(
    project_id: str,
    actor_user_id: str,
) -> None:
    """Delete a project. Requires admin workspace role."""
    project = await ProjectRepository.get_by_id(project_id)
    if not project:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    if project.workspaceId:
        ws = await WorkspaceRepository.get_by_id(project.workspaceId)
        if not ws:
            raise ResourceNotFoundError(f"Project {project_id} not found")
        await _assert_workspace_admin(ws, actor_user_id)

    await ProjectRepository.delete(project_id)

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="project.deleted",
            scope="workspace",
            scope_id=project.workspaceId or "",
            resource_type="project",
            resource_id=project_id,
        )
    except Exception:
        logger.warning("Audit write failed for project deletion", exc_info=True)


async def list_projects(
    workspace_id: str,
    actor_user_id: str,
) -> list[dict[str, Any]]:
    """List all projects in a workspace."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")

    await _assert_workspace_access(ws, actor_user_id)

    projects = await ProjectRepository.list_by_workspace(workspace_id)
    return [_project_to_response(p) for p in projects]


# ============================================================================
# Project-Workflow association
# ============================================================================


async def assign_workflow_to_project(
    project_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Assign a workflow to a project (sets workflow.collectionId).
    Enforces workspace isolation on the project side.
    """
    project = await ProjectRepository.get_by_id(project_id)
    if not project:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    if project.workspaceId:
        ws = await WorkspaceRepository.get_by_id(project.workspaceId)
        if not ws:
            raise ResourceNotFoundError(f"Project {project_id} not found")
        await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.update_collection_assignment(workflow_id, project_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found")

    await ProjectRepository.update_workflow_count(project_id)

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="project.workflow_assigned",
            scope="workspace",
            scope_id=project.workspaceId or "",
            resource_type="workflow",
            resource_id=workflow_id,
            context={"projectId": project_id},
        )
    except Exception:
        logger.warning("Audit write failed for workflow assignment", exc_info=True)

    return {
        "success": True,
        "workflowId": workflow_id,
        "projectId": project_id,
    }


async def remove_workflow_from_project(
    project_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """
    Remove a workflow from a project (clears workflow.collectionId).
    Enforces workspace isolation on the project side.
    """
    project = await ProjectRepository.get_by_id(project_id)
    if not project:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    if project.workspaceId:
        ws = await WorkspaceRepository.get_by_id(project.workspaceId)
        if not ws:
            raise ResourceNotFoundError(f"Project {project_id} not found")
        await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found")

    if workflow.collectionId != project_id:
        raise ResourceNotFoundError(f"Workflow {workflow_id} is not in project {project_id}")

    await WorkflowRepository.update_collection_assignment(workflow_id, None)
    await ProjectRepository.update_workflow_count(project_id)

    try:
        from app.services.audit_service import append_event

        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="project.workflow_removed",
            scope="workspace",
            scope_id=project.workspaceId or "",
            resource_type="workflow",
            resource_id=workflow_id,
            context={"projectId": project_id},
        )
    except Exception:
        logger.warning("Audit write failed for workflow removal", exc_info=True)

    return {
        "success": True,
        "workflowId": workflow_id,
        "projectId": project_id,
    }
