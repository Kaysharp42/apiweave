"""
MCP collection tool input and output schemas.
"""

from datetime import datetime
from typing import Any

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


class CollectionCreateRequest(BaseModel):
    """Input for collection_create."""

    name: str = Field(description="Collection name.")
    description: str | None = Field(default=None, description="Collection description.")
    color: str | None = Field(default=None, description="Display color (hex).")


class CollectionCreateResponse(BaseModel):
    """Output for collection_create."""

    message: str = Field(description="Creation confirmation message.")
    collection: CollectionSummary = Field(description="Created collection.")


class CollectionGetRequest(BaseModel):
    """Input for collection_get."""

    collection_id: str = Field(description="Collection ID to retrieve.")


class CollectionGetResponse(BaseModel):
    """Output for collection_get."""

    collection: CollectionSummary = Field(description="Collection with workflow count.")


class CollectionUpdateRequest(BaseModel):
    """Input for collection_update."""

    collection_id: str = Field(description="Collection ID to update.")
    name: str | None = Field(default=None, description="New collection name.")
    description: str | None = Field(default=None, description="New description.")
    color: str | None = Field(default=None, description="New display color.")


class CollectionUpdateResponse(BaseModel):
    """Output for collection_update."""

    message: str = Field(description="Update confirmation message.")
    collection: CollectionSummary = Field(description="Updated collection.")


class CollectionDeleteRequest(BaseModel):
    """Input for collection_delete."""

    collection_id: str = Field(description="Collection ID to delete.")


class CollectionDeleteResponse(BaseModel):
    """Output for collection_delete."""

    message: str = Field(description="Deletion confirmation message.")
    collection_id: str = Field(description="Deleted collection ID.")


class CollectionExportRequest(BaseModel):
    """Input for collection_export."""

    collection_id: str = Field(description="Collection ID to export.")
    include_environment: bool = Field(
        default=True,
        description="Whether to include sanitized environment data.",
    )


class CollectionExportResponse(BaseModel):
    """Output for collection_export."""

    bundle: dict[str, Any] = Field(description="Sanitized collection export bundle.")


class CollectionImportRequest(BaseModel):
    """Input for collection_import."""

    bundle: dict[str, Any] = Field(description="Collection export bundle to import.")
    create_new_collection: bool = Field(
        default=True,
        description="Create a new collection instead of importing into an existing one.",
    )
    new_collection_name: str | None = Field(
        default=None,
        description="Name for the new collection. Uses bundle name if omitted.",
    )
    target_collection_id: str | None = Field(
        default=None,
        description="Existing collection ID to import workflows into.",
    )
    environment_mapping: dict[str, str] | None = Field(
        default=None,
        description="Mapping from bundle environment IDs to existing IDs.",
    )


class CollectionImportResponse(BaseModel):
    """Output for collection_import."""

    message: str = Field(description="Import status message.")
    collection_id: str = Field(description="Created or updated collection ID.")
    workflow_count: int = Field(description="Number of workflows imported.")
    environment_count: int = Field(description="Number of environments created or mapped.")
    secret_references: list[str] = Field(
        default_factory=list,
        description="Secret placeholders that must be re-entered.",
    )


class CollectionImportDryRunRequest(BaseModel):
    """Input for collection_import_dry_run."""

    bundle: dict[str, Any] = Field(description="Collection export bundle to validate.")
    create_new_collection: bool = Field(
        default=True,
        description="Whether a new collection would be created.",
    )
    target_collection_id: str | None = Field(
        default=None,
        description="Existing collection ID to validate import into.",
    )


class CollectionImportDryRunResponse(BaseModel):
    """Output for collection_import_dry_run."""

    valid: bool = Field(description="Whether the bundle can be imported.")
    errors: list[str] = Field(default_factory=list, description="Validation errors.")
    warnings: list[str] = Field(default_factory=list, description="Validation warnings.")
    stats: dict[str, Any] = Field(default_factory=dict, description="Bundle summary statistics.")


class CollectionAddWorkflowRequest(BaseModel):
    """Input for collection_add_workflow."""

    collection_id: str = Field(description="Collection ID to add the workflow to.")
    workflow_id: str = Field(description="Workflow ID to add.")


class CollectionAddWorkflowResponse(BaseModel):
    """Output for collection_add_workflow."""

    message: str = Field(description="Operation confirmation message.")
    collection_id: str = Field(description="Collection ID.")
    workflow_id: str = Field(description="Workflow ID added.")


class CollectionRemoveWorkflowRequest(BaseModel):
    """Input for collection_remove_workflow."""

    collection_id: str = Field(description="Collection ID to remove the workflow from.")
    workflow_id: str = Field(description="Workflow ID to remove.")


class CollectionRemoveWorkflowResponse(BaseModel):
    """Output for collection_remove_workflow."""

    message: str = Field(description="Operation confirmation message.")
    collection_id: str = Field(description="Collection ID.")
    workflow_id: str = Field(description="Workflow ID removed.")
