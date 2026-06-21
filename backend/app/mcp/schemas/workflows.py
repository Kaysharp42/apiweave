"""
MCP workflow tool input and output schemas.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.models import Edge, Node


class WorkflowSummary(BaseModel):
    """Compact workflow metadata for list responses."""

    workflow_id: str = Field(description="Stable workflow identifier.")
    name: str = Field(description="Workflow name.")
    description: str | None = Field(default=None, description="Workflow description.")
    tags: list[str] = Field(default_factory=list, description="Workflow tags.")
    collection_id: str | None = Field(
        default=None,
        description="Collection containing this workflow, if any.",
    )
    environment_id: str | None = Field(
        default=None,
        description="Default environment assigned to this workflow, if any.",
    )
    node_count: int = Field(description="Number of nodes in the workflow.")
    edge_count: int = Field(description="Number of edges in the workflow.")
    template_count: int = Field(description="Number of imported node templates.")
    created_at: datetime = Field(description="Workflow creation timestamp.")
    updated_at: datetime = Field(description="Workflow last update timestamp.")
    version: int = Field(description="Workflow schema version.")


class WorkflowDetail(WorkflowSummary):
    """Full workflow definition with secret-like values redacted."""

    nodes: list[dict[str, Any]] = Field(description="Workflow node definitions.")
    edges: list[dict[str, Any]] = Field(description="Workflow edge definitions.")
    variables: dict[str, Any] = Field(description="Workflow variables with secrets redacted.")
    node_templates: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Imported node templates available to the workflow.",
    )
    redacted_secret_references: list[str] = Field(
        default_factory=list,
        description="Paths where secret-like values were replaced with <SECRET>.",
    )


class WorkflowListRequest(BaseModel):
    """Input for workflow_list."""

    skip: int = Field(default=0, ge=0, description="Number of workflows to skip.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum workflows to return.")
    tag: str | None = Field(default=None, description="Optional tag filter.")
    name: str | None = Field(default=None, description="Optional case-insensitive name search.")


class WorkflowListResponse(BaseModel):
    """Output for workflow_list."""

    workflows: list[WorkflowSummary] = Field(description="Matching workflow summaries.")
    total: int = Field(description="Total number of matching workflows.")
    skip: int = Field(description="Number of skipped workflows.")
    limit: int = Field(description="Requested page size.")
    has_more: bool = Field(description="Whether another page is available.")


class WorkflowGetRequest(BaseModel):
    """Input for workflow_get."""

    workflow_id: str = Field(description="Workflow ID to retrieve.")


class WorkflowCreateRequest(BaseModel):
    """Input for workflow_create."""

    name: str = Field(description="Workflow name.")
    description: str | None = Field(default=None, description="Workflow description.")
    nodes: list[Node] = Field(default_factory=list, description="Workflow nodes.")
    edges: list[Edge] = Field(default_factory=list, description="Workflow edges.")
    variables: dict[str, Any] = Field(default_factory=dict, description="Workflow variables.")
    tags: list[str] = Field(default_factory=list, description="Workflow tags.")
    node_templates: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Imported node templates for the Add Nodes panel.",
    )
    collection_id: str | None = Field(default=None, description="Optional collection ID.")


class WorkflowUpdateRequest(BaseModel):
    """Input for workflow_update."""

    workflow_id: str = Field(description="Workflow ID to update.")
    name: str | None = Field(default=None, description="New workflow name.")
    description: str | None = Field(default=None, description="New workflow description.")
    nodes: list[Node] | None = Field(default=None, description="Replacement workflow nodes.")
    edges: list[Edge] | None = Field(default=None, description="Replacement workflow edges.")
    variables: dict[str, Any] | None = Field(default=None, description="Replacement variables.")
    tags: list[str] | None = Field(default=None, description="Replacement tags.")
    node_templates: list[dict[str, Any]] | None = Field(
        default=None,
        description="Replacement imported node templates.",
    )


class WorkflowExportRequest(BaseModel):
    """Input for workflow_export."""

    workflow_id: str = Field(description="Workflow ID to export.")
    include_environment: bool = Field(
        default=True,
        description="Whether to include a sanitized environment bundle.",
    )


class WorkflowExportResponse(BaseModel):
    """Output for workflow_export."""

    bundle: dict[str, Any] = Field(description="Sanitized workflow export bundle.")


class WorkflowImportRequest(BaseModel):
    """Input for workflow_import."""

    bundle: dict[str, Any] = Field(description="Workflow export bundle to import.")
    environment_mapping: dict[str, str] | None = Field(
        default=None,
        description="Optional mapping from bundle environment IDs to existing environment IDs.",
    )
    create_missing_environments: bool = Field(
        default=True,
        description="Create bundled environments that are missing locally.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like workflow values before persisting.",
    )


class WorkflowImportResponse(BaseModel):
    """Output for workflow_import."""

    message: str = Field(description="Import status message.")
    workflow_id: str = Field(description="Created workflow ID.")
    environment_id: str | None = Field(
        default=None,
        description="Mapped or created environment ID.",
    )
    secret_references: list[str] = Field(
        default_factory=list,
        description="Secret placeholders that must be re-entered by a user.",
    )


class WorkflowImportDryRunRequest(BaseModel):
    """Input for workflow_import_dry_run."""

    bundle: dict[str, Any] = Field(description="Workflow export bundle to validate.")


class WorkflowImportDryRunResponse(BaseModel):
    """Output for workflow_import_dry_run."""

    valid: bool = Field(description="Whether the bundle can be imported.")
    errors: list[str] = Field(default_factory=list, description="Validation errors.")
    warnings: list[str] = Field(default_factory=list, description="Validation warnings.")
    stats: dict[str, Any] = Field(default_factory=dict, description="Bundle summary statistics.")


class WorkflowDeleteRequest(BaseModel):
    """Input for workflow_delete."""

    workflow_id: str = Field(description="Workflow ID to delete.")


class WorkflowDeleteResponse(BaseModel):
    """Output for workflow_delete."""

    message: str = Field(description="Deletion confirmation message.")
    workflow_id: str = Field(description="Deleted workflow ID.")


class WorkflowAttachCollectionRequest(BaseModel):
    """Input for workflow_attach_collection."""

    workflow_id: str = Field(description="Workflow ID to modify.")
    collection_id: str | None = Field(
        default=None,
        description="Collection ID to attach to, or null to detach.",
    )


class WorkflowAttachCollectionResponse(BaseModel):
    """Output for workflow_attach_collection."""

    message: str = Field(description="Operation confirmation message.")
    workflow_id: str = Field(description="Workflow ID.")
    collection_id: str | None = Field(description="Collection ID assigned, or null if detached.")


class WorkflowSetEnvironmentRequest(BaseModel):
    """Input for workflow_set_environment."""

    workflow_id: str = Field(description="Workflow ID to modify.")
    environment_id: str | None = Field(
        default=None,
        description="Environment ID to assign, or null to clear.",
    )


class WorkflowSetEnvironmentResponse(BaseModel):
    """Output for workflow_set_environment."""

    message: str = Field(description="Operation confirmation message.")
    workflow_id: str = Field(description="Workflow ID.")
    environment_id: str | None = Field(description="Environment ID assigned, or null if cleared.")
