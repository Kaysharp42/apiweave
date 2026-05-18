"""
MCP collection tool input and output schemas.
"""
from datetime import datetime

from pydantic import BaseModel, Field

from app.mcp.schemas.workflows import WorkflowSummary


class CollectionSummary(BaseModel):
    """Collection metadata for MCP responses."""

    collection_id: str = Field(description="Stable collection identifier.")
    name: str = Field(description="Collection name.")
    description: str | None = Field(default=None, description="Collection description.")
    color: str | None = Field(default=None, description="Display color.")
    workflow_count: int = Field(description="Number of workflows in the collection.")
    created_at: datetime = Field(description="Collection creation timestamp.")
    updated_at: datetime = Field(description="Collection last update timestamp.")


class CollectionListResponse(BaseModel):
    """Output for collection_list."""

    collections: list[CollectionSummary] = Field(description="Collections with workflow counts.")
    total: int = Field(description="Number of collections returned.")


class CollectionListWorkflowsResponse(BaseModel):
    """Output for collection_list_workflows."""

    collection_id: str = Field(description="Collection ID that was queried.")
    workflows: list[WorkflowSummary] = Field(description="Workflows in the collection.")
    total: int = Field(description="Number of workflows returned.")
