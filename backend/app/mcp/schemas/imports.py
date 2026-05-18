"""
MCP import tool input/output schemas.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ImportOpenApiUrlRequest(BaseModel):
    url: str = Field(description="OpenAPI spec URL or Swagger UI URL.")
    base_url: str = Field(
        default="",
        description="Override base URL for generated request nodes.",
    )
    tag_filter: str | None = Field(
        default=None,
        description="Comma-separated tag filter for OpenAPI operations.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like values in imported headers.",
    )


class ImportDefinitionSummary(BaseModel):
    name: str = Field(description="Definition name.")
    spec_url: str = Field(description="Resolved spec URL.")
    status: str = Field(description="imported or failed.")
    endpoint_count: int = Field(description="Number of endpoints imported.")
    source: str = Field(description="Discovery source.")
    error: str | None = Field(default=None, description="Error message if failed.")


class ImportOpenApiUrlResponse(BaseModel):
    nodes: list[dict[str, Any]] = Field(
        description="HTTP request nodes extracted from the OpenAPI spec.",
    )
    definitions: list[ImportDefinitionSummary] = Field(
        description="Per-definition import summaries.",
    )
    total_endpoints: int = Field(description="Total HTTP request nodes returned.")
    api_title: str = Field(description="API title from the OpenAPI spec.")
    source_url: str = Field(description="Original URL provided.")
    warnings: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Warnings for definitions that failed to fetch.",
    )


class ImportOpenApiRequest(BaseModel):
    content: str = Field(
        description="OpenAPI JSON or YAML content as a string.",
    )
    base_url: str = Field(
        default="",
        description="Override base URL for generated request nodes.",
    )
    tag_filter: str | None = Field(
        default=None,
        description="Comma-separated tag filter for OpenAPI operations.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like values in imported headers.",
    )


class ImportOpenApiDryRunRequest(BaseModel):
    content: str = Field(
        description="OpenAPI JSON or YAML content as a string.",
    )
    base_url: str = Field(
        default="",
        description="Override base URL for generated request nodes.",
    )
    tag_filter: str | None = Field(
        default=None,
        description="Comma-separated tag filter for OpenAPI operations.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like values in imported headers.",
    )


class ImportPreviewResponse(BaseModel):
    valid: bool = Field(description="Whether the import would succeed.")
    errors: list[str] = Field(default_factory=list, description="Validation errors.")
    node_count: int = Field(description="Number of HTTP request nodes that would be created.")
    api_title: str = Field(default="", description="API title from the spec.")
    endpoint_count: int = Field(default=0, description="Number of endpoints in the spec.")


class ImportHarRequest(BaseModel):
    content: str = Field(
        description="HAR file content as a JSON string.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like values in imported headers.",
    )


class ImportHarDryRunRequest(BaseModel):
    content: str = Field(
        description="HAR file content as a JSON string.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like values in imported headers.",
    )


class ImportHarResponse(BaseModel):
    nodes: list[dict[str, Any]] = Field(
        description="HTTP request nodes extracted from the HAR file.",
    )
    total_requests: int = Field(description="Number of HTTP requests imported.")
    example: bool = Field(
        default=True,
        description="Whether nodes include example response data from HAR.",
    )


class ImportCurlRequest(BaseModel):
    content: str = Field(
        description="One or more curl commands, each starting with 'curl'.",
    )
    sanitize: bool = Field(
        default=True,
        description="Sanitize secret-like values in imported headers.",
    )


class ImportCurlResponse(BaseModel):
    nodes: list[dict[str, Any]] = Field(
        description="HTTP request nodes extracted from curl commands.",
    )
    total_requests: int = Field(description="Number of curl commands imported.")
