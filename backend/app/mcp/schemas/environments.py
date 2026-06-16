"""
MCP environment tool input and output schemas.
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class EnvironmentSummary(BaseModel):
    """Secret-safe environment representation for MCP responses."""

    environment_id: str = Field(description="Stable environment identifier.")
    name: str = Field(description="Environment name.")
    description: str | None = Field(default=None, description="Environment description.")
    swagger_doc_url: str | None = Field(default=None, description="Swagger/OpenAPI source URL.")
    variables: dict[str, Any] = Field(description="Variables with secret-like values redacted.")
    secrets: dict[str, str] = Field(description="Persisted secret names with redacted values.")
    created_at: datetime = Field(description="Environment creation timestamp.")
    updated_at: datetime = Field(description="Environment last update timestamp.")


class EnvironmentListResponse(BaseModel):
    """Output for environment_list."""

    environments: list[EnvironmentSummary] = Field(description="Secret-safe environments.")
    total: int = Field(description="Number of environments returned.")


class EnvironmentCreateRequest(BaseModel):
    """Input for environment_create."""

    name: str = Field(description="Environment name.")
    description: str | None = Field(default=None, description="Environment description.")
    swagger_doc_url: str | None = Field(default=None, description="Swagger/OpenAPI source URL.")
    variables: dict[str, Any] = Field(
        default_factory=dict,
        description="Environment variables.",
    )


class EnvironmentCreateResponse(BaseModel):
    """Output for environment_create."""

    message: str = Field(description="Creation confirmation message.")
    environment: EnvironmentSummary = Field(
        description="Created environment with secrets redacted.",
    )


class EnvironmentGetRequest(BaseModel):
    """Input for environment_get."""

    environment_id: str = Field(description="Environment ID to retrieve.")


class EnvironmentGetResponse(BaseModel):
    """Output for environment_get."""

    environment: EnvironmentSummary = Field(description="Secret-safe environment.")


class EnvironmentUpdateRequest(BaseModel):
    """Input for environment_update."""

    environment_id: str = Field(description="Environment ID to update.")
    name: str | None = Field(default=None, description="New environment name.")
    description: str | None = Field(default=None, description="New description.")
    swagger_doc_url: str | None = Field(default=None, description="New Swagger/OpenAPI URL.")
    variables: dict[str, Any] | None = Field(
        default=None,
        description="Replacement variables. Omitted to leave unchanged.",
    )


class EnvironmentUpdateResponse(BaseModel):
    """Output for environment_update."""

    message: str = Field(description="Update confirmation message.")
    environment: EnvironmentSummary = Field(
        description="Updated environment with secrets redacted.",
    )


class EnvironmentDeleteRequest(BaseModel):
    """Input for environment_delete."""

    environment_id: str = Field(description="Environment ID to delete.")


class EnvironmentDeleteResponse(BaseModel):
    """Output for environment_delete."""

    message: str = Field(description="Deletion confirmation message.")
    environment_id: str = Field(description="Deleted environment ID.")
