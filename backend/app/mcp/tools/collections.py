"""
MCP collection tools.
"""
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.schemas.collections import (
    CollectionListResponse,
    CollectionListWorkflowsResponse,
    CollectionSummary,
)
from app.mcp.tools.workflows import workflow_to_summary
from app.services.collection_service import (
    list_collection_workflows as svc_list_collection_workflows,
)
from app.services.collection_service import (
    list_collections as svc_list_collections,
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


def register_collection_tools(server: FastMCP) -> None:
    """Register Phase 2 collection read tools."""
    server.tool(
        name="collection_list",
        description="List workflow collections with workflow counts.",
    )(collection_list)
    server.tool(
        name="collection_list_workflows",
        description="List workflows in a collection by collection ID.",
    )(collection_list_workflows)
