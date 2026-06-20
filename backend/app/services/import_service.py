"""
Import service — shared business logic for OpenAPI, HAR, and curl parsing/import.
Called by both FastAPI routes and MCP tools.
"""
import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.services.safe_http import SafeUrlError, validate_url
from app.services.secret_utils import detect_secrets_in_value

logger = logging.getLogger(__name__)


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
                                k = k.strip()
                                v = v.strip()
                                if sanitize and (
                                    detect_secrets_in_value(f"{k}={v}")
                                    or detect_secrets_in_value(v)
                                ):
                                    cookies[k] = "[FILTERED]"
                                else:
                                    cookies[k] = v
                        i += 2
                        continue
                elif token in ("-d", "--data", "--data-raw"):
                    if i + 1 < len(tokens):
                        body = tokens[i + 1]
                        if sanitize and detect_secrets_in_value(body):
                            body = "[FILTERED]"
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
            if sanitize and (detect_secrets_in_value(f"{k}={v}") or detect_secrets_in_value(v)):
                cookies[k] = "[FILTERED]"
            else:
                cookies[k] = v

        post_data = request.get("postData", {})
        body = post_data.get("text", "") if post_data else None
        if sanitize and body and detect_secrets_in_value(body):
            body = "[FILTERED]"

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


async def fetch_openapi_from_url(
    url: str,
    base_url: str = "",
    tag_filter: list[str] | None = None,
    sanitize: bool = True,
) -> dict[str, Any]:
    """Fetch and parse OpenAPI spec from a URL (direct spec or Swagger UI).

    Returns a dict with keys: nodes, definitions, total_endpoints,
    api_title, source_url, warnings.
    """
    import asyncio

    import httpx

    from app.utils.openapi_import_limits import (
        DEFAULT_FETCH_CONCURRENCY,
        DEFAULT_FETCH_TIMEOUT_SECONDS,
        MAX_DISCOVERED_OPENAPI_DEFINITIONS,
        MAX_IMPORTED_OPENAPI_ENDPOINTS,
    )
    from app.utils.swagger_discovery import (
        build_swagger_config_candidates,
        extract_definitions_from_swagger_config,
        extract_swagger_ui_hints_from_html,
        make_definition_scope,
        parse_swagger_ui_query_hints,
        replace_url_host,
        resolve_url,
        select_primary_definition,
    )

    url = url.strip()
    if not url:
        raise ValueError("URL is required")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise ValueError("URL must start with http:// or https://")

    # SSRF safety: validate URL before any outbound request
    try:
        validate_url(url)
    except SafeUrlError as exc:
        logger.warning("Blocked unsafe URL in fetch_openapi_from_url: %s (%s)", url, exc)
        raise ValueError(f"URL blocked by safety policy: {url} ({exc})") from exc

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
            import yaml  # type: ignore[import-not-found,import-untyped]
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
        seen: set[str] = set()
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

    def _fetch_url_candidates(target_url: str) -> list[str]:
        candidates = [target_url]
        parsed = httpx.URL(target_url)
        if parsed.host == "localhost":
            candidate = replace_url_host(target_url, "host.docker.internal")
            if candidate not in candidates:
                candidates.append(candidate)
        return candidates

    async def _get_with_localhost_fallback(
        client: httpx.AsyncClient,
        target_url: str,
        headers: dict[str, str],
    ) -> httpx.Response:
        last_error: Exception | None = None
        for candidate in _fetch_url_candidates(target_url):
            try:
                validate_url(candidate)
                return await client.get(candidate, headers=headers)
            except httpx.RequestError as exc:
                last_error = exc
                continue
        if last_error:
            raise last_error
        return await client.get(target_url, headers=headers)

    async def _discover_from_swagger_ui(
        client: httpx.AsyncClient,
        swagger_ui_url: str,
        html_text: str,
    ) -> dict[str, Any]:
        query_hints = parse_swagger_ui_query_hints(swagger_ui_url)
        html_hints = extract_swagger_ui_hints_from_html(html_text)

        definitions: list[dict[str, str]] = []

        if query_hints.get("url"):
            definitions.append(
                {
                    "name": query_hints.get("primaryName") or "Default",
                    "specUrl": resolve_url(
                        swagger_ui_url, query_hints["url"] or ""
                    ),
                    "source": "swagger-ui.query.url",
                }
            )

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
        config_candidates = build_swagger_config_candidates(
            swagger_ui_url, query_hints, html_hints
        )

        for candidate in config_candidates:
            try:
                validate_url(candidate)
            except SafeUrlError as exc:
                logger.warning(
                    "Blocked unsafe swagger config candidate URL: %s (%s)",
                    candidate,
                    exc,
                )
                continue
            try:
                response = await _get_with_localhost_fallback(
                    client,
                    candidate,
                    headers={
                        "Accept": "application/json, application/vnd.oai.openapi+json",
                    },
                )
                response.raise_for_status()
                config_data = response.json()
                if not isinstance(config_data, dict):
                    continue
                extracted = extract_definitions_from_swagger_config(
                    config_data, str(response.url)
                )
                if extracted.get("primaryName") and not primary_name:
                    primary_name = extracted["primaryName"]
                definitions.extend(extracted.get("definitions") or [])
                if extracted.get("definitions"):
                    break
            except Exception:
                continue

        deduped = select_primary_definition(_dedupe_definitions(definitions), primary_name)
        return {"definitions": deduped, "primaryName": primary_name}

    async with httpx.AsyncClient(
        timeout=DEFAULT_FETCH_TIMEOUT_SECONDS, follow_redirects=True
    ) as client:
        initial_response = await _get_with_localhost_fallback(
            client,
            url,
            headers={
                "Accept": "application/json, application/vnd.oai.openapi+json, text/html",
            },
        )
        initial_response.raise_for_status()

        direct_spec = _extract_openapi_document(initial_response)

        discovered_definitions: list[dict[str, str]] = []

        if direct_spec:
            discovered_definitions = [
                {
                    "name": direct_spec.get("info", {}).get("title") or "Default",
                    "specUrl": url,
                    "source": "direct-url",
                }
            ]
        else:
            discovery = await _discover_from_swagger_ui(
                client,
                swagger_ui_url=url,
                html_text=initial_response.text,
            )
            discovered_definitions = discovery.get("definitions") or []

            if not discovered_definitions:
                raise ValueError(
                    "Could not discover OpenAPI definitions from Swagger UI URL. "
                    "Use a direct OpenAPI spec URL or verify Swagger UI config exposure."
                )

        if len(discovered_definitions) > MAX_DISCOVERED_OPENAPI_DEFINITIONS:
            raise ValueError(
                f"Discovered {len(discovered_definitions)} definitions, "
                f"which exceeds safety limit ({MAX_DISCOVERED_OPENAPI_DEFINITIONS})."
            )

        successful_specs: list[dict[str, Any]] = []
        failed_definitions: list[dict[str, str]] = []

        async def _fetch_definition(definition: dict[str, str]) -> dict[str, Any]:
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
                validate_url(spec_url)
            except SafeUrlError as exc:
                logger.warning("Blocked unsafe definition spec URL: %s (%s)", spec_url, exc)
                return {
                    "status": "failed",
                    "name": definition_name,
                    "specUrl": spec_url,
                    "error": f"URL blocked by safety policy: {exc}",
                }

            try:
                spec_response = await _get_with_localhost_fallback(
                    client,
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

        async def _fetch_with_limit(definition: dict[str, str]) -> dict[str, Any]:
            async with semaphore:
                return await _fetch_definition(definition)

        fetch_results = await asyncio.gather(
            *(_fetch_with_limit(d) for d in discovered_definitions)
        )

        for result in fetch_results:
            if result.get("status") == "imported":
                successful_specs.append(result)
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
            failed_definitions[0]["error"]
            if failed_definitions
            else "Unknown fetch error"
        )
        raise ValueError(f"Failed to fetch any OpenAPI definitions: {first_error}")

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
            tag_filter,
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

        if len(all_http_nodes) > MAX_IMPORTED_OPENAPI_ENDPOINTS:
            raise ValueError(
                f"Imported endpoint count exceeded safety limit ({MAX_IMPORTED_OPENAPI_ENDPOINTS})."
            )

        definition_summaries.append(
            {
                "name": definition_name,
                "spec_url": definition_spec_url,
                "status": "imported",
                "endpoint_count": len(http_nodes),
                "source": definition.get("source") or "discovered",
            }
        )

    for failed in failed_definitions:
        definition_summaries.append(
            {
                "name": failed["name"],
                "spec_url": failed["specUrl"],
                "status": "failed",
                "endpoint_count": 0,
                "source": "discovered",
                "error": failed["error"],
            }
        )

    api_title = "Multiple APIs" if total_imported > 1 else (
        successful_specs[0]["openapi_data"].get("info", {}).get("title", "API")
    )

    warnings = [
        {
            "type": "definition-fetch-failed",
            "name": item["name"],
            "specUrl": item["specUrl"],
            "message": item["error"],
        }
        for item in failed_definitions
    ]

    return {
        "nodes": all_http_nodes,
        "definitions": definition_summaries,
        "total_endpoints": len(all_http_nodes),
        "api_title": api_title,
        "source_url": url,
        "warnings": warnings,
    }
