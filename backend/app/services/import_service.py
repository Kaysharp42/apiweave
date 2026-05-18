"""
Import service — shared business logic for OpenAPI, HAR, and curl parsing/import.
Called by both FastAPI routes and MCP tools.
"""
import json
import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.services.secret_utils import detect_secrets_in_value


def parse_curl_to_workflow(
    curl_commands: str, sanitize: bool = True
) -> dict[str, Any]:
    """Convert curl command(s) to APIWeave workflow format."""
    import shlex

    def normalize_curl_command(cmd_text: str) -> str:
        normalized = re.sub(r"\\\s*\n\s*", " ", cmd_text)
        return normalized.strip()

    commands: list[str] = []
    current_cmd: list[str] = []

    for line in curl_commands.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("curl"):
            if current_cmd:
                full_cmd = "\n".join(current_cmd)
                normalized = normalize_curl_command(full_cmd)
                if normalized:
                    commands.append(normalized)
            current_cmd = [line]
        else:
            current_cmd.append(line)

    if current_cmd:
        full_cmd = "\n".join(current_cmd)
        normalized = normalize_curl_command(full_cmd)
        if normalized:
            commands.append(normalized)

    if not commands:
        raise ValueError("No valid curl commands found")

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

    for idx, curl_cmd in enumerate(commands):
        node_id = str(uuid.uuid4())
        try:
            if curl_cmd.startswith("curl "):
                curl_cmd = curl_cmd[5:].strip()

            method = "GET"
            url: str | None = None
            headers: dict[str, str] = {}
            cookies: dict[str, str] = {}
            body: str | None = None

            try:
                tokens = shlex.split(curl_cmd)
            except ValueError:
                tokens = []
                in_quotes = False
                current_token: list[str] = []
                for char in curl_cmd:
                    if char in ("'", '"'):
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
                if not token:
                    i += 1
                    continue
                if token in ("-X", "--request"):
                    if i + 1 < len(tokens):
                        method = tokens[i + 1].upper()
                        i += 2
                        continue
                elif token in ("-u", "--url"):
                    if i + 1 < len(tokens):
                        url = tokens[i + 1]
                        i += 2
                        continue
                elif token in ("-H", "--header"):
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
                elif token in ("-b", "--cookie"):
                    if i + 1 < len(tokens):
                        cookie_str = tokens[i + 1]
                        for cookie in cookie_str.split(";"):
                            cookie = cookie.strip()
                            if "=" in cookie:
                                k, v = cookie.split("=", 1)
                                cookies[k.strip()] = v.strip()
                        i += 2
                        continue
                elif token in ("-d", "--data", "--data-raw"):
                    if i + 1 < len(tokens):
                        body = tokens[i + 1]
                        if method == "GET":
                            method = "POST"
                        i += 2
                        continue
                elif not token.startswith("-") and url is None:
                    url = token
                    i += 1
                    continue
                i += 1

            if not url:
                continue

            parsed = urlparse(url)
            host = parsed.netloc
            path = parsed.path or "/"
            query = parsed.query

            query_params: dict[str, str] = {}
            if query:
                parsed_qs_result = parse_qs(query, keep_blank_values=True)
                for k, v_list in parsed_qs_result.items():
                    query_params[k] = v_list[0] if v_list else ""

            path_display = path if len(path) <= 40 else path[:37] + "..."
            label = f"[{method}] {host}{path_display}"

            headers_str = "\n".join(f"{k}={v}" for k, v in headers.items())
            query_params_str = "\n".join(f"{k}={v}" for k, v in query_params.items())
            cookies_str = "\n".join(f"{k}={v}" for k, v in cookies.items())

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
                        "method": method,
                        "url": url,
                        "headers": headers_str,
                        "queryParams": query_params_str,
                        "cookies": cookies_str,
                        "body": body,
                        "timeout": 30,
                        "followRedirects": True,
                        "extractors": {},
                    },
                }
            )
        except Exception:
            continue

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

    edges.append(
        {
            "edgeId": str(uuid.uuid4()),
            "source": start_node_id,
            "target": end_node_id,
            "label": None,
        }
    )

    return {
        "name": f"Imported from curl - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {len(nodes) - 2} HTTP requests from curl commands",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["curl-import"],
    }


def parse_har_to_workflow(
    har_data: dict[str, Any],
    import_mode: str = "linear",
    sanitize: bool = True,
) -> dict[str, Any]:
    """Convert HAR file to APIWeave workflow format."""
    entries = har_data.get("log", {}).get("entries", [])
    if not entries:
        raise ValueError("HAR file contains no entries")

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

    for idx, entry in enumerate(entries):
        request = entry.get("request", {})
        response = entry.get("response", {})
        node_id = str(uuid.uuid4())

        method = request.get("method", "GET")
        url = request.get("url", "")

        parsed = urlparse(url)
        host = parsed.netloc
        path = parsed.path or "/"
        query = parsed.query

        query_params: dict[str, str] = {}
        har_query_string = request.get("queryString", [])
        if har_query_string:
            for qp in har_query_string:
                k = qp.get("name", "")
                v = qp.get("value", "")
                query_params[k] = v
        elif query:
            parsed_qs = parse_qs(query, keep_blank_values=True)
            for k, v_list in parsed_qs.items():
                query_params[k] = v_list[0] if v_list else ""

        path_display = path if len(path) <= 40 else path[:37] + "..."
        label = f"[{method}] {host}{path_display}"

        headers: dict[str, str] = {}
        for header in request.get("headers", []):
            header_name = header.get("name", "")
            header_value = header.get("value", "")
            if sanitize and detect_secrets_in_value(f"{header_name}:{header_value}"):
                headers[header_name] = "[FILTERED]"
            else:
                headers[header_name] = header_value

        cookies: dict[str, str] = {}
        for ck in request.get("cookies", []):
            k = ck.get("name", "")
            v = ck.get("value", "")
            cookies[k] = v

        post_data = request.get("postData", {})
        body = post_data.get("text", "") if post_data else None

        example_response = {
            "statusCode": response.get("status", 0),
            "statusText": response.get("statusText", ""),
            "headers": {
                h.get("name", ""): h.get("value", "")
                for h in response.get("headers", [])
            },
            "bodySize": response.get("bodySize", 0),
            "isExample": True,
        }

        headers_str = "\n".join(f"{k}={v}" for k, v in headers.items())
        query_params_str = "\n".join(f"{k}={v}" for k, v in query_params.items())
        cookies_str = "\n".join(f"{k}={v}" for k, v in cookies.items())

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
                },
            }
        )

    total_rows = (len(entries) + nodes_per_row - 1) // nodes_per_row
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

    return {
        "name": f"Imported from HAR - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {len(entries)} HTTP requests from HAR file",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["har-import"],
    }


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


def _generate_example_from_schema(
    schema: dict[str, Any], openapi_data: dict[str, Any]
) -> Any:
    """Generate example data from OpenAPI schema with $ref resolution."""
    from app.utils.openapi_examples import generate_example_from_schema as _gen

    return _gen(schema, openapi_data)
