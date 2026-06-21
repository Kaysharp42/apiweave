"""
Shared MCP contract utilities — structured errors, pagination, redaction, and large-output metadata.

These helpers ensure consistent response shapes across all MCP tool modules.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class McpErrorEnvelope(BaseModel):
    """Structured error envelope for MCP tool business/domain failures.

    Use `isError: true` tool results for these; reserve JSON-RPC protocol errors
    for malformed requests and unknown tool calls.
    """

    code: str = Field(
        description="Machine-readable error code (e.g. 'not_found', 'validation_error')."
    )
    message: str = Field(description="Human-readable error description.")
    retryable: bool = Field(description="Whether retrying the same request is likely to succeed.")
    suggested_next_tool: str | None = Field(
        default=None,
        description="Optional tool name the agent should try next for recovery.",
    )
    resource: str | None = Field(
        default=None,
        description="Resource identifier related to the error (e.g. workflow ID).",
    )

    def to_tool_result(self) -> dict[str, Any]:
        """Serialize for MCP tool error response (isError=true)."""
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "retryable": self.retryable,
                "suggested_next_tool": self.suggested_next_tool,
                "resource": self.resource,
            }
        }


class PaginationMetadata(BaseModel):
    """Pagination metadata for list responses.

    Provides reliable skip/limit/total/has_more semantics so agents
    can page through results without guessing.
    """

    skip: int = Field(description="Number of items skipped (offset).")
    limit: int = Field(description="Maximum items requested.")
    total: int = Field(description="Total items matching the filter (not just this page).")
    has_more: bool = Field(description="Whether more results exist beyond this page.")

    def clamp_limit(self, max_limit: int) -> int:
        """Return limit clamped to max_limit."""
        return min(self.limit, max_limit)


class LargeResultMetadata(BaseModel):
    """Metadata for large outputs that may be truncated or stored in GridFS.

    Agents use this to decide whether to fetch full details via a detail tool.
    """

    stored_in_gridfs: bool = Field(description="Whether the full payload is stored in GridFS.")
    payload_size_bytes: int | None = Field(default=None, description="Approximate payload size.")
    truncated: bool = Field(description="Whether the returned payload was truncated.")
    detail_tool: str | None = Field(
        default=None,
        description="Tool name to retrieve full details (e.g. 'run_get_node_result').",
    )
    next_action: str | None = Field(
        default=None,
        description="Human-readable guidance for the agent's next step.",
    )


REDACTION_PLACEHOLDER = "<SECRET>"


def make_not_found_error(
    resource_type: str, resource_id: str, suggested_next_tool: str | None = None
) -> McpErrorEnvelope:
    """Create a structured not-found error."""
    return McpErrorEnvelope(
        code="not_found",
        message=f"{resource_type} not found: {resource_id}",
        retryable=False,
        suggested_next_tool=suggested_next_tool,
        resource=resource_id,
    )


def make_validation_error(message: str, resource: str | None = None) -> McpErrorEnvelope:
    """Create a structured validation error."""
    return McpErrorEnvelope(
        code="validation_error",
        message=message,
        retryable=False,
        resource=resource,
    )


def make_config_disabled_error(feature: str) -> McpErrorEnvelope:
    """Create a structured config-disabled error."""
    return McpErrorEnvelope(
        code="config_disabled",
        message=f"{feature} is disabled by server configuration.",
        retryable=False,
    )


def make_conflict_error(message: str, resource: str | None = None) -> McpErrorEnvelope:
    """Create a structured conflict error."""
    return McpErrorEnvelope(
        code="conflict",
        message=message,
        retryable=False,
        resource=resource,
    )
