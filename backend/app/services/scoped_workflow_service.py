"""
Scoped Workflow Service — workspace-scoped workflow CRUD, run, import/export, templates.

All workflow operations are scoped to a workspace. A user can only
access workflows within workspaces they have access to.
"""

import logging
import uuid
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
    include_attached: bool = False,
) -> dict[str, Any]:
    """
    List workflows in a workspace.

    - project_id set: only that project's workflows.
    - include_attached=True (Projects view): every workflow, so the UI can
      group them under projects.
    - default (Workflows tab): only workflows not attached to a project.
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
            workspace_id, skip, limit, include_attached=include_attached
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


# ============================================================================
# Workspace Access Helper
# ============================================================================


async def _verify_workspace_and_workflow(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> Workflow:
    """Verify workspace access and that workflow belongs to workspace. Returns workflow."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    workflow = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
    if not workflow:
        raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")
    return workflow


# ============================================================================
# Scoped Run Trigger
# ============================================================================


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


# ============================================================================
# Scoped Run Status / Latest Failed / Node Result
# ============================================================================


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


# ============================================================================
# Scoped Export / Import
# ============================================================================


async def export_scoped_workflow(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
    include_environment: bool = True,
    app_version: str = "0.1.0",
) -> dict[str, Any]:
    """Export a workflow bundle, scoped to workspace."""
    await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)

    from app.services.workflow_service import export_workflow

    return await export_workflow(
        workflow_id,
        include_environment=include_environment,
        app_version=app_version,
    )


async def import_scoped_workflow(
    workspace_id: str,
    bundle: dict[str, Any],
    actor_user_id: str,
    environment_mapping: dict[str, str] | None = None,
    create_missing_environments: bool = True,
    sanitize: bool = False,
) -> dict[str, Any]:
    """Import a workflow bundle into a workspace."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.workflow_service import import_workflow

    result = await import_workflow(
        bundle,
        environment_mapping=environment_mapping,
        create_missing_environments=create_missing_environments,
        sanitize=sanitize,
    )

    # Set workspace ownership on the created workflow
    created_workflow_id = result.get("workflowId")
    if created_workflow_id:
        wf = await WorkflowRepository.get_by_id(created_workflow_id)
        if wf:
            wf.workspaceId = workspace_id
            wf.orgId = ws.orgId
            wf.ownerType = ws.ownerType
            wf.updatedAt = datetime.now(UTC)
            await wf.save()

    return result


async def import_scoped_workflow_dry_run(
    bundle: dict[str, Any],
) -> dict[str, Any]:
    """Validate a workflow bundle without persisting (no workspace needed)."""
    from app.services.workflow_service import import_workflow_dry_run

    return await import_workflow_dry_run(bundle)


# ============================================================================
# Scoped HAR / OpenAPI / Curl Import
# ============================================================================


async def import_scoped_har(
    workspace_id: str,
    har_data: dict[str, Any],
    actor_user_id: str,
    import_mode: str = "linear",
    sanitize: bool = True,
    parse_only: bool = False,
    environment_id: str | None = None,
) -> dict[str, Any]:
    """Import HAR data into a workspace or preview it."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.import_service import parse_har_to_workflow

    workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)

    if parse_only:
        http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
        return {
            "nodes": http_nodes,
            "stats": {
                "totalRequests": len(http_nodes),
                "importMode": import_mode,
            },
        }

    workflow_create = WorkflowCreate(
        name=workflow_data["name"],
        description=workflow_data["description"],
        nodes=workflow_data["nodes"],
        edges=workflow_data["edges"],
        variables=workflow_data.get("variables", {}),
        tags=workflow_data.get("tags", []),
        collectionId=None,
        nodeTemplates=[],
    )
    created = await WorkflowRepository.create_scoped(
        workflow_data=workflow_create,
        workspace_id=workspace_id,
        org_id=ws.orgId,
        owner_type=ws.ownerType,
    )
    if environment_id:
        created.environmentId = environment_id
        created.updatedAt = datetime.now(UTC)
        await created.save()

    return {
        "message": "HAR file imported successfully",
        "workflowId": created.workflowId,
        "stats": {
            "totalRequests": len(workflow_data["nodes"]) - 2,
            "importMode": import_mode,
        },
    }


async def import_scoped_har_dry_run(
    workspace_id: str,
    har_data: dict[str, Any],
    actor_user_id: str,
    import_mode: str = "linear",
    sanitize: bool = True,
) -> dict[str, Any]:
    """Preview HAR import without persisting."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.import_service import parse_har_to_workflow

    workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
    return {
        "message": "HAR preview generated successfully",
        "workflow": {
            "name": workflow_data["name"],
            "description": workflow_data["description"],
            "nodeCount": len(workflow_data["nodes"]),
            "edgeCount": len(workflow_data["edges"]),
        },
        "stats": {
            "totalRequests": len(workflow_data["nodes"]) - 2,
            "importMode": import_mode,
            "entries": len(har_data.get("log", {}).get("entries", [])),
        },
        "nodes": workflow_data["nodes"],
        "edges": workflow_data["edges"],
    }


async def import_scoped_openapi(
    workspace_id: str,
    openapi_data: dict[str, Any],
    actor_user_id: str,
    base_url: str = "",
    tag_filter: str | None = None,
    sanitize: bool = True,
    parse_only: bool = False,
) -> dict[str, Any]:
    """Import OpenAPI data into a workspace or preview it."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.import_service import parse_openapi_to_workflow

    tags = tag_filter.split(",") if tag_filter else None
    workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)

    if parse_only:
        http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
        return {
            "nodes": http_nodes,
            "stats": {
                "totalEndpoints": len(http_nodes),
                "apiTitle": openapi_data.get("info", {}).get("title", "API"),
            },
        }

    workflow_create = WorkflowCreate(
        name=workflow_data["name"],
        description=workflow_data["description"],
        nodes=workflow_data["nodes"],
        edges=workflow_data["edges"],
        variables=workflow_data.get("variables", {}),
        tags=workflow_data.get("tags", []),
        collectionId=None,
        nodeTemplates=[],
    )
    created = await WorkflowRepository.create_scoped(
        workflow_data=workflow_create,
        workspace_id=workspace_id,
        org_id=ws.orgId,
        owner_type=ws.ownerType,
    )
    return {
        "message": "OpenAPI file imported successfully",
        "workflowId": created.workflowId,
        "stats": {
            "totalEndpoints": len(workflow_data["nodes"]) - 2,
            "apiTitle": openapi_data.get("info", {}).get("title", "API"),
        },
    }


async def import_scoped_openapi_dry_run(
    workspace_id: str,
    openapi_data: dict[str, Any],
    actor_user_id: str,
    base_url: str = "",
    tag_filter: str | None = None,
    sanitize: bool = True,
) -> dict[str, Any]:
    """Preview OpenAPI import without persisting."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.import_service import parse_openapi_to_workflow

    tags = tag_filter.split(",") if tag_filter else None
    workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)

    available_tags = []
    for tag in openapi_data.get("tags", []):
        available_tags.append(
            {"name": tag.get("name", ""), "description": tag.get("description", "")}
        )

    available_servers = []
    for server in openapi_data.get("servers", []):
        available_servers.append(
            {"url": server.get("url", ""), "description": server.get("description", "")}
        )

    return {
        "message": "OpenAPI preview generated successfully",
        "workflow": {
            "name": workflow_data["name"],
            "description": workflow_data["description"],
            "nodeCount": len(workflow_data["nodes"]),
            "edgeCount": len(workflow_data["edges"]),
        },
        "stats": {
            "totalEndpoints": len(workflow_data["nodes"]) - 2,
            "apiTitle": openapi_data.get("info", {}).get("title", "API"),
            "apiVersion": openapi_data.get("info", {}).get("version", ""),
        },
        "nodes": workflow_data["nodes"],
        "edges": workflow_data["edges"],
        "availableTags": available_tags,
        "availableServers": available_servers,
    }


async def import_scoped_curl(
    workspace_id: str,
    curl_command: str,
    actor_user_id: str,
    sanitize: bool = True,
    workflow_id: str | None = None,
    parse_only: bool = False,
) -> dict[str, Any]:
    """Import curl command(s) into a workspace or preview."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.import_service import parse_curl_to_workflow

    workflow_data = parse_curl_to_workflow(curl_command, sanitize)

    if parse_only:
        http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
        return {
            "nodes": http_nodes,
            "stats": {"totalRequests": len(http_nodes), "importType": "curl"},
        }

    if workflow_id:
        existing = await WorkflowRepository.get_by_id_in_workspace(workflow_id, workspace_id)
        if not existing:
            raise ResourceNotFoundError(f"Workflow {workflow_id} not found in workspace")

        imported_nodes = [n for n in workflow_data["nodes"] if n["type"] not in ("start", "end")]
        imported_edges = list(workflow_data["edges"])

        node_id_map: dict[str, str] = {}
        for node in imported_nodes:
            old_id = node["nodeId"]
            new_id = str(uuid.uuid4())
            node_id_map[old_id] = new_id
            node["nodeId"] = new_id
        for edge in imported_edges:
            if edge["source"] in node_id_map:
                edge["source"] = node_id_map[edge["source"]]
            if edge["target"] in node_id_map:
                edge["target"] = node_id_map[edge["target"]]
            edge["edgeId"] = str(uuid.uuid4())

        existing_positions = [
            n.position for n in existing.nodes if n.position and len(n.position) > 0
        ]
        if existing_positions:
            max_x = max(pos.get("x", 0) for pos in existing_positions)
        else:
            max_x = 0
        x_offset = max_x + 100 if existing_positions else 600
        for node in imported_nodes:
            if "position" in node and isinstance(node["position"], dict):
                node["position"]["x"] = node["position"].get("x", 0) + x_offset

        existing_nodes_dicts = [
            n.model_dump() if hasattr(n, "model_dump") else n for n in existing.nodes
        ]
        existing_edges_dicts = [
            e.model_dump() if hasattr(e, "model_dump") else e for e in existing.edges
        ]
        updated_nodes = existing_nodes_dicts + imported_nodes
        updated_edges = existing_edges_dicts + imported_edges

        await WorkflowRepository.update(
            workflow_id,
            WorkflowUpdate(nodes=updated_nodes, edges=updated_edges),
        )
        return {
            "message": f"Curl commands imported and appended to workflow {workflow_id}",
            "workflowId": workflow_id,
            "stats": {"totalRequests": len(imported_nodes), "importType": "curl"},
        }

    workflow_create = WorkflowCreate(
        name=workflow_data["name"],
        description=workflow_data["description"],
        nodes=workflow_data["nodes"],
        edges=workflow_data["edges"],
        variables=workflow_data.get("variables", {}),
        tags=workflow_data.get("tags", []),
        collectionId=None,
        nodeTemplates=[],
    )
    created = await WorkflowRepository.create_scoped(
        workflow_data=workflow_create,
        workspace_id=workspace_id,
        org_id=ws.orgId,
        owner_type=ws.ownerType,
    )
    return {
        "message": "Curl commands imported successfully",
        "workflowId": created.workflowId,
        "stats": {
            "totalRequests": len(workflow_data["nodes"]) - 2,
            "importType": "curl",
        },
    }


async def import_scoped_curl_dry_run(
    workspace_id: str,
    curl_command: str,
    actor_user_id: str,
    sanitize: bool = True,
) -> dict[str, Any]:
    """Preview curl import without persisting."""
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    from app.services.import_service import parse_curl_to_workflow

    workflow_data = parse_curl_to_workflow(curl_command, sanitize)
    return {
        "message": "Curl preview generated successfully",
        "workflow": {
            "name": workflow_data["name"],
            "description": workflow_data["description"],
            "nodeCount": len(workflow_data["nodes"]),
            "edgeCount": len(workflow_data["edges"]),
        },
        "stats": {
            "totalRequests": len(workflow_data["nodes"]) - 2,
            "importType": "curl",
        },
        "nodes": workflow_data["nodes"],
        "edges": workflow_data["edges"],
    }


# ============================================================================
# Scoped Templates
# ============================================================================


async def get_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Get node templates for a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    return {
        "workflowId": workflow_id,
        "templates": workflow.nodeTemplates or [],
    }


async def add_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
    templates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Add node templates to a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    existing = workflow.nodeTemplates or []
    updated = existing + templates
    workflow.nodeTemplates = updated
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return {
        "message": f"Added {len(templates)} template(s) to workflow",
        "workflowId": workflow_id,
        "totalTemplates": len(updated),
    }


async def replace_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
    templates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Replace all node templates for a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    workflow.nodeTemplates = templates
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return {
        "message": "Templates replaced successfully",
        "workflowId": workflow_id,
        "totalTemplates": len(templates),
    }


async def clear_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Clear all node templates for a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    workflow.nodeTemplates = []
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return {
        "message": "Templates cleared successfully",
        "workflowId": workflow_id,
    }
