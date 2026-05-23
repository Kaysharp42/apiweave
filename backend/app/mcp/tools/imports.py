"""
MCP import tools.
"""
from __future__ import annotations

import json
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.schemas.imports import (
    ImportCurlResponse,
    ImportDefinitionSummary,
    ImportHarResponse,
    ImportOpenApiUrlRequest,
    ImportOpenApiUrlResponse,
    ImportPreviewResponse,
)
from app.services.import_service import (
    fetch_openapi_from_url,
    parse_curl_to_workflow,
    parse_har_to_workflow,
    parse_openapi_to_workflow,
)
from app.utils.openapi_import_limits import MAX_IMPORTED_OPENAPI_ENDPOINTS


async def import_openapi_url(
    url: Annotated[str, Field(description="OpenAPI spec URL or Swagger UI URL.")],
    base_url: Annotated[
        str,
        Field(description="Override base URL for generated request nodes."),
    ] = "",
    tag_filter: Annotated[
        str | None,
        Field(description="Comma-separated tag filter for OpenAPI operations."),
    ] = None,
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values in imported headers."),
    ] = True,
) -> ImportOpenApiUrlResponse:
    """Discover and import request nodes from an OpenAPI or Swagger UI URL.

    Accepts direct OpenAPI spec URLs (JSON/YAML) and Swagger UI HTML pages.
    For Swagger UI pages, automatically discovers embedded spec URLs.
    Returns HTTP request nodes ready for workflow creation.
    """
    request = ImportOpenApiUrlRequest(
        url=url,
        base_url=base_url,
        tag_filter=tag_filter,
        sanitize=sanitize,
    )
    tags = request.tag_filter.split(",") if request.tag_filter else None
    result = await fetch_openapi_from_url(
        url=request.url,
        base_url=request.base_url,
        tag_filter=tags,
        sanitize=request.sanitize,
    )
    return ImportOpenApiUrlResponse(**result)


async def import_openapi(
    content: Annotated[
        str,
        Field(description="OpenAPI JSON or YAML content as a string."),
    ],
    base_url: Annotated[
        str,
        Field(description="Override base URL for generated request nodes."),
    ] = "",
    tag_filter: Annotated[
        str | None,
        Field(description="Comma-separated tag filter for OpenAPI operations."),
    ] = None,
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values in imported headers."),
    ] = True,
) -> ImportOpenApiUrlResponse:
    """Import OpenAPI content from a JSON or YAML string.

    Parses the OpenAPI spec and returns HTTP request nodes ready for
    workflow creation. Supports both OpenAPI 3.x and Swagger 2.x specs.
    """
    content = content.strip()
    if not content:
        raise ValueError("OpenAPI content is required")

    try:
        openapi_data: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError:
        try:
            import yaml  # type: ignore[import-not-found,import-untyped]

            openapi_data = yaml.safe_load(content)
            if not isinstance(openapi_data, dict):
                raise ValueError("YAML content did not parse to an object")
        except Exception as exc:
            raise ValueError(f"Failed to parse OpenAPI content: {exc}") from exc

    if "paths" not in openapi_data:
        raise ValueError("OpenAPI spec contains no paths")

    tags = tag_filter.split(",") if tag_filter else None
    workflow_data = parse_openapi_to_workflow(
        openapi_data,
        base_url,
        tags,
        sanitize,
    )
    http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]

    if len(http_nodes) > MAX_IMPORTED_OPENAPI_ENDPOINTS:
        raise ValueError(
            f"Imported endpoint count ({len(http_nodes)}) exceeded safety limit "
            f"({MAX_IMPORTED_OPENAPI_ENDPOINTS})."
        )

    api_title = openapi_data.get("info", {}).get("title", "API")

    return ImportOpenApiUrlResponse(
        nodes=http_nodes,
        definitions=[
            ImportDefinitionSummary(
                name=api_title,
                spec_url="",
                status="imported",
                endpoint_count=len(http_nodes),
                source="content",
            )
        ],
        total_endpoints=len(http_nodes),
        api_title=api_title,
        source_url="",
        warnings=[],
    )


async def import_openapi_dry_run(
    content: Annotated[
        str,
        Field(description="OpenAPI JSON or YAML content as a string."),
    ],
    base_url: Annotated[
        str,
        Field(description="Override base URL for generated request nodes."),
    ] = "",
    tag_filter: Annotated[
        str | None,
        Field(description="Comma-separated tag filter for OpenAPI operations."),
    ] = None,
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values in imported headers."),
    ] = True,
) -> ImportPreviewResponse:
    """Preview an OpenAPI import without creating any workflows.

    Returns the number of endpoints that would be imported and any
    validation errors. Use this before calling import_openapi to
    verify the spec is valid and within endpoint limits.
    """
    content = content.strip()
    if not content:
        return ImportPreviewResponse(
            valid=False,
            errors=["OpenAPI content is required"],
            node_count=0,
        )

    try:
        openapi_data: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError:
        try:
            import yaml  # type: ignore[import-not-found,import-untyped]

            openapi_data = yaml.safe_load(content)
            if not isinstance(openapi_data, dict):
                raise ValueError("YAML content did not parse to an object")
        except Exception as exc:
            return ImportPreviewResponse(
                valid=False,
                errors=[f"Failed to parse OpenAPI content: {exc}"],
                node_count=0,
            )

    errors: list[str] = []
    if "paths" not in openapi_data:
        errors.append("OpenAPI spec contains no paths")

    api_title = openapi_data.get("info", {}).get("title", "API")
    paths = openapi_data.get("paths", {})
    endpoint_count = 0
    for path_item in paths.values():
        for method in ("get", "post", "put", "patch", "delete", "head", "options"):
            if method in path_item:
                endpoint_count += 1

    tags = tag_filter.split(",") if tag_filter else None
    try:
        workflow_data = parse_openapi_to_workflow(
            openapi_data,
            base_url,
            tags,
            sanitize,
        )
        node_count = sum(
            1 for n in workflow_data["nodes"] if n["type"] == "http-request"
        )
        if node_count > MAX_IMPORTED_OPENAPI_ENDPOINTS:
            errors.append(
                f"Imported endpoint count ({node_count}) exceeded safety limit "
                f"({MAX_IMPORTED_OPENAPI_ENDPOINTS})."
            )
            node_count = 0
    except Exception as exc:
        errors.append(str(exc))
        node_count = 0

    return ImportPreviewResponse(
        valid=len(errors) == 0,
        errors=errors,
        node_count=node_count,
        api_title=api_title,
        endpoint_count=endpoint_count,
    )


async def import_har(
    content: Annotated[
        str,
        Field(description="HAR file content as a JSON string."),
    ],
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values in imported headers."),
    ] = True,
) -> ImportHarResponse:
    """Import HTTP requests from HAR file content.

    Parses HAR (HTTP Archive) JSON and returns HTTP request nodes with
    example response data from the captured traffic.
    """
    content = content.strip()
    if not content:
        raise ValueError("HAR content is required")

    try:
        har_data: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid HAR JSON: {exc}") from exc

    if "log" not in har_data:
        raise ValueError("HAR content missing 'log' root key")

    entries = har_data.get("log", {}).get("entries", [])
    if not entries:
        raise ValueError("HAR file contains no entries")

    workflow_data = parse_har_to_workflow(har_data, sanitize=sanitize)
    http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]

    return ImportHarResponse(
        nodes=http_nodes,
        total_requests=len(http_nodes),
        example=True,
    )


async def import_har_dry_run(
    content: Annotated[
        str,
        Field(description="HAR file content as a JSON string."),
    ],
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values in imported headers."),
    ] = True,
) -> ImportPreviewResponse:
    """Preview a HAR import without creating any workflows.

    Returns the number of requests that would be imported and any
    validation errors. Use this before calling import_har to verify
    the HAR file is valid.
    """
    content = content.strip()
    if not content:
        return ImportPreviewResponse(
            valid=False,
            errors=["HAR content is required"],
            node_count=0,
        )

    try:
        har_data: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError as exc:
        return ImportPreviewResponse(
            valid=False,
            errors=[f"Invalid HAR JSON: {exc}"],
            node_count=0,
        )

    errors: list[str] = []
    if "log" not in har_data:
        errors.append("HAR content missing 'log' root key")

    entries = har_data.get("log", {}).get("entries", [])
    if not entries and not errors:
        errors.append("HAR file contains no entries")

    node_count = len(entries) if not errors else 0

    return ImportPreviewResponse(
        valid=len(errors) == 0,
        errors=errors,
        node_count=node_count,
        endpoint_count=node_count,
    )


async def import_curl(
    content: Annotated[
        str,
        Field(description="One or more curl commands, each starting with 'curl'."),
    ],
    sanitize: Annotated[
        bool,
        Field(description="Sanitize secret-like values in imported headers."),
    ] = True,
) -> ImportCurlResponse:
    """Import one or more curl commands as HTTP request nodes.

    Parses curl command strings and extracts method, URL, headers,
    cookies, and body into workflow-compatible request nodes.
    """
    content = content.strip()
    if not content:
        raise ValueError("Curl content is required")

    workflow_data = parse_curl_to_workflow(content, sanitize=sanitize)
    http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]

    return ImportCurlResponse(
        nodes=http_nodes,
        total_requests=len(http_nodes),
    )


def register_import_tools(server: FastMCP) -> None:
    """Register Phase 4 import tools."""
    server.tool(
        name="import_openapi_url",
        description=(
            "Discover and import request nodes from an OpenAPI or Swagger UI URL. "
            "Accepts direct spec URLs and Swagger UI pages. Returns HTTP request "
            "nodes ready for workflow creation."
        ),
    )(import_openapi_url)
    server.tool(
        name="import_openapi",
        description=(
            "Import OpenAPI content from a JSON or YAML string. "
            "Parses the spec and returns HTTP request nodes. "
            "Use import_openapi_dry_run first to preview."
        ),
    )(import_openapi)
    server.tool(
        name="import_openapi_dry_run",
        description=(
            "Preview an OpenAPI import without creating workflows. "
            "Returns endpoint count and validation errors. "
            "Use before import_openapi to verify the spec."
        ),
    )(import_openapi_dry_run)
    server.tool(
        name="import_har",
        description=(
            "Import HTTP requests from HAR file content. "
            "Returns nodes with example response data from captured traffic."
        ),
    )(import_har)
    server.tool(
        name="import_har_dry_run",
        description=(
            "Preview a HAR import without creating workflows. "
            "Returns request count and validation errors."
        ),
    )(import_har_dry_run)
    server.tool(
        name="import_curl",
        description=(
            "Import one or more curl commands as HTTP request nodes. "
            "Extracts method, URL, headers, cookies, and body."
        ),
    )(import_curl)
