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
    is_active: bool = Field(description="Whether this is the active environment.")
    created_at: datetime = Field(description="Environment creation timestamp.")
    updated_at: datetime = Field(description="Environment last update timestamp.")


class EnvironmentListResponse(BaseModel):
    """Output for environment_list."""

    environments: list[EnvironmentSummary] = Field(description="Secret-safe environments.")
    total: int = Field(description="Number of environments returned.")


class EnvironmentActiveResponse(BaseModel):
    """Output for environment_get_active."""

    environment: EnvironmentSummary = Field(description="Secret-safe active environment.")
