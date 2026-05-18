"""
MCP collection tools.
"""
from typing import Annotated, Any, cast

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.schemas.collections import (
    CollectionAddWorkflowRequest,
    CollectionAddWorkflowResponse,
    CollectionCreateRequest,
    CollectionCreateResponse,
    CollectionDeleteRequest,
    CollectionDeleteResponse,
    CollectionExportRequest,
    CollectionExportResponse,
    CollectionGetRequest,
    CollectionGetResponse,
    CollectionImportDryRunRequest,
    CollectionImportDryRunResponse,
    CollectionImportRequest,
    CollectionImportResponse,
    CollectionListResponse,
    CollectionListWorkflowsResponse,
    CollectionRemoveWorkflowRequest,
    CollectionRemoveWorkflowResponse,
    CollectionSummary,
    CollectionUpdateRequest,
    CollectionUpdateResponse,
)
from app.mcp.tools.workflows import workflow_to_summary
from app.models import CollectionCreate, CollectionUpdate
from app.services.collection_service import (
    add_workflow_to_collection as svc_add_workflow_to_collection,
)
from app.services.collection_service import (
    create_collection as svc_create_collection,
)
from app.services.collection_service import (
    delete_collection as svc_delete_collection,
)
from app.services.collection_service import (
    export_collection as svc_export_collection,
)
from app.services.collection_service import (
    get_collection as svc_get_collection,
)
from app.services.collection_service import (
    import_collection as svc_import_collection,
)
from app.services.collection_service import (
    import_collection_dry_run as svc_import_collection_dry_run,
)
from app.services.collection_service import (
    list_collection_workflows as svc_list_collection_workflows,
)
from app.services.collection_service import (
    list_collections as svc_list_collections,
)
from app.services.collection_service import (
    remove_workflow_from_collection as svc_remove_workflow_from_collection,
)
from app.services.collection_service import (
    update_collection as svc_update_collection,
)


def collection_to_summary(collection: Any) -> CollectionSummary:
    """Convert a collection document-like object into an MCP summary."""
    return CollectionSummary(
        collection_id=getattr(collection, "collectionId"),
        name=getattr(collection, "name"),
        description=getattr(collection, "description", None),
        color=getattr(collection, "color", None),
        workflow_count=getattr(collection, "workflowCount", 0),
        created_at=getattr(collection, "createdAt"),
        updated_at=getattr(collection, "updatedAt"),
    )


async def collection_list() -> CollectionListResponse:
    """List collections with workflow counts."""
    await ensure_mcp_database()
    collections = await svc_list_collections()
    summaries = [collection_to_summary(collection) for collection in collections]
    return CollectionListResponse(collections=summaries, total=len(summaries))


async def collection_list_workflows(
    collection_id: Annotated[str, Field(description="Collection ID to inspect.")],
) -> CollectionListWorkflowsResponse:
    """List workflows assigned to a collection."""
    await ensure_mcp_database()
    try:
        workflows = await svc_list_collection_workflows(collection_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    summaries = [workflow_to_summary(workflow) for workflow in workflows]
    return CollectionListWorkflowsResponse(
        collection_id=collection_id,
        workflows=summaries,
        total=len(summaries),
    )


async def collection_create(
    name: Annotated[str, Field(description="Collection name.")],
    description: Annotated[str | None, Field(description="Collection description.")] = None,
    color: Annotated[str | None, Field(description="Display color (hex).")] = None,
) -> CollectionCreateResponse:
    """Create a new collection for grouping workflows."""
    await ensure_mcp_database()
    request = CollectionCreateRequest(name=name, description=description, color=color)
    created = await svc_create_collection(
        CollectionCreate(name=request.name, description=request.description, color=request.color)
    )
    return CollectionCreateResponse(
        message="Collection created successfully",
        collection=collection_to_summary(created),
    )


async def collection_get(
    collection_id: Annotated[str, Field(description="Collection ID to retrieve.")],
) -> CollectionGetResponse:
    """Get a collection by ID with workflow count."""
    await ensure_mcp_database()
    request = CollectionGetRequest(collection_id=collection_id)
    try:
        collection = await svc_get_collection(request.collection_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionGetResponse(collection=collection_to_summary(collection))


async def collection_update(
    collection_id: Annotated[str, Field(description="Collection ID to update.")],
    name: Annotated[str | None, Field(description="New collection name.")] = None,
    description: Annotated[str | None, Field(description="New description.")] = None,
    color: Annotated[str | None, Field(description="New display color.")] = None,
) -> CollectionUpdateResponse:
    """Update collection metadata."""
    await ensure_mcp_database()
    request = CollectionUpdateRequest(
        collection_id=collection_id,
        name=name,
        description=description,
        color=color,
    )
    update_data: dict[str, Any] = {}
    for source_name, target_name in (
        ("name", "name"),
        ("description", "description"),
        ("color", "color"),
    ):
        value = getattr(request, source_name)
        if value is not None:
            update_data[target_name] = value

    try:
        updated = await svc_update_collection(
            request.collection_id, CollectionUpdate(**update_data)
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionUpdateResponse(
        message="Collection updated successfully",
        collection=collection_to_summary(updated),
    )


async def collection_delete(
    collection_id: Annotated[str, Field(description="Collection ID to delete.")],
) -> CollectionDeleteResponse:
    """Delete a collection. Blocked if any workflows are in it."""
    await ensure_mcp_database()
    request = CollectionDeleteRequest(collection_id=collection_id)
    try:
        await svc_delete_collection(request.collection_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionDeleteResponse(
        message="Collection deleted successfully",
        collection_id=request.collection_id,
    )


async def collection_export(
    collection_id: Annotated[str, Field(description="Collection ID to export.")],
    include_environment: Annotated[
        bool,
        Field(description="Whether to include sanitized environment data."),
    ] = True,
) -> CollectionExportResponse:
    """Export a sanitized collection bundle with all workflows."""
    await ensure_mcp_database()
    request = CollectionExportRequest(
        collection_id=collection_id,
        include_environment=include_environment,
    )
    try:
        bundle = await svc_export_collection(
            request.collection_id,
            include_environment=request.include_environment,
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionExportResponse(bundle=bundle)


async def collection_import(
    bundle: Annotated[dict[str, Any], Field(description="Collection export bundle to import.")],
    create_new_collection: Annotated[
        bool,
        Field(description="Create a new collection instead of importing into an existing one."),
    ] = True,
    new_collection_name: Annotated[
        str | None,
        Field(description="Name for the new collection. Uses bundle name if omitted."),
    ] = None,
    target_collection_id: Annotated[
        str | None,
        Field(description="Existing collection ID to import workflows into."),
    ] = None,
    environment_mapping: Annotated[
        dict[str, str] | None,
        Field(description="Mapping from bundle environment IDs to existing IDs."),
    ] = None,
) -> CollectionImportResponse:
    """Import a collection bundle. Secret-like values are sanitized in the bundle."""
    await ensure_mcp_database()
    request = CollectionImportRequest(
        bundle=bundle,
        create_new_collection=create_new_collection,
        new_collection_name=new_collection_name,
        target_collection_id=target_collection_id,
        environment_mapping=environment_mapping,
    )
    try:
        result = await svc_import_collection(
            request.bundle,
            create_new_collection=request.create_new_collection,
            new_collection_name=request.new_collection_name,
            target_collection_id=request.target_collection_id,
            environment_mapping=request.environment_mapping,
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionImportResponse(
        message=str(result.get("message", "Collection imported successfully")),
        collection_id=str(result.get("collectionId")),
        workflow_count=int(result.get("workflowCount", 0)),
        environment_count=int(result.get("environmentCount", 0)),
        secret_references=list(result.get("secretReferences", [])),
    )


async def collection_import_dry_run(
    bundle: Annotated[dict[str, Any], Field(description="Collection export bundle to validate.")],
    create_new_collection: Annotated[
        bool,
        Field(description="Whether a new collection would be created."),
    ] = True,
    target_collection_id: Annotated[
        str | None,
        Field(description="Existing collection ID to validate import into."),
    ] = None,
) -> CollectionImportDryRunResponse:
    """Validate a collection import bundle without persisting anything."""
    await ensure_mcp_database()
    request = CollectionImportDryRunRequest(
        bundle=bundle,
        create_new_collection=create_new_collection,
        target_collection_id=target_collection_id,
    )
    result = await svc_import_collection_dry_run(
        request.bundle,
        create_new_collection=request.create_new_collection,
        target_collection_id=request.target_collection_id,
    )
    return CollectionImportDryRunResponse(
        valid=bool(result.get("valid", False)),
        errors=list(result.get("errors", [])),
        warnings=list(result.get("warnings", [])),
        stats=cast(dict[str, Any], result.get("stats", {})),
    )


async def collection_add_workflow(
    collection_id: Annotated[str, Field(description="Collection ID to add the workflow to.")],
    workflow_id: Annotated[str, Field(description="Workflow ID to add.")],
) -> CollectionAddWorkflowResponse:
    """Add a workflow to a collection."""
    await ensure_mcp_database()
    request = CollectionAddWorkflowRequest(
        collection_id=collection_id,
        workflow_id=workflow_id,
    )
    try:
        await svc_add_workflow_to_collection(request.collection_id, request.workflow_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionAddWorkflowResponse(
        message="Workflow added to collection",
        collection_id=request.collection_id,
        workflow_id=request.workflow_id,
    )


async def collection_remove_workflow(
    collection_id: Annotated[str, Field(description="Collection ID to remove the workflow from.")],
    workflow_id: Annotated[str, Field(description="Workflow ID to remove.")],
) -> CollectionRemoveWorkflowResponse:
    """Remove a workflow from a collection."""
    await ensure_mcp_database()
    request = CollectionRemoveWorkflowRequest(
        collection_id=collection_id,
        workflow_id=workflow_id,
    )
    try:
        await svc_remove_workflow_from_collection(request.collection_id, request.workflow_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return CollectionRemoveWorkflowResponse(
        message="Workflow removed from collection",
        collection_id=request.collection_id,
        workflow_id=request.workflow_id,
    )


def register_collection_tools(server: FastMCP) -> None:
    """Register collection tools."""
    server.tool(
        name="collection_list",
        description="List workflow collections with workflow counts.",
    )(collection_list)
    server.tool(
        name="collection_list_workflows",
        description="List workflows in a collection by collection ID.",
    )(collection_list_workflows)
    server.tool(
        name="collection_create",
        description="Create a new collection for grouping workflows.",
    )(collection_create)
    server.tool(
        name="collection_get",
        description="Get a collection by ID with workflow count.",
    )(collection_get)
    server.tool(
        name="collection_update",
        description="Update collection metadata (name, description, color).",
    )(collection_update)
    server.tool(
        name="collection_delete",
        description="Delete a collection. Blocked if any workflows are in it.",
    )(collection_delete)
    server.tool(
        name="collection_export",
        description="Export a sanitized collection bundle with all workflows.",
    )(collection_export)
    server.tool(
        name="collection_import",
        description="Import a collection bundle. Secret-like values are sanitized.",
    )(collection_import)
    server.tool(
        name="collection_import_dry_run",
        description="Validate a collection import bundle without persisting anything.",
    )(collection_import_dry_run)
    server.tool(
        name="collection_add_workflow",
        description="Add a workflow to a collection.",
    )(collection_add_workflow)
    server.tool(
        name="collection_remove_workflow",
        description="Remove a workflow from a collection.",
    )(collection_remove_workflow)
