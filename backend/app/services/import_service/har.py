"""
HAR import — parse HAR files into APIWeave workflow format.
"""

import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.services.secret_utils import detect_secrets_in_value


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
            "headers": {h.get("name", ""): h.get("value", "") for h in response.get("headers", [])},
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
