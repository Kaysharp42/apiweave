"""
MCP workflow tools — scoped to workspace via service token.

All workflow operations are scoped to the workspace identified by the
authenticated service token. Cross-workspace access is denied.
"""

from typing import Annotated, Any, cast

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from app.config import settings
from app.mcp.database import ensure_mcp_database
from app.mcp.datetime_utils import utc_datetime
from app.mcp.schemas.workflows import (
    WorkflowAttachCollectionResponse,
    WorkflowDeleteResponse,
    WorkflowDetail,
    WorkflowExportResponse,
    WorkflowImportDryRunResponse,
    WorkflowImportResponse,
    WorkflowListResponse,
    WorkflowSetEnvironmentResponse,
    WorkflowSummary,
)
from app.mcp.scope_context import require_scope
from app.models import Edge, Node, WorkflowCreate, WorkflowUpdate
from app.services.scoped_workflow_service import (
    create_scoped_workflow,
    delete_scoped_workflow,
    get_scoped_workflow,
    list_scoped_workflows,
    update_scoped_workflow,
)
from app.services.secret_utils import sanitize_secrets_in_dict


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


def _workflow_dict_to_summary(workflow: dict[str, Any]) -> WorkflowSummary:
    """Convert a scoped workflow response dict into an MCP summary."""
    nodes = list(workflow.get("nodes", []) or [])
    edges = list(workflow.get("edges", []) or [])
    return WorkflowSummary(
        workflow_id=workflow["workflowId"],
        name=workflow["name"],
        description=workflow.get("description"),
        tags=list(workflow.get("tags", []) or []),
        collection_id=workflow.get("projectId"),
        environment_id=workflow.get("selectedEnvironmentId"),
        node_count=len(nodes),
        edge_count=len(edges),
        template_count=0,
        created_at=utc_datetime(workflow.get("createdAt")),
        updated_at=utc_datetime(workflow.get("updatedAt")),
        version=workflow.get("version", 1),
    )


# Public alias for cross-module use (collections.py)
workflow_to_summary = _workflow_dict_to_summary


def _workflow_dict_to_detail(workflow: dict[str, Any]) -> WorkflowDetail:
    """Convert a scoped workflow response dict into a redacted MCP detail DTO."""
    summary = _workflow_dict_to_summary(workflow)
    secret_refs: list[str] = []

    variables = workflow.get("variables", {}) or {}
    redacted_variables = sanitize_secrets_in_dict(
        cast(dict[str, Any], variables),
        secret_refs,
        "variables",
    )

    nodes: list[dict[str, Any]] = []
    for node in list(workflow.get("nodes", []) or []):
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

    edges = [_model_to_dict(edge) for edge in list(workflow.get("edges", []) or [])]

    return WorkflowDetail(
        **summary.model_dump(),
        nodes=nodes,
        edges=edges,
        variables=redacted_variables,
        node_templates=[],
        redacted_secret_references=secret_refs,
    )


async def workflow_list(
    skip: Annotated[int, Field(ge=0, description="Number of workflows to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum workflows to return.")] = 20,
    tag: Annotated[str | None, Field(description="Optional tag filter.")] = None,
    name: Annotated[str | None, Field(description="Optional case-insensitive name search.")] = None,
) -> WorkflowListResponse:
    """List workflows scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    result = await list_scoped_workflows(
        workspace_id=workspace_id,
        actor_user_id=scope.actor_id,
        skip=skip,
        limit=limit,
    )

    workflows = [_workflow_dict_to_summary(wf) for wf in result.get("workflows", [])]

    # Apply client-side tag/name filters
    if tag:
        workflows = [w for w in workflows if tag in w.tags]
    if name:
        name_lower = name.lower()
        workflows = [w for w in workflows if name_lower in w.name.lower()]

    return WorkflowListResponse(
        workflows=workflows,
        total=result.get("total", len(workflows)),
        skip=skip,
        limit=limit,
        has_more=result.get("hasMore", False),
    )


async def workflow_get(
    workflow_id: Annotated[str, Field(description="Workflow ID to retrieve.")],
) -> WorkflowDetail:
    """Get a workflow scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    try:
        workflow = await get_scoped_workflow(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return _workflow_dict_to_detail(workflow)


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
    collection_id: Annotated[str | None, Field(description="Optional project ID.")] = None,
) -> WorkflowDetail:
    """Create a workflow scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    try:
        result = await create_scoped_workflow(
            workspace_id=workspace_id,
            workflow_data=WorkflowCreate(
                name=name,
                description=description,
                nodes=nodes or [],
                edges=edges or [],
                variables=variables or {},
                tags=tags or [],
                nodeTemplates=node_templates or [],
                collectionId=collection_id,
            ),
            actor_user_id=scope.actor_id,
            project_id=collection_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return _workflow_dict_to_detail(result)


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
    """Update a workflow scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    update_data: dict[str, Any] = {}
    if name is not None:
        update_data["name"] = name
    if description is not None:
        update_data["description"] = description
    if nodes is not None:
        update_data["nodes"] = nodes
    if edges is not None:
        update_data["edges"] = edges
    if variables is not None:
        update_data["variables"] = variables
    if tags is not None:
        update_data["tags"] = tags
    if node_templates is not None:
        update_data["nodeTemplates"] = node_templates

    try:
        result = await update_scoped_workflow(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            update_data=WorkflowUpdate(**update_data),
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return _workflow_dict_to_detail(result)


async def workflow_export(
    workflow_id: Annotated[str, Field(description="Workflow ID to export.")],
    include_environment: Annotated[
        bool,
        Field(description="Whether to include a sanitized environment bundle."),
    ] = True,
) -> WorkflowExportResponse:
    """Export a sanitized workflow bundle scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()

    # Verify workflow belongs to scope
    from app.services.scoped_workflow_service import get_scoped_workflow

    try:
        await get_scoped_workflow(
            workspace_id=scope.scope_id,
            workflow_id=workflow_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    # Use existing export service (secrets are already sanitized)
    from app.services.workflow_service import export_workflow

    try:
        bundle = await export_workflow(
            workflow_id,
            include_environment=include_environment,
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
    """Import a workflow bundle into the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    from app.services.workflow_service import import_workflow

    try:
        result = await import_workflow(
            bundle,
            environment_mapping=environment_mapping,
            create_missing_environments=create_missing_environments,
            sanitize=sanitize,
            workspace_id=scope.scope_id,
            actor_user_id=scope.actor_id,
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
    from app.services.workflow_service import import_workflow_dry_run

    result = await import_workflow_dry_run(bundle)
    return WorkflowImportDryRunResponse(
        valid=bool(result.get("valid", False)),
        errors=list(result.get("errors", [])),
        warnings=list(result.get("warnings", [])),
        stats=cast(dict[str, Any], result.get("stats", {})),
    )


async def workflow_delete(
    workflow_id: Annotated[str, Field(description="Workflow ID to delete.")],
) -> WorkflowDeleteResponse:
    """Delete a workflow scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    try:
        await delete_scoped_workflow(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return WorkflowDeleteResponse(
        message="Workflow deleted successfully",
        workflow_id=workflow_id,
    )


async def workflow_attach_collection(
    workflow_id: Annotated[str, Field(description="Workflow ID to modify.")],
    collection_id: Annotated[
        str | None,
        Field(description="Project ID to attach to, or null to detach."),
    ] = None,
) -> WorkflowAttachCollectionResponse:
    """Attach or detach a workflow to/from a project (scoped)."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    from app.services.scoped_workflow_service import get_scoped_workflow

    try:
        await get_scoped_workflow(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    from app.models import Workflow

    wf = await Workflow.get(workflow_id)
    if wf:
        wf.collectionId = collection_id
        from datetime import UTC, datetime

        wf.updatedAt = datetime.now(UTC)
        await wf.save()

    return WorkflowAttachCollectionResponse(
        message="Workflow project assignment updated",
        workflow_id=workflow_id,
        collection_id=collection_id,
    )


async def workflow_set_environment(
    workflow_id: Annotated[str, Field(description="Workflow ID to modify.")],
    environment_id: Annotated[
        str | None,
        Field(description="Environment ID to assign, or null to clear."),
    ] = None,
) -> WorkflowSetEnvironmentResponse:
    """Assign or clear the default environment for a workflow (scoped)."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    from app.services.scoped_workflow_service import get_scoped_workflow

    try:
        await get_scoped_workflow(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    from app.models import Workflow

    wf = await Workflow.get(workflow_id)
    if wf:
        wf.selectedEnvironmentId = environment_id
        from datetime import UTC, datetime

        wf.updatedAt = datetime.now(UTC)
        await wf.save()

    return WorkflowSetEnvironmentResponse(
        message="Workflow environment updated",
        workflow_id=workflow_id,
        environment_id=environment_id,
    )


WORKFLOW_GRAMMAR_REFERENCE = """

Node types (each node has type-specific `config`):
  start / end           {}  (control flow boundaries)
  http-request          {method, url, headers, queryParams, pathVariables, cookies, body,
                         timeout, followRedirects, extractors, fileUploads}
  assertion             {assertions: [{field, operator, expected}, ...]}
  delay                 {duration} in milliseconds
  merge                 {mergeStrategy: "all"|"any"|"first"|"conditional", conditions?}
  condition             {condition, operator, value}

Placeholder grammar (resolved before each node runs):
  {{variables.NAME}}    workflow-scoped; written by HTTP extractors or the Variables panel
  {{env.NAME}}          from the selected environment
  {{prev.PATH}}         previous node's response. Use prev.response.body.id or flat keys
                        like prev.statusCode, prev.headers; prev[INDEX].PATH after a Merge node
  {{secrets.NAME}}      scope override chain: env > workspace > org > bound user
  {{nodeId.PATH}}       reference any node by its ID (e.g. node_abc123.response.body.id);
                        works for non-adjacent nodes, not just the immediate predecessor

Path syntax: dot-separated keys with [N] array indexing only. No JSONPath features
($, .., *, filters) — those silently resolve to empty.

SECURITY: URL, query params, and path variables BLOCK {{secrets.*}} placeholders
(raises ValueError). Use secrets only in body, headers, cookies, or auth fields.

Dynamic functions (callable inside any {{...}}):
  uuid(), randomString(length=10), randomAlpha(length=10), randomNumeric(length=10),
  randomHex(length=16), randomEmail(), randomNumber(size=6), randomChoice("a,b,c"),
  timestamp(), iso_timestamp(), date(format="%Y-%m-%d"),
  futureDate(days=1, format="%Y-%m-%d"), pastDate(days=1, format="%Y-%m-%d").

HTTP-request extractors write workflow variables from responses. Shape is dict[str, str]
mapping variable name to dot-notation path. Example:
  extractors: {"token": "response.body.access_token"}
Then any later node can use Authorization: Bearer {{variables.token}}.

Reference docs (read via resources/read):
  apiweave://docs/placeholders               full grammar + edge cases
  apiweave://docs/dynamic-functions          all 13 functions with signatures
  apiweave://docs/variables-and-extractors   extractor recipes
  apiweave://docs/workflows-and-nodes        per-node-type field reference
  apiweave://docs/environments-and-secrets   override chain + write-only secret model

Call mcp_describe_capabilities for the full machine-readable catalog.
"""


def register_workflow_tools(server: FastMCP) -> None:
    """Register scoped workflow tools."""
    server.tool(
        name="workflow_list",
        description=(
            "List workflows scoped to the authenticated workspace. "
            "Cross-workspace access is denied."
        ),
    )(workflow_list)
    server.tool(
        name="workflow_get",
        description=(
            "Get a workflow scoped to the authenticated workspace. Secrets are redacted "
            "to <SECRET>; the redacted_secret_references list tells you which paths were "
            "redacted so you can re-apply them via {{secrets.NAME}} placeholders."
            + WORKFLOW_GRAMMAR_REFERENCE
        ),
    )(workflow_get)
    server.tool(
        name="workflow_create",
        description=(
            "Create a workflow in the authenticated workspace."
            + WORKFLOW_GRAMMAR_REFERENCE
        ),
    )(workflow_create)
    server.tool(
        name="workflow_update",
        description=(
            "Update a workflow scoped to the authenticated workspace. Only the fields you "
            "pass replace the stored values; omitted fields are left unchanged. To clear a "
            "field, pass an empty list/dict (None means 'leave alone')."
            + WORKFLOW_GRAMMAR_REFERENCE
        ),
    )(workflow_update)
    server.tool(
        name="workflow_export",
        description="Export a sanitized workflow bundle from the authenticated workspace.",
    )(workflow_export)
    server.tool(
        name="workflow_import",
        description=(
            "Import a workflow bundle into the authenticated workspace. The bundle has "
            "shape {workflow: {name, nodes, edges, variables, ...}, environment?, ...}. "
            "Call workflow_import_dry_run first to surface validation errors without "
            "persisting anything."
            + WORKFLOW_GRAMMAR_REFERENCE
        ),
    )(workflow_import)
    server.tool(
        name="workflow_import_dry_run",
        description="Validate a workflow import bundle without creating or updating records.",
    )(workflow_import_dry_run)
    server.tool(
        name="workflow_delete",
        description="Delete a workflow in the authenticated workspace.",
    )(workflow_delete)
    server.tool(
        name="workflow_attach_collection",
        description="Attach or detach a workflow to/from a project (scoped).",
    )(workflow_attach_collection)
    server.tool(
        name="workflow_set_environment",
        description="Assign or clear the default environment for a workflow (scoped).",
    )(workflow_set_environment)
