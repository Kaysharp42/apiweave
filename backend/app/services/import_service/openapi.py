"""
OpenAPI import — parse OpenAPI/Swagger specs into APIWeave workflow format.
"""

import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from app.services.secret_utils import detect_secrets_in_value


def parse_openapi_to_workflow(
    openapi_data: dict[str, Any],
    base_url: str = "",
    tag_filter: list[str] | None = None,
    sanitize: bool = True,
    source_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Convert OpenAPI/Swagger spec to APIWeave workflow format."""
    paths = openapi_data.get("paths", {})
    if not paths:
        raise ValueError("OpenAPI spec contains no paths")

    if not base_url:
        servers = openapi_data.get("servers", [])
        if servers and servers[0].get("url"):
            base_url = servers[0]["url"]
        else:
            base_url = ""

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

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

    nodes_per_row = 8
    x_spacing = 400
    y_spacing = 200
    start_x = 600
    start_y = 100

    idx = 0
    for path, path_item in paths.items():
        for method in ["get", "post", "put", "patch", "delete", "head", "options"]:
            if method not in path_item:
                continue

            operation = path_item[method]
            operation_tags = operation.get("tags", [])
            if tag_filter and not any(tag in tag_filter for tag in operation_tags):
                continue

            node_id = str(uuid.uuid4())
            full_url = f"{base_url}{path}" if base_url else path
            normalized_path = _normalize_openapi_path(path)

            query_params: dict[str, str] = {}
            headers: dict[str, str] = {}

            for param in operation.get("parameters", []):
                param_name = param.get("name", "")
                param_in = param.get("in", "")
                param_schema = param.get("schema", {})
                param_example = param_schema.get("example", "")

                if param_in == "query":
                    query_params[param_name] = str(param_example) if param_example else ""
                elif param_in == "header":
                    if sanitize and detect_secrets_in_value(f"{param_name}:{param_example}"):
                        headers[param_name] = "[FILTERED]"
                    else:
                        headers[param_name] = str(param_example) if param_example else ""

            body = ""
            request_body = operation.get("requestBody", {})
            if request_body:
                content = request_body.get("content", {})
                if "application/json" in content:
                    schema = content["application/json"].get("schema", {})
                    example_data = _generate_example_from_schema(schema, openapi_data)
                    if example_data:
                        body = json.dumps(example_data, indent=2)
                    headers["Content-Type"] = "application/json"

            headers_str = "\n".join(f"{k}={v}" for k, v in headers.items())
            query_params_str = "\n".join(f"{k}={v}" for k, v in query_params.items())

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
                "fingerprint": _build_openapi_endpoint_fingerprint(
                    method.upper(), normalized_path, operation_id, definition_scope
                ),
            }
            for key in ("definitionName", "definitionSpecUrl", "definitionScope", "sourceUiUrl"):
                value = context.get(key)
                if value:
                    openapi_meta[key] = value

            row = idx // nodes_per_row
            col = idx % nodes_per_row
            x_position = start_x + col * x_spacing
            y_position = start_y + row * y_spacing

            nodes.append(
                {
                    "nodeId": node_id,
                    "type": "http-request",
                    "label": label,
                    "position": {"x": x_position, "y": y_position},
                    "config": {
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
                    },
                }
            )
            idx += 1

    total_rows = (idx + nodes_per_row - 1) // nodes_per_row
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

    edges.append(
        {
            "edgeId": str(uuid.uuid4()),
            "source": start_node_id,
            "target": end_node_id,
            "label": None,
        }
    )

    api_title = openapi_data.get("info", {}).get("title", "API")
    now_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M")
    return {
        "name": f"Imported from OpenAPI - {api_title} - {now_str}",
        "description": f"Imported {idx} endpoints from OpenAPI specification",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["openapi-import"],
    }


def _normalize_openapi_path(path: str) -> str:
    """Normalize OpenAPI path for stable endpoint matching."""
    if not path:
        return "/"
    normalized = path.strip()
    if not normalized.startswith("/"):
        normalized = f"/{normalized}"
    normalized = re.sub(r"//+", "/", normalized)
    return normalized


def _build_openapi_endpoint_fingerprint(
    method: str, path: str, operation_id: str = "", scope: str = ""
) -> str:
    """Build deterministic endpoint fingerprint for OpenAPI request nodes."""
    method_upper = (method or "GET").upper()
    normalized_path = _normalize_openapi_path(path)
    operation_value = (operation_id or "").strip()
    scope_value = (scope or "").strip()
    return f"{scope_value}|{method_upper}|{normalized_path}|{operation_value}"


def _generate_example_from_schema(schema: dict[str, Any], openapi_data: dict[str, Any]) -> Any:
    """Generate example data from OpenAPI schema with $ref resolution."""
    from app.utils.openapi_examples import generate_example_from_schema as _gen

    return _gen(schema, openapi_data)
