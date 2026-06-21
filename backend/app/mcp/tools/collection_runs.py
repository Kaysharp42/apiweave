"""
MCP collection-run read tools — stable read-only surface based on readiness gate.

T7 decision: GO for read-only (list/get/latest), NO-GO for execution.
"""

from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.datetime_utils import utc_datetime
from app.repositories import CollectionRunRepository


class CollectionRunSummary:
    def __init__(self, run: Any):
        self.collection_run_id = getattr(run, "collectionRunId")
        self.collection_id = getattr(run, "collectionId")
        self.collection_name = getattr(run, "collectionName")
        self.status = getattr(run, "status")
        self.start_time = utc_datetime(getattr(run, "startTime"))
        self.end_time = utc_datetime(getattr(run, "endTime", None))
        self.duration_ms = getattr(run, "duration", None)
        self.total_workflows = getattr(run, "totalWorkflows", 0)
        self.executed_workflows = getattr(run, "executedWorkflows", 0)
        self.passed_workflows = getattr(run, "passedWorkflows", 0)
        self.failed_workflows = getattr(run, "failedWorkflows", 0)
        self.webhook_id = getattr(run, "webhookId", None)

    def to_dict(self) -> dict:
        return {
            "collectionRunId": self.collection_run_id,
            "collectionId": self.collection_id,
            "collectionName": self.collection_name,
            "status": self.status,
            "startTime": self.start_time,
            "endTime": self.end_time,
            "durationMs": self.duration_ms,
            "totalWorkflows": self.total_workflows,
            "executedWorkflows": self.executed_workflows,
            "passedWorkflows": self.passed_workflows,
            "failedWorkflows": self.failed_workflows,
            "webhookId": self.webhook_id,
        }


async def collection_run_list(
    collection_id: Annotated[str, Field(description="Collection ID to list runs for.")],
    skip: Annotated[int, Field(ge=0, description="Number of runs to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=50, description="Maximum runs to return.")] = 20,
) -> dict:
    """List collection runs for a collection with pagination. Read-only."""
    await ensure_mcp_database()
    runs = await CollectionRunRepository.get_by_collection(collection_id, skip=skip, limit=limit)
    total = await CollectionRunRepository.count_by_collection(collection_id)
    summaries = [CollectionRunSummary(r).to_dict() for r in runs]
    return {
        "collectionId": collection_id,
        "runs": summaries,
        "total": total,
        "skip": skip,
        "limit": limit,
        "hasMore": (skip + limit) < total,
    }


async def collection_run_get(
    collection_run_id: Annotated[str, Field(description="Collection run ID to retrieve.")],
) -> dict:
    """Get a collection run by ID. Read-only."""
    await ensure_mcp_database()
    run = await CollectionRunRepository.get_by_id(collection_run_id)
    if not run:
        raise ValueError(f"Collection run not found: {collection_run_id}")
    return CollectionRunSummary(run).to_dict()


async def collection_run_latest(
    collection_id: Annotated[str, Field(description="Collection ID to get latest run for.")],
) -> dict:
    """Get the latest collection run for a collection. Read-only."""
    await ensure_mcp_database()
    run = await CollectionRunRepository.get_latest_by_collection(collection_id)
    if not run:
        return {"collectionId": collection_id, "hasRun": False}
    return {
        "hasRun": True,
        **CollectionRunSummary(run).to_dict(),
    }


def register_collection_run_tools(server: FastMCP) -> None:
    """Register collection-run read-only tools."""
    server.tool(
        name="collection_run_list",
        description="List collection runs for a collection with pagination. Read-only.",
    )(collection_run_list)

    server.tool(
        name="collection_run_get",
        description="Get a collection run by ID. Read-only.",
    )(collection_run_get)

    server.tool(
        name="collection_run_latest",
        description="Get the latest collection run for a collection. Read-only.",
    )(collection_run_latest)
