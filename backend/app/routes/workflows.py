"""
Workflow API routes
CRUD operations for workflows
Now using Beanie ODM with repository pattern for enhanced security
"""

import asyncio
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from bson import ObjectId
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.config import settings
from app.database import get_database
from app.models import PaginatedWorkflows, Workflow, WorkflowCreate, WorkflowUpdate
from app.repositories import (
    CollectionRepository,
    EnvironmentRepository,
    RunRepository,
    WorkflowRepository,
)
from app.utils.openapi_examples import (
    generate_example_from_schema as generate_example_from_schema_helper,
)
from app.utils.openapi_examples import (
    resolve_openapi_schema_ref as resolve_openapi_schema_ref_helper,
)
from app.utils.openapi_import_limits import (
    DEFAULT_FETCH_CONCURRENCY,
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    validate_definition_limit,
    validate_endpoint_limit,
)
from app.utils.swagger_discovery import (
    build_swagger_config_candidates,
    extract_definitions_from_swagger_config,
    extract_swagger_ui_hints_from_html,
    make_definition_scope,
    parse_swagger_ui_query_hints,
    resolve_url,
)

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


# Helper functions for export/import


def detect_secrets_in_value(value: str) -> bool:
    """Detect if a value might be a secret based on patterns"""
    if not isinstance(value, str):
        return False

    secret_patterns = [
        r"bearer\s+[a-zA-Z0-9_\-\.]+",  # Bearer tokens
        r"api[_-]?key",  # API keys
        r"secret",  # Secret keywords
        r"token",  # Token keywords
        r"password",  # Password keywords
        r"sk_live_",  # Stripe live keys
        r"pk_live_",  # Stripe public keys
    ]

    for pattern in secret_patterns:
        if re.search(pattern, value, re.IGNORECASE):
            return True

    return False


def sanitize_secrets_in_dict(
    data: dict[str, Any], secret_refs: list[str], path: str = ""
) -> dict[str, Any]:
    """
    Recursively replace potential secret values with <SECRET> placeholder
    and track their paths in secret_refs list
    """
    if not isinstance(data, dict):
        return data

    sanitized = {}
    for key, value in data.items():
        current_path = f"{path}.{key}" if path else key

        if isinstance(value, dict):
            sanitized[key] = sanitize_secrets_in_dict(value, secret_refs, current_path)
        elif isinstance(value, str) and detect_secrets_in_value(value):
            sanitized[key] = "<SECRET>"
            secret_refs.append(current_path)
        else:
            sanitized[key] = value

    return sanitized


def serialize_document_for_export(document: Any) -> dict[str, Any]:
    """Convert Beanie documents into JSON-safe dictionaries for exports."""
    serialized = document.model_dump(by_alias=True)
    serialized.pop("_id", None)
    serialized.pop("id", None)
    return serialized


def parse_curl_to_workflow(curl_commands: str, sanitize: bool = True) -> dict[str, Any]:
    """
    Convert curl command(s) to APIWeave workflow format

    Args:
        curl_commands: Single curl command or multiple commands (one per line, or separated by &&)
        sanitize: Whether to filter sensitive headers

    Returns:
        Workflow dict ready for import
    """
    import shlex
    from urllib.parse import parse_qs, urlparse

    def normalize_curl_command(cmd_text: str) -> str:
        """
        Normalize curl command by handling line continuations (backslashes)
        and ensuring it's a single line
        """
        # Remove line continuations (backslash at end of line)
        normalized = re.sub(r"\\\s*\n\s*", " ", cmd_text)
        return normalized.strip()

    # First, split multiple commands intelligently
    # Look for lines that START with 'curl' to identify command boundaries
    commands = []
    current_cmd = []

    for line in curl_commands.split("\n"):
        stripped = line.strip()

        # If line is empty, skip it
        if not stripped:
            continue

        # If line starts with 'curl', it's a new command
        if stripped.startswith("curl"):
            if current_cmd:
                # Save previous command
                full_cmd = "\n".join(current_cmd)
                normalized = normalize_curl_command(full_cmd)
                if normalized:
                    commands.append(normalized)
            current_cmd = [line]
        else:
            # Continuation of current command
            current_cmd.append(line)

    # Don't forget the last command
    if current_cmd:
        full_cmd = "\n".join(current_cmd)
        normalized = normalize_curl_command(full_cmd)
        if normalized:
            commands.append(normalized)

    if not commands:
        raise ValueError("No valid curl commands found")

    nodes = []
    edges = []

    # Create start node
    start_node_id = str(uuid.uuid4())
    nodes.append(
        {
            "nodeId": start_node_id,
            "type": "start",
            "label": "Start",
            "position": {"x": 100, "y": 100},
            "config": {},
        }
    )

    # Grid layout for curl commands
    nodes_per_row = 8
    x_spacing = 400
    y_spacing = 200
    start_x = 600
    start_y = 100

    for idx, curl_cmd in enumerate(commands):
        node_id = str(uuid.uuid4())

        try:
            # Parse curl command
            # Remove 'curl' prefix
            if curl_cmd.startswith("curl "):
                curl_cmd = curl_cmd[5:].strip()

            # Simple curl parser - handles most common cases
            method = "GET"
            url = None
            headers = {}
            cookies = {}
            body = None

            # Tokenize the command while respecting quotes
            try:
                tokens = shlex.split(curl_cmd)
            except ValueError as e:
                print(f"Shlex parsing failed for command {idx}, trying simple split: {e}")
                # Fallback to manual parsing
                tokens = []
                in_quotes = False
                current_token = []
                for char in curl_cmd:
                    if char == "'" or char == '"':
                        in_quotes = not in_quotes
                    elif char in (" ", "\t") and not in_quotes:
                        if current_token:
                            tokens.append("".join(current_token))
                            current_token = []
                    else:
                        current_token.append(char)
                if current_token:
                    tokens.append("".join(current_token))

            i = 0
            while i < len(tokens):
                token = tokens[i]

                # Skip empty tokens
                if not token:
                    i += 1
                    continue

                # Method flags
                if token == "-X" or token == "--request":
                    if i + 1 < len(tokens):
                        method = tokens[i + 1].upper()
                        i += 2
                        continue

                # URL (first non-flag argument or after -url)
                elif token == "-u" or token == "--url":
                    if i + 1 < len(tokens):
                        url = tokens[i + 1]
                        i += 2
                        continue

                # Headers
                elif token == "-H" or token == "--header":
                    if i + 1 < len(tokens):
                        header_str = tokens[i + 1]
                        if ":" in header_str:
                            key, val = header_str.split(":", 1)
                            key = key.strip()
                            val = val.strip()
                            if sanitize and detect_secrets_in_value(f"{key}:{val}"):
                                headers[key] = "[FILTERED]"
                            else:
                                headers[key] = val
                        i += 2
                        continue

                # Cookies
                elif token == "-b" or token == "--cookie":
                    if i + 1 < len(tokens):
                        cookie_str = tokens[i + 1]
                        for cookie in cookie_str.split(";"):
                            cookie = cookie.strip()
                            if "=" in cookie:
                                k, v = cookie.split("=", 1)
                                cookies[k.strip()] = v.strip()
                        i += 2
                        continue

                # Data/Body
                elif token == "-d" or token == "--data" or token == "--data-raw":
                    if i + 1 < len(tokens):
                        body = tokens[i + 1]
                        if method == "GET":
                            method = "POST"  # -d implies POST
                        i += 2
                        continue

                # If token doesn't start with -, it might be the URL
                elif not token.startswith("-") and url is None:
                    url = token
                    i += 1
                    continue

                i += 1

            # If no URL found, skip this command
            if not url:
                print(f"No URL found in command {idx}, skipping")
                continue

            # Parse URL
            parsed = urlparse(url)
            host = parsed.netloc
            path = parsed.path or "/"
            query = parsed.query

            # Extract query params from URL
            query_params = {}
            if query:
                parsed_qs_result = parse_qs(query, keep_blank_values=True)
                for k, v_list in parsed_qs_result.items():
                    query_params[k] = v_list[0] if v_list else ""

            # Build label
            path_display = path if len(path) <= 40 else path[:37] + "..."
            label = f"[{method}] {host}{path_display}"

            # Convert to string format
            headers_str = "\n".join([f"{k}={v}" for k, v in headers.items()]) if headers else ""
            query_params_str = (
                "\n".join([f"{k}={v}" for k, v in query_params.items()]) if query_params else ""
            )
            cookies_str = "\n".join([f"{k}={v}" for k, v in cookies.items()]) if cookies else ""

            # Calculate position
            row = idx // nodes_per_row
            col = idx % nodes_per_row
            x_position = start_x + col * x_spacing
            y_position = start_y + row * y_spacing

            # Create node
            node_config = {
                "method": method,
                "url": url,
                "headers": headers_str,
                "queryParams": query_params_str,
                "cookies": cookies_str,
                "body": body,
                "timeout": 30,
                "followRedirects": True,
                "extractors": {},
            }

            node = {
                "nodeId": node_id,
                "type": "http-request",
                "label": label,
                "position": {"x": x_position, "y": y_position},
                "config": node_config,
            }

            nodes.append(node)

        except Exception as e:
            # Log error but continue with other commands
            print(f"Error parsing curl command {idx}: {str(e)}")
            import traceback

            traceback.print_exc()
            continue

    # Create end node
    total_rows = (len(nodes) + nodes_per_row - 1) // nodes_per_row
    end_x = start_x + (nodes_per_row // 2) * x_spacing
    end_y = start_y + total_rows * y_spacing + y_spacing

    end_node_id = str(uuid.uuid4())
    nodes.append(
        {
            "nodeId": end_node_id,
            "type": "end",
            "label": "End",
            "position": {"x": end_x, "y": end_y},
            "config": {},
        }
    )

    # Connect start to end
    edges.append(
        {"edgeId": str(uuid.uuid4()), "source": start_node_id, "target": end_node_id, "label": None}
    )

    workflow = {
        "name": f"Imported from curl - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {len(nodes) - 2} HTTP requests from curl commands",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["curl-import"],
    }

    return workflow


def parse_har_to_workflow(
    har_data: dict[str, Any], import_mode: str = "linear", sanitize: bool = True
) -> dict[str, Any]:
    """
    Convert HAR file to APIWeave workflow format

    Args:
        har_data: Parsed HAR JSON
        import_mode: "linear" (sequential) or "grouped" (parallel)
        sanitize: Whether to filter sensitive headers

    Returns:
        Workflow dict ready for import
    """
    entries = har_data.get("log", {}).get("entries", [])

    if not entries:
        raise ValueError("HAR file contains no entries")

    nodes = []
    edges = []

    # Create start node
    start_node_id = str(uuid.uuid4())
    nodes.append(
        {
            "nodeId": start_node_id,
            "type": "start",
            "label": "Start",
            "position": {"x": 100, "y": 100},
            "config": {},
        }
    )

    # Smart grid layout: arrange nodes in rows to prevent sprawling too far
    nodes_per_row = 8
    x_spacing = 400  # Horizontal spacing between nodes
    y_spacing = 200  # Vertical spacing between rows
    start_x = 600  # Starting X position (after Start node)
    start_y = 100  # Starting Y position

    for idx, entry in enumerate(entries):
        request = entry.get("request", {})
        response = entry.get("response", {})

        node_id = str(uuid.uuid4())

        # Extract method and URL
        method = request.get("method", "GET")
        url = request.get("url", "")

        # Parse URL for host/path/query
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(url)
        host = parsed.netloc
        path = parsed.path or "/"
        query = parsed.query

        # Extract query params - prioritize HAR queryString, fallback to URL parsing
        query_params = {}
        har_query_string = request.get("queryString", [])
        if har_query_string:
            # Use HAR queryString if available
            for qp in har_query_string:
                k = qp.get("name", "")
                v = qp.get("value", "")
                query_params[k] = v
        elif query:
            # Fallback: parse from URL query string
            parsed_qs = parse_qs(query, keep_blank_values=True)
            for k, v_list in parsed_qs.items():
                query_params[k] = v_list[0] if v_list else ""

        # Build label: [METHOD] host/path (truncate long paths)
        path_display = path if len(path) <= 40 else path[:37] + "..."
        label = f"[{method}] {host}{path_display}"

        # Extract headers (as key-value)
        headers = {}
        for header in request.get("headers", []):
            header_name = header.get("name", "")
            header_value = header.get("value", "")
            if sanitize and detect_secrets_in_value(f"{header_name}:{header_value}"):
                headers[header_name] = "[FILTERED]"
            else:
                headers[header_name] = header_value

        # Extract cookies
        cookies = {}
        for ck in request.get("cookies", []):
            k = ck.get("name", "")
            v = ck.get("value", "")
            cookies[k] = v

        # Extract body
        post_data = request.get("postData", {})
        body = post_data.get("text", "") if post_data else None

        # Create example response metadata
        example_response = {
            "statusCode": response.get("status", 0),
            "statusText": response.get("statusText", ""),
            "headers": {h.get("name", ""): h.get("value", "") for h in response.get("headers", [])},
            "bodySize": response.get("bodySize", 0),
            "isExample": True,
        }

        # Convert objects to string format expected by frontend
        # Format: key=value\nkey2=value2
        headers_str = "\n".join([f"{k}={v}" for k, v in headers.items()]) if headers else ""
        query_params_str = (
            "\n".join([f"{k}={v}" for k, v in query_params.items()]) if query_params else ""
        )
        cookies_str = "\n".join([f"{k}={v}" for k, v in cookies.items()]) if cookies else ""

        # Calculate grid position
        row = idx // nodes_per_row
        col = idx % nodes_per_row
        x_position = start_x + col * x_spacing
        y_position = start_y + row * y_spacing

        # Create HTTP request node
        node_config = {
            "method": method,
            "url": url,
            "headers": headers_str,
            "queryParams": query_params_str,
            "cookies": cookies_str,
            "body": body,
            "timeout": 30,
            "followRedirects": True,
            "extractors": {},
            "exampleResponse": example_response,
        }

        node = {
            "nodeId": node_id,
            "type": "http-request",
            "label": label,
            "position": {"x": x_position, "y": y_position},
            "config": node_config,
        }

        nodes.append(node)
        # No auto-linking between nodes

    # Create end node positioned below the grid
    total_rows = (len(entries) + nodes_per_row - 1) // nodes_per_row  # Ceiling division
    end_x = start_x + (nodes_per_row // 2) * x_spacing  # Center horizontally
    end_y = start_y + total_rows * y_spacing + y_spacing  # Below last row

    end_node_id = str(uuid.uuid4())
    nodes.append(
        {
            "nodeId": end_node_id,
            "type": "end",
            "label": "End",
            "position": {"x": end_x, "y": end_y},
            "config": {},
        }
    )

    # Only connect Start to End (no HTTP node edges)
    edges.append(
        {"edgeId": str(uuid.uuid4()), "source": start_node_id, "target": end_node_id, "label": None}
    )

    workflow = {
        "name": f"Imported from HAR - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {len(entries)} HTTP requests from HAR file",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["har-import"],
    }

    return workflow


def resolve_openapi_schema_ref(ref_path: str, openapi_data: dict[str, Any]) -> dict[str, Any]:
    """Compatibility wrapper; implementation lives in app.utils.openapi_examples."""
    return resolve_openapi_schema_ref_helper(ref_path, openapi_data)


def generate_example_from_schema(schema: dict[str, Any], openapi_data: dict[str, Any]) -> Any:
    """Compatibility wrapper; implementation lives in app.utils.openapi_examples."""
    return generate_example_from_schema_helper(schema, openapi_data)


def normalize_openapi_path(path: str) -> str:
    """Normalize OpenAPI path for stable endpoint matching."""
    if not path:
        return "/"

    normalized = path.strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"

    normalized = re.sub(r"//+", "/", normalized)
    return normalized


def build_openapi_endpoint_fingerprint(
    method: str, path: str, operation_id: str = "", scope: str = ""
) -> str:
    """Build deterministic endpoint fingerprint for OpenAPI request nodes."""
    method_upper = (method or "GET").upper()
    normalized_path = normalize_openapi_path(path)
    operation_value = (operation_id or "").strip()
    scope_value = (scope or "").strip()
    return f"{scope_value}|{method_upper}|{normalized_path}|{operation_value}"


def parse_openapi_to_workflow(
    openapi_data: dict[str, Any],
    base_url: str = "",
    tag_filter: list[str] | None = None,
    sanitize: bool = True,
    source_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Convert OpenAPI/Swagger spec to APIWeave workflow format

    Args:
        openapi_data: Parsed OpenAPI/Swagger JSON
        base_url: Base URL to prepend to paths (from servers or user input)
        tag_filter: Optional list of tags to filter endpoints (if None, import all)
        sanitize: Whether to filter sensitive headers

    Returns:
        Workflow dict ready for import
    """
    paths = openapi_data.get("paths", {})

    if not paths:
        raise ValueError("OpenAPI spec contains no paths")

    # Get base URL from servers if not provided
    if not base_url:
        servers = openapi_data.get("servers", [])
        if servers and servers[0].get("url"):
            base_url = servers[0]["url"]
        else:
            base_url = ""

    nodes = []
    edges = []

    # Create start node
    start_node_id = str(uuid.uuid4())
    nodes.append(
        {
            "nodeId": start_node_id,
            "type": "start",
            "label": "Start",
            "position": {"x": 100, "y": 100},
            "config": {},
        }
    )

    # Smart grid layout: arrange nodes in rows to prevent sprawling too far
    # Strategy: Create a grid with ~8 nodes per row for balance
    nodes_per_row = 8
    x_spacing = 400  # Horizontal spacing between nodes
    y_spacing = 200  # Vertical spacing between rows
    start_x = 600  # Starting X position (after Start node)
    start_y = 100  # Starting Y position

    idx = 0
    for path, path_item in paths.items():
        for method in ["get", "post", "put", "patch", "delete", "head", "options"]:
            if method not in path_item:
                continue

            operation = path_item[method]

            # Filter by tags if specified
            operation_tags = operation.get("tags", [])
            if tag_filter and not any(tag in tag_filter for tag in operation_tags):
                continue

            node_id = str(uuid.uuid4())

            # Build full URL
            full_url = f"{base_url}{path}" if base_url else path
            normalized_path = normalize_openapi_path(path)

            # Extract query parameters from parameters list
            query_params = {}
            path_params = {}
            headers = {}

            for param in operation.get("parameters", []):
                param_name = param.get("name", "")
                param_in = param.get("in", "")
                param_required = param.get("required", False)
                param_schema = param.get("schema", {})
                param_example = param_schema.get("example", "")

                if param_in == "query":
                    query_params[param_name] = str(param_example) if param_example else ""
                elif param_in == "path":
                    path_params[param_name] = (
                        str(param_example) if param_example else f"{{{param_name}}}"
                    )
                elif param_in == "header":
                    if sanitize and detect_secrets_in_value(f"{param_name}:{param_example}"):
                        headers[param_name] = "[FILTERED]"
                    else:
                        headers[param_name] = str(param_example) if param_example else ""

            # Extract request body
            body = ""
            request_body = operation.get("requestBody", {})
            if request_body:
                content = request_body.get("content", {})
                # Try to get JSON content first
                if "application/json" in content:
                    schema = content["application/json"].get("schema", {})
                    # Generate example from schema (handles $ref resolution)
                    example_data = generate_example_from_schema(schema, openapi_data)
                    if example_data:
                        body = json.dumps(example_data, indent=2)
                    headers["Content-Type"] = "application/json"

            # Convert to string format
            headers_str = "\n".join([f"{k}={v}" for k, v in headers.items()]) if headers else ""
            query_params_str = (
                "\n".join([f"{k}={v}" for k, v in query_params.items()]) if query_params else ""
            )

            # Build label: [METHOD] /path - operationId
            operation_id = operation.get("operationId", "")
            summary = operation.get("summary", "")
            label_text = operation_id or summary or path
            if len(label_text) > 40:
                label_text = label_text[:37] + "..."
            label = f"[{method.upper()}] {label_text}"

            context = source_context or {}
            definition_scope = context.get("definitionScope") or ""

            openapi_meta = {
                "source": "openapi",
                "method": method.upper(),
                "path": normalized_path,
                "operationId": operation_id or None,
                "fingerprint": build_openapi_endpoint_fingerprint(
                    method.upper(),
                    normalized_path,
                    operation_id,
                    definition_scope,
                ),
            }

            for key in ("definitionName", "definitionSpecUrl", "definitionScope", "sourceUiUrl"):
                value = context.get(key)
                if value:
                    openapi_meta[key] = value

            # Calculate grid position
            row = idx // nodes_per_row
            col = idx % nodes_per_row
            x_position = start_x + col * x_spacing
            y_position = start_y + row * y_spacing

            # Create HTTP request node
            node_config = {
                "method": method.upper(),
                "url": full_url,
                "headers": headers_str,
                "queryParams": query_params_str,
                "cookies": "",
                "body": body if body else None,
                "timeout": 30,
                "followRedirects": True,
                "extractors": {},
                "openapiMeta": openapi_meta,
            }

            node = {
                "nodeId": node_id,
                "type": "http-request",
                "label": label,
                "position": {"x": x_position, "y": y_position},
                "config": node_config,
            }

            nodes.append(node)
            idx += 1

    # Create end node positioned below the grid
    total_rows = (idx + nodes_per_row - 1) // nodes_per_row  # Ceiling division
    end_x = start_x + (nodes_per_row // 2) * x_spacing  # Center horizontally
    end_y = start_y + total_rows * y_spacing + y_spacing  # Below last row

    end_node_id = str(uuid.uuid4())
    nodes.append(
        {
            "nodeId": end_node_id,
            "type": "end",
            "label": "End",
            "position": {"x": end_x, "y": end_y},
            "config": {},
        }
    )

    # Only connect Start to End
    edges.append(
        {"edgeId": str(uuid.uuid4()), "source": start_node_id, "target": end_node_id, "label": None}
    )

    api_title = openapi_data.get("info", {}).get("title", "API")
    workflow = {
        "name": f"Imported from OpenAPI - {api_title} - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {idx} endpoints from OpenAPI specification",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["openapi-import"],
    }

    return workflow


@router.post("", response_model=Workflow, status_code=status.HTTP_201_CREATED)
async def create_workflow(workflow: WorkflowCreate):
    """Create a new workflow using repository (SQL injection safe)"""
    # Use repository for type-safe, injection-protected creation
    created_workflow = await WorkflowRepository.create(workflow)
    return created_workflow


@router.get("", response_model=PaginatedWorkflows)
async def list_workflows(skip: int = 0, limit: int = 20, tag: str | None = None):
    """List workflows with pagination (SQL injection safe)"""
    # Use repository for type-safe, injection-protected queries
    workflows, total = await WorkflowRepository.list_all(skip, limit, tag)

    # Calculate if there are more results
    has_more = (skip + len(workflows)) < total

    return PaginatedWorkflows(
        workflows=workflows, total=total, skip=skip, limit=limit, hasMore=has_more
    )


@router.get("/unattached", response_model=PaginatedWorkflows)
async def list_unattached_workflows(skip: int = 0, limit: int = 20):
    """Get all workflows not attached to any collection (SQL injection safe)"""
    # Use repository for type-safe queries
    workflows, total = await WorkflowRepository.list_unattached(skip, limit)

    # Calculate if there are more results
    has_more = (skip + len(workflows)) < total

    return PaginatedWorkflows(
        workflows=workflows, total=total, skip=skip, limit=limit, hasMore=has_more
    )


@router.get("/{workflow_id}", response_model=Workflow)
async def get_workflow(workflow_id: str):
    """Get a workflow by ID (SQL injection safe)"""
    # Use repository for type-safe query
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    return workflow


@router.put("/{workflow_id}", response_model=Workflow)
async def update_workflow(workflow_id: str, update: WorkflowUpdate):
    """Update a workflow (SQL injection safe)"""
    # Use repository for type-safe update
    updated_workflow = await WorkflowRepository.update(workflow_id, update)

    if not updated_workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    return updated_workflow


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: str):
    """Delete a workflow (SQL injection safe)"""
    # Use repository for type-safe deletion
    deleted = await WorkflowRepository.delete(workflow_id)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    return None


@router.post("/{workflow_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_workflow(
    workflow_id: str,
    environmentId: str | None = Query(None),
    body: dict[str, Any] | None = None,
):
    """Trigger a workflow run with optional environment and runtime secrets.

    Body (optional JSON):
        { "secrets": { "API_KEY": "actual-value", ... } }

    Runtime secrets override the placeholder descriptions stored in the
    environment document so that real values are substituted at execution
    time without ever being persisted to the database.
    """
    import asyncio

    from app.repositories import EnvironmentRepository
    from app.runner.executor import WorkflowExecutor

    runtime_secrets = (body or {}).get("secrets", {}) if body else {}

    # Verify workflow exists using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    # Verify environment exists if provided
    if environmentId:
        environment = await EnvironmentRepository.get_by_id(environmentId)
        if not environment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environmentId} not found",
            )

    run_id = str(uuid.uuid4())
    now = datetime.now(UTC)

    # Create run using repository (type-safe)
    from app.models import RunCreate

    run_request = RunCreate(
        workflowId=workflow_id, variables=workflow.variables.copy() if workflow.variables else {}
    )

    # Create run document with all required fields
    run_doc_data = {
        "runId": run_id,
        "workflowId": workflow_id,
        "environmentId": environmentId,  # Store which environment to use for this run
        "status": "pending",
        "trigger": "manual",
        "variables": run_request.variables,
        "callbackUrl": None,
        "results": [],
        "createdAt": now,
        "startedAt": None,
        "completedAt": None,
        "duration": None,
        "error": None,
    }

    # Insert run directly using Beanie (repository create doesn't support custom runId)
    from app.models import Run

    run = Run(**run_doc_data)
    await run.insert()

    # Trigger workflow execution as a background task
    # This allows immediate response while execution happens in background
    async def execute_workflow():
        try:
            executor = WorkflowExecutor(run_id, workflow_id, runtime_secrets=runtime_secrets)
            await executor.execute()
        except Exception:
            # Error is already logged in executor
            pass

    # Schedule the execution as a background task (non-blocking)
    asyncio.create_task(execute_workflow())

    return {
        "message": "Workflow run triggered",
        "runId": run_id,
        "workflowId": workflow_id,
        "environmentId": environmentId,
        "status": "pending",
    }


@router.get("/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str, page: int = 1, limit: int = 10):
    """Get runs for a workflow with pagination (SQL injection safe)"""
    # Verify workflow exists using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    # Calculate skip value for pagination
    skip = (page - 1) * limit

    # Get runs using repository with pagination
    runs_list, total_count = await RunRepository.list_by_workflow(workflow_id, skip, limit)

    # Convert Beanie Documents to dicts for response (excluding heavy nodeStatuses)
    runs = []
    for run in runs_list:
        run_dict = {
            "runId": run.runId,
            "workflowId": run.workflowId,
            "status": run.status,
            "trigger": run.trigger,
            "createdAt": run.createdAt,
            "startedAt": run.startedAt,
            "completedAt": run.completedAt,
            "duration": run.duration,
            "error": run.error,
        }
        runs.append(run_dict)

    # Calculate pagination info
    total_pages = (total_count + limit - 1) // limit  # Ceiling division

    return {
        "runs": runs,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total_count,
            "totalPages": total_pages,
            "hasNext": page < total_pages,
            "hasPrevious": page > 1,
        },
    }


@router.get("/{workflow_id}/runs/{run_id}")
async def get_run_status(workflow_id: str, run_id: str):
    """Get the status of a workflow run with full node results (SQL injection safe)"""
    # Get run using repository
    run_doc = await RunRepository.get_by_id(run_id)
    if not run_doc or run_doc.workflowId != workflow_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")

    # Convert to dict for processing
    run = run_doc.model_dump(by_alias=True)
    run.pop("_id", None)  # Remove MongoDB _id if present

    # Fetch full node results from separate collection (still uses direct DB for GridFS)
    if run.get("nodeStatuses"):
        db = get_database()
        gridfs_bucket = AsyncIOMotorGridFSBucket(db)

        for node_id in run["nodeStatuses"].keys():
            full_result = await db.node_results.find_one(
                {"runId": run_id, "nodeId": node_id}, {"_id": 0}
            )
            if full_result:
                result = full_result.get("result", {})

                # Check if result is stored in GridFS
                if isinstance(result, dict) and result.get("stored_in_gridfs"):
                    gridfs_file_id = result.get("gridfs_file_id")
                    if gridfs_file_id:
                        try:
                            # Download the file from GridFS
                            grid_out = await gridfs_bucket.open_download_stream(
                                ObjectId(gridfs_file_id)
                            )
                            file_data = await grid_out.read()

                            # Parse JSON and replace with actual result
                            actual_result = json.loads(file_data.decode("utf-8"))

                            # Replace summary with full result (including GridFS metadata)
                            run["nodeStatuses"][node_id] = {
                                "status": full_result.get("status"),
                                "result": actual_result,  # Full result from GridFS
                                "timestamp": full_result.get("timestamp"),
                                "metadata": {
                                    "stored_in_gridfs": True,
                                    "size_mb": result.get("size_mb"),
                                },
                            }
                        except Exception as e:
                            # If GridFS fetch fails, keep the reference
                            run["nodeStatuses"][node_id] = {
                                "status": full_result.get("status"),
                                "result": {"error": f"Failed to retrieve large result: {str(e)}"},
                                "timestamp": full_result.get("timestamp"),
                            }
                    else:
                        # Missing file ID
                        run["nodeStatuses"][node_id] = {
                            "status": full_result.get("status"),
                            "result": result,
                            "timestamp": full_result.get("timestamp"),
                        }
                else:
                    # Regular result (not in GridFS)
                    run["nodeStatuses"][node_id] = {
                        "status": full_result.get("status"),
                        "result": result,
                        "timestamp": full_result.get("timestamp"),
                    }

    return run


@router.get("/{workflow_id}/runs/{run_id}/nodes/{node_id}/result")
async def get_node_result(workflow_id: str, run_id: str, node_id: str):
    """
    Get the full result for a specific node in a run (SQL injection safe).
    Handles both regular results and GridFS-stored large results.
    """
    # Verify run exists using repository
    run = await RunRepository.get_by_id(run_id)
    if not run or run.workflowId != workflow_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Run {run_id} not found")

    # Fetch node result from direct DB (GridFS collection not in Beanie yet)
    db = get_database()
    node_result = await db.node_results.find_one({"runId": run_id, "nodeId": node_id}, {"_id": 0})

    if not node_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Result for node {node_id} not found"
        )

    # Check if result is stored in GridFS
    result = node_result.get("result", {})
    if result.get("stored_in_gridfs"):
        gridfs_file_id = result.get("gridfs_file_id")
        if not gridfs_file_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="GridFS file ID missing"
            )

        try:
            # Initialize GridFS bucket
            gridfs_bucket = AsyncIOMotorGridFSBucket(db)

            # Download the file from GridFS
            grid_out = await gridfs_bucket.open_download_stream(ObjectId(gridfs_file_id))
            file_data = await grid_out.read()

            # Parse JSON and return
            full_result = json.loads(file_data.decode("utf-8"))

            return {
                "nodeId": node_id,
                "runId": run_id,
                "status": node_result.get("status"),
                "timestamp": node_result.get("timestamp"),
                "result": full_result,
                "metadata": {
                    "stored_in_gridfs": True,
                    "size_mb": result.get("size_mb"),
                    "gridfs_file_id": gridfs_file_id,
                },
            }

        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to retrieve result from GridFS: {str(e)}",
            )

    # Regular result (not in GridFS)
    return {
        "nodeId": node_id,
        "runId": run_id,
        "status": node_result.get("status"),
        "timestamp": node_result.get("timestamp"),
        "result": result,
        "metadata": {"stored_in_gridfs": False},
    }


@router.get("/{workflow_id}/export")
async def export_workflow(workflow_id: str, include_environment: bool = Query(True)):
    """
    Export a complete workflow bundle as JSON
    Includes workflow, referenced environment (without secrets), and metadata
    Secrets are replaced with <SECRET> placeholders
    """
    try:
        # Fetch workflow using repository
        workflow_doc = await WorkflowRepository.get_by_id(workflow_id)
        if not workflow_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
            )

        # Convert Beanie Document to dict
        workflow = serialize_document_for_export(workflow_doc)

        # Convert datetime objects to ISO strings
        if workflow.get("createdAt"):
            workflow["createdAt"] = workflow["createdAt"].isoformat()
        if workflow.get("updatedAt"):
            workflow["updatedAt"] = workflow["updatedAt"].isoformat()

        # Track secret references
        secret_refs = []

        # Sanitize secrets in workflow variables
        if workflow.get("variables"):
            workflow["variables"] = sanitize_secrets_in_dict(
                workflow["variables"], secret_refs, "variables"
            )

        # Sanitize secrets in node configs
        for node in workflow.get("nodes", []):
            if node.get("config"):
                node["config"] = sanitize_secrets_in_dict(
                    node["config"], secret_refs, f"nodes.{node['nodeId']}.config"
                )

        # Build export bundle
        export_bundle = {
            "workflow": workflow,
            "environments": [],
            "secretReferences": secret_refs,
            "metadata": {
                "exportedAt": datetime.now(UTC).isoformat(),
                "apiweaveVersion": settings.VERSION,
                "sourceHost": None,
            },
        }

        # Include environment if requested and workflow has one
        if include_environment and workflow.get("environmentId"):
            env_id = workflow["environmentId"]
            environment_doc = await EnvironmentRepository.get_by_id(env_id)

            if environment_doc:
                # Convert Beanie Document to dict
                environment = serialize_document_for_export(environment_doc)

                # Convert datetime objects to ISO strings
                if environment.get("createdAt"):
                    environment["createdAt"] = environment["createdAt"].isoformat()
                if environment.get("updatedAt"):
                    environment["updatedAt"] = environment["updatedAt"].isoformat()

                # Sanitize secrets in environment variables
                if environment.get("variables"):
                    environment["variables"] = sanitize_secrets_in_dict(
                        environment["variables"], secret_refs, f"environments.{env_id}.variables"
                    )
                export_bundle["environments"].append(environment)

        return export_bundle

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"Export error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Export failed: {str(e)}"
        )


@router.post("/import")
async def import_workflow(
    bundle: dict[str, Any],
    environment_mapping: dict[str, str] | None = None,
    create_missing_environments: bool = True,
    sanitize: bool = False,
):
    """
    Import a workflow bundle
    Validates structure, handles environment mapping, optionally creates missing environments
    """
    # Validate bundle structure
    if "workflow" not in bundle:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid bundle: missing 'workflow' key"
        )

    workflow_data = bundle["workflow"]
    environments = bundle.get("environments", [])

    # Validate required workflow fields
    required_fields = ["name", "nodes", "edges"]
    for field in required_fields:
        if field not in workflow_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid workflow: missing '{field}' field",
            )

    # Handle environment mapping
    old_env_id = workflow_data.get("environmentId")
    new_env_id = None

    if old_env_id:
        # Check if there's a mapping provided
        if environment_mapping and old_env_id in environment_mapping:
            new_env_id = environment_mapping[old_env_id]

            # Verify mapped environment exists using repository
            existing_env = await EnvironmentRepository.get_by_id(new_env_id)
            if not existing_env:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Mapped environment {new_env_id} not found",
                )
        elif create_missing_environments and environments:
            # Try to find the environment in the bundle and create it
            env_data = next((e for e in environments if e.get("environmentId") == old_env_id), None)
            if env_data:
                # Create new environment with new ID using repository
                from app.models import EnvironmentCreate

                env_create = EnvironmentCreate(
                    name=env_data.get("name", "Imported Environment"),
                    description=env_data.get("description"),
                    swaggerDocUrl=env_data.get("swaggerDocUrl"),
                    variables=env_data.get("variables", {}),
                    secrets={},  # Secrets not included in exports
                )

                new_env = await EnvironmentRepository.create(env_create)
                new_env_id = new_env.environmentId
        else:
            # No mapping and can't create - set to null
            new_env_id = None

    # Optionally sanitize again (belt and suspenders)
    if sanitize:
        if workflow_data.get("variables"):
            secret_refs = []
            workflow_data["variables"] = sanitize_secrets_in_dict(
                workflow_data["variables"], secret_refs
            )

        for node in workflow_data.get("nodes", []):
            if node.get("config"):
                secret_refs = []
                node["config"] = sanitize_secrets_in_dict(node["config"], secret_refs)

    workflow_create = WorkflowCreate(
        name=workflow_data["name"],
        description=workflow_data.get("description"),
        nodes=workflow_data["nodes"],
        edges=workflow_data["edges"],
        variables=workflow_data.get("variables", {}),
        tags=workflow_data.get("tags", []),
        collectionId=None,
        nodeTemplates=workflow_data.get("nodeTemplates", []),
    )

    created_workflow = await WorkflowRepository.create(workflow_create)
    if new_env_id:
        created_workflow.environmentId = new_env_id
        created_workflow.updatedAt = datetime.now(UTC)
        await created_workflow.save()

    return {
        "message": "Workflow imported successfully",
        "workflowId": created_workflow.workflowId,
        "environmentId": new_env_id,
        "secretReferences": bundle.get("secretReferences", []),
    }


@router.post("/import/dry-run")
async def import_workflow_dry_run(bundle: dict[str, Any]):
    """
    Validate a workflow bundle without persisting
    Returns summary of what would be created/modified
    """
    # Validate bundle structure
    errors = []
    warnings = []

    if "workflow" not in bundle:
        errors.append("Missing 'workflow' key in bundle")
        return {"valid": False, "errors": errors, "warnings": warnings}

    workflow_data = bundle["workflow"]

    # Validate required workflow fields
    required_fields = ["name", "nodes", "edges"]
    for field in required_fields:
        if field not in workflow_data:
            errors.append(f"Missing required field: '{field}'")

    # Validate nodes
    if "nodes" in workflow_data:
        node_ids = set()
        for idx, node in enumerate(workflow_data["nodes"]):
            if "nodeId" not in node:
                errors.append(f"Node at index {idx} missing 'nodeId'")
            else:
                if node["nodeId"] in node_ids:
                    errors.append(f"Duplicate node ID: {node['nodeId']}")
                node_ids.add(node["nodeId"])

            if "type" not in node:
                errors.append(f"Node {node.get('nodeId', idx)} missing 'type'")

    # Validate edges
    if "edges" in workflow_data and "nodes" in workflow_data:
        node_ids = {node["nodeId"] for node in workflow_data["nodes"]}
        for idx, edge in enumerate(workflow_data["edges"]):
            if "source" not in edge or "target" not in edge:
                errors.append(f"Edge at index {idx} missing 'source' or 'target'")
            else:
                if edge["source"] not in node_ids:
                    errors.append(f"Edge references non-existent source node: {edge['source']}")
                if edge["target"] not in node_ids:
                    errors.append(f"Edge references non-existent target node: {edge['target']}")

    # Check for environment references using repository
    old_env_id = workflow_data.get("environmentId")
    if old_env_id:
        env_exists = await EnvironmentRepository.get_by_id(old_env_id)
        if not env_exists:
            # Check if environment is in bundle
            environments = bundle.get("environments", [])
            env_in_bundle = any(e.get("environmentId") == old_env_id for e in environments)

            if env_in_bundle:
                warnings.append(f"Environment {old_env_id} will be created from bundle")
            else:
                warnings.append(f"Environment {old_env_id} not found - workflow will be unattached")

    # Check for secret references
    secret_refs = bundle.get("secretReferences", [])
    if secret_refs:
        warnings.append(
            f"Workflow contains {len(secret_refs)} secret references that must be re-entered"
        )

    summary = {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "nodes": len(workflow_data.get("nodes", [])),
            "edges": len(workflow_data.get("edges", [])),
            "variables": len(workflow_data.get("variables", {})),
            "secretReferences": len(secret_refs),
            "environmentsIncluded": len(bundle.get("environments", [])),
        },
    }

    return summary


@router.post("/import/har")
async def import_har_file(
    file: UploadFile | None = File(None),
    import_mode: str = Query("linear"),
    environment_id: str | None = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False),  # NEW: Just return nodes without creating workflow
):
    """
    Import a HAR file and convert to workflow
    Accepts file upload via multipart/form-data

    If parse_only=true, returns just the parsed nodes array without creating a workflow
    """
    try:
        # Parse HAR data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="HAR file is required"
            )

        contents = await file.read()
        try:
            har_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in HAR file: {str(e)}",
            )

        # Validate HAR structure
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key",
            )

        # Convert HAR to workflow
        try:
            workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {"totalRequests": len(http_nodes), "importMode": import_mode},
            }

        # Otherwise, create full workflow in database using repository
        workflow_create = WorkflowCreate(
            name=workflow_data["name"],
            description=workflow_data["description"],
            nodes=workflow_data["nodes"],
            edges=workflow_data["edges"],
            variables=workflow_data.get("variables", {}),
            tags=workflow_data.get("tags", []),
            collectionId=None,
            nodeTemplates=[],
        )

        created_workflow = await WorkflowRepository.create(workflow_create)
        if environment_id:
            created_workflow.environmentId = environment_id
            created_workflow.updatedAt = datetime.now(UTC)
            await created_workflow.save()

        return {
            "message": "HAR file imported successfully",
            "workflowId": created_workflow.workflowId,
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importMode": import_mode,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"HAR import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import HAR file: {str(e)}",
        )


@router.post("/import/har/dry-run")
async def import_har_dry_run(
    file: UploadFile | None = File(None),
    import_mode: str = Query("linear"),
    sanitize: bool = Query(True),
):
    """
    Preview HAR import without persisting
    Returns proposed workflow structure
    """
    try:
        # Parse HAR data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="HAR file is required"
            )

        contents = await file.read()
        try:
            har_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in HAR file: {str(e)}",
            )

        # Validate HAR structure
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key",
            )

        # Convert HAR to workflow (preview only)
        try:
            workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # Return preview
        return {
            "message": "HAR preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"]),
            },
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importMode": import_mode,
                "entries": len(har_data.get("log", {}).get("entries", [])),
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"HAR dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview HAR file: {str(e)}",
        )

    # Return preview
    entries = har_data.get("log", {}).get("entries", [])
    preview_entries = []

    for entry in entries[:10]:  # Show first 10 for preview
        request = entry.get("request", {})
        preview_entries.append(
            {
                "method": request.get("method", ""),
                "url": request.get("url", ""),
                "time": entry.get("time", 0),
            }
        )

    return {
        "valid": True,
        "workflow": workflow_data,
        "preview": preview_entries,
        "stats": {
            "totalEntries": len(entries),
            "nodes": len(workflow_data["nodes"]),
            "edges": len(workflow_data["edges"]),
            "importMode": import_mode,
        },
    }


@router.post("/import/openapi")
async def import_openapi_file(
    file: UploadFile | None = File(None),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False),  # NEW: Just return nodes without creating workflow
):
    """
    Import an OpenAPI/Swagger file and convert to workflow
    Accepts file upload via multipart/form-data

    If parse_only=true, returns just the parsed nodes array without creating a workflow
    """
    try:
        # Parse OpenAPI data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="OpenAPI file is required"
            )

        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {str(e)}",
            )

        # Validate OpenAPI structure
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key",
            )

        # Parse tag filter
        tags = tag_filter.split(",") if tag_filter else None

        # Convert OpenAPI to workflow
        try:
            workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalEndpoints": len(http_nodes),
                    "apiTitle": openapi_data.get("info", {}).get("title", "API"),
                },
            }

        # Otherwise, create full workflow in database using repository
        workflow_create = WorkflowCreate(
            name=workflow_data["name"],
            description=workflow_data["description"],
            nodes=workflow_data["nodes"],
            edges=workflow_data["edges"],
            variables=workflow_data.get("variables", {}),
            tags=workflow_data.get("tags", []),
            collectionId=None,
            nodeTemplates=[],
        )

        created_workflow = await WorkflowRepository.create(workflow_create)

        return {
            "message": "OpenAPI file imported successfully",
            "workflowId": created_workflow.workflowId,
            "stats": {
                "totalEndpoints": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "apiTitle": openapi_data.get("info", {}).get("title", "API"),
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"OpenAPI import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI file: {str(e)}",
        )


def _extract_openapi_document(response: httpx.Response) -> dict[str, Any] | None:
    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError):
        data = None

    if isinstance(data, dict) and "paths" in data:
        return data

    content_type = (response.headers.get("content-type") or "").lower()
    body_text = response.text or ""
    should_try_yaml = (
        "yaml" in content_type
        or body_text.lstrip().startswith("openapi:")
        or body_text.lstrip().startswith("swagger:")
    )

    if not should_try_yaml:
        return None

    try:
        import yaml  # type: ignore
    except Exception:
        return None

    try:
        yaml_data = yaml.safe_load(body_text)
    except Exception:
        return None

    if isinstance(yaml_data, dict) and "paths" in yaml_data:
        return yaml_data

    return None


def _dedupe_definitions(definitions: list[dict[str, str]]) -> list[dict[str, str]]:
    deduped: list[dict[str, str]] = []
    seen = set()

    for item in definitions:
        spec_url = (item.get("specUrl") or "").strip()
        if not spec_url or spec_url in seen:
            continue
        seen.add(spec_url)
        deduped.append(
            {
                "name": (item.get("name") or "").strip() or spec_url,
                "specUrl": spec_url,
                "source": (item.get("source") or "discovered").strip() or "discovered",
            }
        )

    return deduped


async def _discover_definitions_from_swagger_ui(
    client: httpx.AsyncClient,
    swagger_ui_url: str,
    html_text: str,
) -> dict[str, Any]:
    query_hints = parse_swagger_ui_query_hints(swagger_ui_url)
    html_hints = extract_swagger_ui_hints_from_html(html_text)

    definitions: list[dict[str, str]] = []

    # Explicit query-provided doc URL
    if query_hints.get("url"):
        definitions.append(
            {
                "name": query_hints.get("primaryName") or "Default",
                "specUrl": resolve_url(swagger_ui_url, query_hints["url"]),
                "source": "swagger-ui.query.url",
            }
        )

    # Inline HTML hints
    for entry in html_hints.get("urls") or []:
        definitions.append(
            {
                "name": (entry.get("name") or "").strip() or (entry.get("url") or "").strip(),
                "specUrl": resolve_url(swagger_ui_url, entry.get("url") or ""),
                "source": "swagger-ui.html.urls",
            }
        )

    if html_hints.get("url"):
        definitions.append(
            {
                "name": query_hints.get("primaryName") or "Default",
                "specUrl": resolve_url(swagger_ui_url, html_hints["url"]),
                "source": "swagger-ui.html.url",
            }
        )

    primary_name = query_hints.get("primaryName")
    config_candidates = build_swagger_config_candidates(swagger_ui_url, query_hints, html_hints)

    for candidate in config_candidates:
        try:
            response = await client.get(
                candidate,
                headers={
                    "Accept": "application/json, application/vnd.oai.openapi+json",
                },
            )
            response.raise_for_status()
            config_data = response.json()
            if not isinstance(config_data, dict):
                continue
            extracted = extract_definitions_from_swagger_config(config_data, str(response.url))
            if extracted.get("primaryName") and not primary_name:
                primary_name = extracted["primaryName"]
            definitions.extend(extracted.get("definitions") or [])
            if extracted.get("definitions"):
                break
        except Exception:
            continue

    deduped = _dedupe_definitions(definitions)
    return {
        "definitions": deduped,
        "primaryName": primary_name,
    }


@router.get("/import/openapi/url")
async def import_openapi_from_url(
    swagger_url: str = Query(...),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
):
    """
    Parse OpenAPI/Swagger JSON from a URL and return HTTP request nodes.
    """
    url = (swagger_url or "").strip()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="swagger_url is required"
        )

    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="swagger_url must start with http:// or https://",
        )

    try:
        tags = tag_filter.split(",") if tag_filter else None

        async with httpx.AsyncClient(
            timeout=DEFAULT_FETCH_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            initial_response = await client.get(
                url,
                headers={
                    "Accept": "application/json, application/vnd.oai.openapi+json, text/html",
                },
            )
            initial_response.raise_for_status()

            direct_spec = _extract_openapi_document(initial_response)

            discovered_definitions: list[dict[str, str]] = []
            primary_name: str | None = None

            if direct_spec:
                discovered_definitions = [
                    {
                        "name": direct_spec.get("info", {}).get("title") or "Default",
                        "specUrl": url,
                        "source": "direct-url",
                    }
                ]
            else:
                discovery = await _discover_definitions_from_swagger_ui(
                    client,
                    swagger_ui_url=url,
                    html_text=initial_response.text,
                )
                discovered_definitions = discovery.get("definitions") or []
                primary_name = discovery.get("primaryName")

                if not discovered_definitions:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            "Could not discover OpenAPI definitions from Swagger UI URL. "
                            "Use a direct OpenAPI spec URL or verify Swagger UI config exposure."
                        ),
                    )

            definition_limit_error = validate_definition_limit(len(discovered_definitions))
            if definition_limit_error:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=definition_limit_error,
                )

            successful_specs: list[dict[str, Any]] = []
            failed_definitions: list[dict[str, str]] = []

            async def fetch_definition(definition: dict[str, str]) -> dict[str, Any]:
                definition_name = definition.get("name") or "Definition"
                spec_url = definition.get("specUrl") or ""
                if not spec_url:
                    return {
                        "status": "failed",
                        "name": definition_name,
                        "specUrl": spec_url,
                        "error": "Missing spec URL",
                    }

                if direct_spec and spec_url == url:
                    return {
                        "status": "imported",
                        "definition": definition,
                        "openapi_data": direct_spec,
                    }

                try:
                    spec_response = await client.get(
                        spec_url,
                        headers={
                            "Accept": "application/json, application/vnd.oai.openapi+json",
                        },
                    )
                    spec_response.raise_for_status()
                    openapi_data = _extract_openapi_document(spec_response)
                    if not openapi_data:
                        raise ValueError(
                            "Definition URL did not return a valid OpenAPI JSON document"
                        )

                    return {
                        "status": "imported",
                        "definition": definition,
                        "openapi_data": openapi_data,
                    }
                except Exception as exc:
                    return {
                        "status": "failed",
                        "name": definition_name,
                        "specUrl": spec_url,
                        "error": str(exc),
                    }

            semaphore = asyncio.Semaphore(DEFAULT_FETCH_CONCURRENCY)

            async def fetch_with_limit(definition: dict[str, str]) -> dict[str, Any]:
                async with semaphore:
                    return await fetch_definition(definition)

            fetch_results = await asyncio.gather(
                *(fetch_with_limit(definition) for definition in discovered_definitions)
            )

            for result in fetch_results:
                if result.get("status") == "imported":
                    successful_specs.append(
                        {
                            "definition": result["definition"],
                            "openapi_data": result["openapi_data"],
                        }
                    )
                else:
                    failed_definitions.append(
                        {
                            "name": result["name"],
                            "specUrl": result["specUrl"],
                            "error": result["error"],
                        }
                    )

        if not successful_specs:
            first_error = (
                failed_definitions[0]["error"] if failed_definitions else "Unknown fetch error"
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch any OpenAPI definitions: {first_error}",
            )

        total_discovered = len(discovered_definitions)
        total_imported = len(successful_specs)
        is_multi_definition = total_discovered > 1

        all_http_nodes: list[dict[str, Any]] = []
        definition_summaries: list[dict[str, Any]] = []

        for bundle in successful_specs:
            definition = bundle["definition"]
            definition_name = definition.get("name") or "Definition"
            definition_spec_url = definition.get("specUrl") or ""
            definition_scope = make_definition_scope(definition_name, definition_spec_url)

            workflow_data = parse_openapi_to_workflow(
                bundle["openapi_data"],
                base_url,
                tags,
                sanitize,
                source_context={
                    "definitionName": definition_name,
                    "definitionSpecUrl": definition_spec_url,
                    "definitionScope": definition_scope,
                    "sourceUiUrl": url,
                },
            )
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]

            if is_multi_definition:
                for node in http_nodes:
                    label = node.get("label") or node.get("config", {}).get("url") or "Request"
                    node["label"] = f"[{definition_name}] {label}"

            all_http_nodes.extend(http_nodes)

            endpoint_limit_error = validate_endpoint_limit(len(all_http_nodes))
            if endpoint_limit_error:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=endpoint_limit_error,
                )

            definition_summaries.append(
                {
                    "name": definition_name,
                    "specUrl": definition_spec_url,
                    "status": "imported",
                    "endpointCount": len(http_nodes),
                    "source": definition.get("source") or "discovered",
                }
            )

        for failed in failed_definitions:
            definition_summaries.append(
                {
                    "name": failed["name"],
                    "specUrl": failed["specUrl"],
                    "status": "failed",
                    "endpointCount": 0,
                    "error": failed["error"],
                }
            )

        api_title = (
            "Multiple APIs"
            if total_imported > 1
            else (successful_specs[0]["openapi_data"].get("info", {}).get("title", "API"))
        )

        return {
            "nodes": all_http_nodes,
            "definitions": definition_summaries,
            "stats": {
                "totalEndpoints": len(all_http_nodes),
                "apiTitle": api_title,
                "sourceUrl": url,
                "definitionCount": total_discovered,
                "importedDefinitionCount": total_imported,
                "failedDefinitionCount": len(failed_definitions),
                "primaryName": primary_name,
            },
            "warnings": [
                {
                    "type": "definition-fetch-failed",
                    "name": item["name"],
                    "specUrl": item["specUrl"],
                    "message": item["error"],
                }
                for item in failed_definitions
            ],
        }

    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch Swagger URL ({e.response.status_code})",
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to fetch Swagger URL: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI from URL: {str(e)}",
        )


@router.post("/import/openapi/dry-run")
async def import_openapi_dry_run(
    file: UploadFile | None = File(None),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
):
    """
    Preview OpenAPI import without persisting
    Returns proposed workflow structure
    """
    try:
        # Parse OpenAPI data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="OpenAPI file is required"
            )

        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {str(e)}",
            )

        # Validate OpenAPI structure
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key",
            )

        # Parse tag filter
        tags = tag_filter.split(",") if tag_filter else None

        # Get available tags from spec
        available_tags = []
        spec_tags = openapi_data.get("tags", [])
        for tag in spec_tags:
            available_tags.append(
                {"name": tag.get("name", ""), "description": tag.get("description", "")}
            )

        # Get available servers
        available_servers = []
        for server in openapi_data.get("servers", []):
            available_servers.append(
                {"url": server.get("url", ""), "description": server.get("description", "")}
            )

        # Convert OpenAPI to workflow (preview only)
        try:
            workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # Return preview
        return {
            "message": "OpenAPI preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"]),
            },
            "stats": {
                "totalEndpoints": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "apiTitle": openapi_data.get("info", {}).get("title", "API"),
                "apiVersion": openapi_data.get("info", {}).get("version", ""),
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "availableTags": available_tags,
            "availableServers": available_servers,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"OpenAPI dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview OpenAPI file: {str(e)}",
        )


@router.post("/import/curl/dry-run")
async def import_curl_dry_run(sanitize: bool = Query(True), curl_command: str | None = Query(None)):
    """
    Preview curl command(s) import without persisting
    Returns proposed workflow structure
    Accepts curl command via query parameter or request body
    """
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="curl command is required"
            )

        # Convert curl to workflow (preview only)
        try:
            workflow_data = parse_curl_to_workflow(curl_command, sanitize)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # Return preview
        return {
            "message": "Curl preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"]),
            },
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importType": "curl",
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"Curl dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview curl command: {str(e)}",
        )


@router.put("/{workflow_id}/collection")
async def attach_workflow_to_collection(workflow_id: str, collection_id: str | None = Query(None)):
    """
    Attach or detach a workflow to/from a collection (SQL injection safe).

    If collection_id is null, workflow becomes unattached.
    Multiple workflows can be attached to the same collection.
    """
    # Verify workflow exists using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    # If attaching, verify collection exists using repository
    if collection_id:
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection {collection_id} not found",
            )

    # Update workflow using repository
    updated_workflow = await WorkflowRepository.update_collection_assignment(
        workflow_id, collection_id
    )

    return updated_workflow


@router.get("/by-collection/{collection_id}")
async def list_workflows_by_collection(collection_id: str):
    """Get all workflows attached to a collection (SQL injection safe)"""
    # Use repository for type-safe query
    workflows, _ = await WorkflowRepository.list_by_collection(collection_id, skip=0, limit=1000)
    return workflows


@router.post("/bulk-attach-collection")
async def bulk_attach_workflows(
    workflow_ids: list[str] = Query(...), collection_id: str | None = Query(None)
):
    """Attach multiple workflows to a collection (SQL injection safe)."""
    # Verify all workflows exist using repository
    for wid in workflow_ids:
        workflow = await WorkflowRepository.get_by_id(wid)
        if not workflow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {wid} not found"
            )

    # If attaching, verify collection exists using repository
    if collection_id:
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection {collection_id} not found",
            )

    # Update all workflows using repository
    for wid in workflow_ids:
        await WorkflowRepository.update_collection_assignment(wid, collection_id)

    return {
        "message": f"Updated {len(workflow_ids)} workflows",
        "count": len(workflow_ids),
        "collectionId": collection_id,
    }


# Node Templates Management Endpoints


@router.get("/{workflow_id}/templates")
async def get_workflow_templates(workflow_id: str):
    """Get all node templates for a workflow (SQL injection safe)"""
    # Use repository for type-safe query
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    return {"workflowId": workflow_id, "templates": workflow.nodeTemplates}


@router.post("/{workflow_id}/templates")
async def add_workflow_templates(workflow_id: str, templates: list[dict[str, Any]]):
    """Add node templates to a workflow (appends to existing templates - SQL injection safe)"""
    # Get workflow using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    # Get existing templates
    existing_templates = workflow.nodeTemplates if workflow.nodeTemplates else []

    # Append new templates
    updated_templates = existing_templates + templates

    # Update workflow using Beanie
    workflow.nodeTemplates = updated_templates
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()

    return {
        "message": f"Added {len(templates)} template(s) to workflow",
        "workflowId": workflow_id,
        "totalTemplates": len(updated_templates),
    }


@router.put("/{workflow_id}/templates")
async def replace_workflow_templates(workflow_id: str, templates: list[dict[str, Any]]):
    """Replace all node templates for a workflow (SQL injection safe)"""
    # Get workflow using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    # Replace templates using Beanie
    workflow.nodeTemplates = templates
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()

    return {
        "message": "Templates replaced successfully",
        "workflowId": workflow_id,
        "totalTemplates": len(templates),
    }


@router.delete("/{workflow_id}/templates")
async def clear_workflow_templates(workflow_id: str):
    """Clear all node templates for a workflow (SQL injection safe)"""
    # Get workflow using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflow_id} not found"
        )

    # Clear templates using Beanie
    workflow.nodeTemplates = []
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()

    return {"message": "Templates cleared successfully", "workflowId": workflow_id}


@router.post("/import/curl")
async def import_curl_file(
    sanitize: bool = Query(True),
    curl_command: str | None = Query(None),
    workflowId: str | None = Query(None),
    parse_only: bool = Query(False),  # NEW: Just return nodes without creating workflow
):
    """
    Import curl command(s) and convert to workflow.

    If parse_only=true, returns just the parsed nodes array without creating/updating a workflow.
    If workflowId is provided, append to that workflow. Otherwise, create new workflow.
    """
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="curl command is required"
            )
        # Convert curl to workflow nodes/edges
        try:
            workflow_data = parse_curl_to_workflow(curl_command, sanitize)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {"totalRequests": len(http_nodes), "importType": "curl"},
            }

        if workflowId:
            # Append to existing workflow using repository
            existing = await WorkflowRepository.get_by_id(workflowId)
            if not existing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=f"Workflow {workflowId} not found"
                )
            # Remove start/end nodes from imported data
            imported_nodes = [
                n for n in workflow_data["nodes"] if n["type"] != "start" and n["type"] != "end"
            ]
            imported_edges = [e for e in workflow_data["edges"]]
            # Re-ID nodes/edges to avoid collisions
            node_id_map = {}
            for node in imported_nodes:
                old_id = node["nodeId"]
                new_id = str(uuid.uuid4())
                node_id_map[old_id] = new_id
                node["nodeId"] = new_id
            for edge in imported_edges:
                if edge["source"] in node_id_map:
                    edge["source"] = node_id_map[edge["source"]]
                if edge["target"] in node_id_map:
                    edge["target"] = node_id_map[edge["target"]]
                edge["edgeId"] = str(uuid.uuid4())

            # --- Offset imported nodes to avoid overlap ---
            # Find max X and Y of existing nodes
            existing_positions = [
                n.position for n in existing.nodes if n.position and len(n.position) > 0
            ]
            if existing_positions:
                max_x = max(pos.get("x", 0) for pos in existing_positions)
                max_y = max(pos.get("y", 0) for pos in existing_positions)
            else:
                max_x = 0
                max_y = 0
            # Offset imported nodes: position them to the right of the rightmost node
            # Add some padding (e.g., 100px) to avoid overlap
            x_offset = max_x + 100 if existing_positions else 600
            # Keep them roughly at the same Y level
            y_offset = 0
            for node in imported_nodes:
                if "position" in node and isinstance(node["position"], dict):
                    node["position"]["x"] = node["position"].get("x", 0) + x_offset
                    node["position"]["y"] = node["position"].get("y", 0) + y_offset

            # Append nodes/edges - convert to model format first
            # Convert Beanie Document nodes to dicts for manipulation
            existing_nodes_dicts = [
                n.model_dump() if hasattr(n, "model_dump") else n for n in existing.nodes
            ]
            existing_edges_dicts = [
                e.model_dump() if hasattr(e, "model_dump") else e for e in existing.edges
            ]

            updated_nodes_dicts = existing_nodes_dicts + imported_nodes
            updated_edges_dicts = existing_edges_dicts + imported_edges

            # Update workflow using repository update method
            await WorkflowRepository.update(
                workflowId, WorkflowUpdate(nodes=updated_nodes_dicts, edges=updated_edges_dicts)
            )

            return {
                "message": f"Curl commands imported and appended to workflow {workflowId}",
                "workflowId": workflowId,
                "stats": {"totalRequests": len(imported_nodes), "importType": "curl"},
            }
        else:
            # Create new workflow as before using repository
            workflow_create = WorkflowCreate(
                name=workflow_data["name"],
                description=workflow_data["description"],
                nodes=workflow_data["nodes"],
                edges=workflow_data["edges"],
                variables=workflow_data.get("variables", {}),
                tags=workflow_data.get("tags", []),
                collectionId=None,
                nodeTemplates=[],
            )
            created_workflow = await WorkflowRepository.create(workflow_create)
            return {
                "message": "Curl commands imported successfully",
                "workflowId": created_workflow.workflowId,
                "stats": {
                    "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                    "importType": "curl",
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"Curl import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import curl command: {str(e)}",
        )
