"""
Scoped Import/Export — workflow bundle export/import, HAR/OpenAPI/curl import.

Names that tests monkeypatch (``WorkspaceRepository``, ``WorkflowRepository``,
``_assert_workspace_access``) are looked up lazily inside each function via
``from . import X`` so patches applied to the package are observed at call time.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from . import ResourceNotFoundError, WorkflowCreate, WorkflowUpdate, _verify_workspace_and_workflow


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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkspaceRepository, _assert_workspace_access

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
    from . import WorkflowRepository, WorkspaceRepository, _assert_workspace_access

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
    from . import WorkspaceRepository, _assert_workspace_access

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
