"""
MCP workflow tools.
"""
from typing import Annotated, Any, cast

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from app.config import settings
from app.mcp.database import ensure_mcp_database
from app.mcp.datetime_utils import utc_datetime
from app.mcp.schemas.workflows import (
    WorkflowAttachCollectionRequest,
    WorkflowAttachCollectionResponse,
    WorkflowCreateRequest,
    WorkflowDeleteRequest,
    WorkflowDeleteResponse,
    WorkflowDetail,
    WorkflowExportRequest,
    WorkflowExportResponse,
    WorkflowGetRequest,
    WorkflowImportDryRunRequest,
    WorkflowImportDryRunResponse,
    WorkflowImportRequest,
    WorkflowImportResponse,
    WorkflowListRequest,
    WorkflowListResponse,
    WorkflowSetEnvironmentRequest,
    WorkflowSetEnvironmentResponse,
    WorkflowSummary,
    WorkflowUpdateRequest,
)
from app.models import Edge, Node, WorkflowCreate, WorkflowUpdate
from app.services.secret_utils import sanitize_secrets_in_dict
from app.services.workflow_service import (
    attach_to_collection as svc_attach_to_collection,
)
from app.services.workflow_service import (
    create_workflow as svc_create_workflow,
)
from app.services.workflow_service import (
    delete_workflow as svc_delete_workflow,
)
from app.services.workflow_service import (
    export_workflow as svc_export_workflow,
)
from app.services.workflow_service import (
    get_workflow as svc_get_workflow,
)
from app.services.workflow_service import (
    import_workflow as svc_import_workflow,
)
from app.services.workflow_service import (
    import_workflow_dry_run as svc_import_workflow_dry_run,
)
from app.services.workflow_service import (
    list_workflows as svc_list_workflows,
)
from app.services.workflow_service import (
    set_environment as svc_set_environment,
)
from app.services.workflow_service import (
    update_workflow as svc_update_workflow,
)


def _model_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if hasattr(value, "model_dump"):
        dumped = value.model_dump(mode="json")
        if isinstance(dumped, dict):
            return cast(dict[str, Any], dumped)
    if isinstance(value, dict):
        return value
    return cast(dict[str, Any], dict(value))


def workflow_to_summary(workflow: Any) -> WorkflowSummary:
    """Convert a workflow document-like object into an MCP summary."""
    nodes = list(getattr(workflow, "nodes", []) or [])
    edges = list(getattr(workflow, "edges", []) or [])
    templates = list(getattr(workflow, "nodeTemplates", []) or [])
    return WorkflowSummary(
        workflow_id=getattr(workflow, "workflowId"),
        name=getattr(workflow, "name"),
        description=getattr(workflow, "description", None),
        tags=list(getattr(workflow, "tags", []) or []),
        collection_id=getattr(workflow, "collectionId", None),
        environment_id=getattr(workflow, "environmentId", None),
        node_count=len(nodes),
        edge_count=len(edges),
        template_count=len(templates),
        created_at=utc_datetime(getattr(workflow, "createdAt")),
        updated_at=utc_datetime(getattr(workflow, "updatedAt")),
        version=getattr(workflow, "version", 1),
    )


def workflow_to_detail(workflow: Any) -> WorkflowDetail:
    """Convert a workflow document-like object into a redacted MCP detail DTO."""
    summary = workflow_to_summary(workflow)
    secret_refs: list[str] = []

    variables = getattr(workflow, "variables", {}) or {}
    redacted_variables = sanitize_secrets_in_dict(
        cast(dict[str, Any], variables),
        secret_refs,
        "variables",
    )

    nodes: list[dict[str, Any]] = []
    for node in list(getattr(workflow, "nodes", []) or []):
        node_data = _model_to_dict(node)
        config = node_data.get("config")
        if isinstance(config, dict):
            node_id = str(node_data.get("nodeId", "unknown"))
            node_data["config"] = sanitize_secrets_in_dict(
                config,
                secret_refs,
                f"nodes.{node_id}.config",
            )
        nodes.append(node_data)

    edges = [_model_to_dict(edge) for edge in list(getattr(workflow, "edges", []) or [])]
    templates = [
        _model_to_dict(template) if not isinstance(template, dict) else template
        for template in list(getattr(workflow, "nodeTemplates", []) or [])
    ]

    return WorkflowDetail(
        **summary.model_dump(),
        nodes=nodes,
        edges=edges,
        variables=redacted_variables,
        node_templates=templates,
        redacted_secret_references=secret_refs,
    )


async def workflow_list(
    skip: Annotated[int, Field(ge=0, description="Number of workflows to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum workflows to return.")] = 20,
    tag: Annotated[str | None, Field(description="Optional tag filter.")] = None,
    name: Annotated[str | None, Field(description="Optional case-insensitive name search.")] = None,
) -> WorkflowListResponse:
    """List or search workflows with pagination and safe summary output."""
    await ensure_mcp_database()
    request = WorkflowListRequest(skip=skip, limit=limit, tag=tag, name=name)
    page = await svc_list_workflows(
        skip=request.skip,
        limit=request.limit,
        tag=request.tag,
        name=request.name,
    )
    return WorkflowListResponse(
        workflows=[workflow_to_summary(workflow) for workflow in page.workflows],
        total=page.total,
        skip=page.skip,
        limit=page.limit,
        has_more=page.hasMore,
    )


async def workflow_get(
    workflow_id: Annotated[str, Field(description="Workflow ID to retrieve.")],
) -> WorkflowDetail:
    """Get a full workflow definition with secret-like values redacted."""
    await ensure_mcp_database()
    request = WorkflowGetRequest(workflow_id=workflow_id)
    try:
        workflow = await svc_get_workflow(request.workflow_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return workflow_to_detail(workflow)


async def workflow_create(
    name: Annotated[str, Field(description="Workflow name.")],
    description: Annotated[str | None, Field(description="Workflow description.")] = None,
    nodes: Annotated[list[Node] | None, Field(description="Workflow nodes.")] = None,
    edges: Annotated[list[Edge] | None, Field(description="Workflow edges.")] = None,
    variables: Annotated[dict[str, Any] | None, Field(description="Workflow variables.")] = None,
    tags: Annotated[list[str] | None, Field(description="Workflow tags.")] = None,
    node_templates: Annotated[
        list[dict[str, Any]] | None,
        Field(description="Imported node templates for the Add Nodes panel."),
    ] = None,
    collection_id: Annotated[str | None, Field(description="Optional collection ID.")] = None,
) -> WorkflowDetail:
    """Create a workflow from structured nodes and edges."""
    await ensure_mcp_database()
    request = WorkflowCreateRequest(
        name=name,
        description=description,
        nodes=nodes or [],
        edges=edges or [],
        variables=variables or {},
        tags=tags or [],
        node_templates=node_templates or [],
        collection_id=collection_id,
    )
    created = await svc_create_workflow(
        WorkflowCreate(
            name=request.name,
            description=request.description,
            nodes=request.nodes,
            edges=request.edges,
            variables=request.variables,
            tags=request.tags,
            nodeTemplates=request.node_templates,
            collectionId=request.collection_id,
        )
    )
    return workflow_to_detail(created)


async def workflow_update(
    workflow_id: Annotated[str, Field(description="Workflow ID to update.")],
    name: Annotated[str | None, Field(description="New workflow name.")] = None,
    description: Annotated[str | None, Field(description="New workflow description.")] = None,
    nodes: Annotated[list[Node] | None, Field(description="Replacement workflow nodes.")] = None,
    edges: Annotated[list[Edge] | None, Field(description="Replacement workflow edges.")] = None,
    variables: Annotated[dict[str, Any] | None, Field(description="Replacement variables.")] = None,
    tags: Annotated[list[str] | None, Field(description="Replacement tags.")] = None,
    node_templates: Annotated[
        list[dict[str, Any]] | None,
        Field(description="Replacement imported node templates."),
    ] = None,
) -> WorkflowDetail:
    """Update workflow metadata, nodes, edges, variables, tags, or templates."""
    await ensure_mcp_database()
    request = WorkflowUpdateRequest(
        workflow_id=workflow_id,
        name=name,
        description=description,
        nodes=nodes,
        edges=edges,
        variables=variables,
        tags=tags,
        node_templates=node_templates,
    )
    update_data: dict[str, Any] = {}
    for source_name, target_name in (
        ("name", "name"),
        ("description", "description"),
        ("nodes", "nodes"),
        ("edges", "edges"),
        ("variables", "variables"),
        ("tags", "tags"),
        ("node_templates", "nodeTemplates"),
    ):
        value = getattr(request, source_name)
        if value is not None:
            update_data[target_name] = value

    try:
        updated = await svc_update_workflow(request.workflow_id, WorkflowUpdate(**update_data))
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return workflow_to_detail(updated)


async def workflow_export(
    workflow_id: Annotated[str, Field(description="Workflow ID to export.")],
    include_environment: Annotated[
        bool,
        Field(description="Whether to include a sanitized environment bundle."),
    ] = True,
) -> WorkflowExportResponse:
    """Export a sanitized workflow bundle; persisted secrets are never returned."""
    await ensure_mcp_database()
    request = WorkflowExportRequest(
        workflow_id=workflow_id,
        include_environment=include_environment,
    )
    try:
        bundle = await svc_export_workflow(
            request.workflow_id,
            include_environment=request.include_environment,
            app_version=settings.VERSION,
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return WorkflowExportResponse(bundle=bundle)


async def workflow_import(
    bundle: Annotated[dict[str, Any], Field(description="Workflow export bundle to import.")],
    environment_mapping: Annotated[
        dict[str, str] | None,
        Field(description="Optional mapping from bundle environment IDs to existing IDs."),
    ] = None,
    create_missing_environments: Annotated[
        bool,
        Field(description="Create bundled environments missing locally."),
    ] = True,
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values before persisting."),
    ] = True,
) -> WorkflowImportResponse:
    """Import a workflow bundle through shared services with sanitization enabled by default."""
    await ensure_mcp_database()
    request = WorkflowImportRequest(
        bundle=bundle,
        environment_mapping=environment_mapping,
        create_missing_environments=create_missing_environments,
        sanitize=sanitize,
    )
    try:
        result = await svc_import_workflow(
            request.bundle,
            environment_mapping=request.environment_mapping,
            create_missing_environments=request.create_missing_environments,
            sanitize=request.sanitize,
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return WorkflowImportResponse(
        message=str(result.get("message", "Workflow imported successfully")),
        workflow_id=str(result.get("workflowId")),
        environment_id=cast(str | None, result.get("environmentId")),
        secret_references=list(result.get("secretReferences", [])),
    )


async def workflow_import_dry_run(
    bundle: Annotated[dict[str, Any], Field(description="Workflow export bundle to validate.")],
) -> WorkflowImportDryRunResponse:
    """Validate a workflow import bundle without persisting anything."""
    await ensure_mcp_database()
    request = WorkflowImportDryRunRequest(bundle=bundle)
    result = await svc_import_workflow_dry_run(request.bundle)
    return WorkflowImportDryRunResponse(
        valid=bool(result.get("valid", False)),
        errors=list(result.get("errors", [])),
        warnings=list(result.get("warnings", [])),
        stats=cast(dict[str, Any], result.get("stats", {})),
    )


async def workflow_delete(
    workflow_id: Annotated[str, Field(description="Workflow ID to delete.")],
) -> WorkflowDeleteResponse:
    """Delete a workflow. This action is destructive and cannot be undone."""
    await ensure_mcp_database()
    request = WorkflowDeleteRequest(workflow_id=workflow_id)
    try:
        await svc_delete_workflow(request.workflow_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return WorkflowDeleteResponse(
        message="Workflow deleted successfully",
        workflow_id=request.workflow_id,
    )


async def workflow_attach_collection(
    workflow_id: Annotated[str, Field(description="Workflow ID to modify.")],
    collection_id: Annotated[
        str | None,
        Field(description="Collection ID to attach to, or null to detach."),
    ] = None,
) -> WorkflowAttachCollectionResponse:
    """Attach or detach a workflow to/from a collection."""
    await ensure_mcp_database()
    request = WorkflowAttachCollectionRequest(
        workflow_id=workflow_id,
        collection_id=collection_id,
    )
    try:
        updated = await svc_attach_to_collection(request.workflow_id, request.collection_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return WorkflowAttachCollectionResponse(
        message="Workflow collection assignment updated",
        workflow_id=request.workflow_id,
        collection_id=getattr(updated, "collectionId", None),
    )


async def workflow_set_environment(
    workflow_id: Annotated[str, Field(description="Workflow ID to modify.")],
    environment_id: Annotated[
        str | None,
        Field(description="Environment ID to assign, or null to clear."),
    ] = None,
) -> WorkflowSetEnvironmentResponse:
    """Assign or clear the default environment for a workflow."""
    await ensure_mcp_database()
    request = WorkflowSetEnvironmentRequest(
        workflow_id=workflow_id,
        environment_id=environment_id,
    )
    try:
        updated = await svc_set_environment(request.workflow_id, request.environment_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return WorkflowSetEnvironmentResponse(
        message="Workflow environment updated",
        workflow_id=request.workflow_id,
        environment_id=getattr(updated, "environmentId", None),
    )


def register_workflow_tools(server: FastMCP) -> None:
    """Register workflow tools."""
    server.tool(
        name="workflow_list",
        description=(
            "List or search workflows with pagination. Use this before reading or "
            "updating a workflow; only summary metadata is returned."
        ),
    )(workflow_list)
    server.tool(
        name="workflow_get",
        description="Get a full workflow definition by ID with secret-like values redacted.",
    )(workflow_get)
    server.tool(
        name="workflow_create",
        description=(
            "Create a workflow from structured nodes, edges, variables, tags, and templates."
        ),
    )(workflow_create)
    server.tool(
        name="workflow_update",
        description="Update workflow metadata, nodes, edges, variables, tags, or templates.",
    )(workflow_update)
    server.tool(
        name="workflow_export",
        description="Export a sanitized workflow bundle; persisted secrets are never returned.",
    )(workflow_export)
    server.tool(
        name="workflow_import",
        description="Import a workflow bundle. Secret-like values are sanitized by default.",
    )(workflow_import)
    server.tool(
        name="workflow_import_dry_run",
        description="Validate a workflow import bundle without creating or updating records.",
    )(workflow_import_dry_run)
    server.tool(
        name="workflow_delete",
        description="Delete a workflow permanently. This action cannot be undone.",
    )(workflow_delete)
    server.tool(
        name="workflow_attach_collection",
        description="Attach or detach a workflow to/from a collection.",
    )(workflow_attach_collection)
    server.tool(
        name="workflow_set_environment",
        description="Assign or clear the default environment for a workflow.",
    )(workflow_set_environment)
