"""
MCP run tool input and output schemas.
"""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class ResumeRunRequest(BaseModel):
    """Optional resume configuration for workflow_run."""

    mode: Literal["single", "all-failed"] = Field(
        description="Resume mode: one failed node or all failed nodes."
    )
    source_run_id: str | None = Field(
        default=None,
        description=(
            "Failed source run to hydrate context from. Latest failed run is used if omitted."
        ),
    )
    start_node_ids: list[str] = Field(
        default_factory=list,
        description="Failed node IDs to restart from. Derived from the source run if omitted.",
    )


class WorkflowRunRequest(BaseModel):
    """Input for workflow_run."""

    workflow_id: str = Field(description="Workflow ID to execute.")
    environment_id: str | None = Field(
        default=None,
        description="Optional environment ID for this run.",
    )
    runtime_secrets: dict[str, str] = Field(
        default_factory=dict,
        description="Runtime-only secret values. They are passed to execution but never persisted.",
    )
    resume: ResumeRunRequest | None = Field(
        default=None,
        description="Optional resume configuration for failed-run retry flows.",
    )


class PollingHint(BaseModel):
    """Agent-friendly polling instructions."""

    tool: str = Field(description="Tool to call for polling.")
    recommended_interval_seconds: int = Field(description="Suggested polling interval in seconds.")
    instructions: str = Field(description="Human-readable polling guidance.")
    terminal_statuses: list[str] = Field(description="Statuses that mean polling can stop.")


class WorkflowRunResponse(BaseModel):
    """Output for workflow_run."""

    message: str = Field(description="Run trigger status message.")
    run_id: str = Field(description="Created run ID.")
    workflow_id: str = Field(description="Workflow ID being executed.")
    environment_id: str | None = Field(default=None, description="Environment ID used by the run.")
    resume_mode: str | None = Field(default=None, description="Resume mode, if any.")
    resume_from_run_id: str | None = Field(default=None, description="Source run used for resume.")
    start_node_ids: list[str] | None = Field(
        default=None,
        description="Entry node IDs used for resumed execution.",
    )
    status: str = Field(description="Initial run status.")
    runtime_secret_count: int = Field(
        description="Number of runtime secret values accepted without echoing them back."
    )
    polling_hint: PollingHint = Field(description="How an agent should poll this run.")


class RunGetStatusRequest(BaseModel):
    """Input for run_get_status."""

    workflow_id: str = Field(description="Workflow ID that owns the run.")
    run_id: str = Field(description="Run ID to poll.")


class NodeStatusSummary(BaseModel):
    """Compact node execution status without full payload data."""

    node_id: str = Field(description="Workflow node ID.")
    status: str | None = Field(default=None, description="Node execution status.")
    timestamp: str | None = Field(default=None, description="Last node status timestamp.")
    has_full_result: bool = Field(
        description="Whether full node details should be fetched with run_get_node_result."
    )


class RunStatusResponse(BaseModel):
    """Output for run_get_status."""

    run_id: str = Field(description="Run ID.")
    workflow_id: str = Field(description="Workflow ID.")
    status: str = Field(description="Run status.")
    trigger: str = Field(description="Run trigger source.")
    environment_id: str | None = Field(default=None, description="Environment ID used by the run.")
    resume_from_run_id: str | None = Field(default=None, description="Source run used for resume.")
    resume_from_node_ids: list[str] | None = Field(
        default=None,
        description="Entry nodes used for resumed execution.",
    )
    resume_mode: str | None = Field(default=None, description="Resume mode, if any.")
    created_at: datetime = Field(description="Run creation timestamp.")
    started_at: datetime | None = Field(default=None, description="Run start timestamp.")
    completed_at: datetime | None = Field(default=None, description="Run completion timestamp.")
    duration_ms: int | None = Field(default=None, description="Run duration in milliseconds.")
    error: str | None = Field(default=None, description="Run-level error message.")
    failure_message: str | None = Field(default=None, description="Failure summary, if any.")
    failed_nodes: list[str] = Field(default_factory=list, description="Failed node IDs.")
    node_statuses: list[NodeStatusSummary] = Field(description="Node status summaries.")
    node_counts: dict[str, int] = Field(description="Counts by node status.")
    terminal: bool = Field(description="Whether the run has reached a terminal status.")


class RunGetResultsRequest(BaseModel):
    """Input for run_get_results."""

    workflow_id: str = Field(description="Workflow ID that owns the run.")
    run_id: str = Field(description="Run ID to summarize.")


class RunResultNodeSummary(BaseModel):
    """Human-readable node result summary without request/response payloads."""

    node_id: str | None = Field(default=None, description="Workflow node ID.")
    node_type: str | None = Field(default=None, description="Workflow node type.")
    status: str = Field(description="Node result status.")
    duration: str | None = Field(default=None, description="Human-readable node duration.")
    duration_seconds: float | None = Field(default=None, description="Node duration in seconds.")
    error: str | None = Field(default=None, description="Node error, if any.")
    assertion_count: int = Field(description="Number of assertion records in the full result.")
    has_request: bool = Field(description="Whether a request payload exists in the full result.")
    has_response: bool = Field(description="Whether a response payload exists in the full result.")


class RunResultsResponse(BaseModel):
    """Output for run_get_results."""

    run_id: str = Field(description="Run ID.")
    workflow_id: str = Field(description="Workflow ID.")
    workflow_name: str = Field(description="Workflow name.")
    status: str = Field(description="Human-readable overall status.")
    trigger: str = Field(description="Run trigger source.")
    summary: dict[str, Any] = Field(description="Aggregate result summary.")
    timing: dict[str, Any] = Field(description="Run timing information.")
    environment: dict[str, Any] | None = Field(default=None, description="Environment metadata.")
    error: str | None = Field(default=None, description="Run-level error message.")
    failed_nodes: list[str] = Field(default_factory=list, description="Failed node IDs.")
    failure_message: str | None = Field(default=None, description="Failure summary, if any.")
    node_results: list[RunResultNodeSummary] = Field(description="Payload-free node results.")
    detail_tool: str = Field(description="Tool to fetch a full node result when required.")


class RunGetNodeResultRequest(BaseModel):
    """Input for run_get_node_result."""

    workflow_id: str = Field(description="Workflow ID that owns the run.")
    run_id: str = Field(description="Run ID containing the node result.")
    node_id: str = Field(description="Node ID to retrieve.")


class RunNodeResultResponse(BaseModel):
    """Output for run_get_node_result."""

    node_id: str = Field(description="Workflow node ID.")
    run_id: str = Field(description="Run ID.")
    status: str | None = Field(default=None, description="Node execution status.")
    timestamp: str | None = Field(default=None, description="Result timestamp.")
    result: Any = Field(description="Full node result with secret-like values redacted.")
    metadata: dict[str, Any] = Field(description="Result storage metadata.")
    redacted_secret_references: list[str] = Field(
        default_factory=list,
        description="Paths where secret-like values were replaced with <SECRET>.",
    )


class FailedNodeSummary(BaseModel):
    """Failed node metadata for resume flows."""

    node_id: str = Field(description="Failed node ID.")
    label: str = Field(description="Node display label.")
    type: str | None = Field(default=None, description="Node type.")
    status: str | None = Field(default=None, description="Failed node status.")
    timestamp: str | None = Field(default=None, description="Failure timestamp.")


class RunLatestFailedRequest(BaseModel):
    """Input for run_latest_failed."""

    workflow_id: str = Field(description="Workflow ID to inspect.")


class RunLatestFailedResponse(BaseModel):
    """Output for run_latest_failed."""

    has_failed_run: bool = Field(description="Whether a failed run exists.")
    workflow_id: str = Field(description="Workflow ID.")
    run_id: str | None = Field(default=None, description="Latest failed run ID.")
    failed_nodes: list[FailedNodeSummary] = Field(description="Failed node metadata.")
    failed_node_ids: list[str] = Field(default_factory=list, description="Failed node IDs.")
    failed_count: int = Field(default=0, description="Number of failed nodes.")
    created_at: datetime | None = Field(default=None, description="Failed run creation timestamp.")


class RunListRequest(BaseModel):
    """Input for run_list."""

    workflow_id: str | None = Field(
        default=None,
        description="Optional workflow ID filter.",
    )
    status_filter: str | None = Field(
        default=None,
        description="Optional status filter (pending, running, completed, failed, cancelled).",
    )
    skip: int = Field(default=0, ge=0, description="Number of runs to skip.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum runs to return.")


class RunListItem(BaseModel):
    """Compact run metadata for list responses."""

    run_id: str = Field(description="Run ID.")
    workflow_id: str = Field(description="Workflow ID.")
    status: str = Field(description="Run status.")
    trigger: str = Field(description="Run trigger source.")
    environment_id: str | None = Field(default=None, description="Environment ID used.")
    created_at: datetime = Field(description="Run creation timestamp.")
    duration_ms: int | None = Field(default=None, description="Run duration in milliseconds.")
    error: str | None = Field(default=None, description="Run-level error message.")


class RunListResponse(BaseModel):
    """Output for run_list."""

    runs: list[RunListItem] = Field(description="Run summaries.")
    total: int = Field(description="Number of runs returned.")
    has_more: bool = Field(description="Whether another page is available.")


class RunCancelRequest(BaseModel):
    """Input for run_cancel."""

    run_id: str = Field(description="Run ID to cancel.")


class RunCancelResponse(BaseModel):
    """Output for run_cancel."""

    message: str = Field(description="Cancellation result message.")
    run_id: str = Field(description="Cancelled run ID.")
    status: str = Field(description="Updated run status.")
