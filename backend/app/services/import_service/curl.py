"""
cURL import — parse curl commands into APIWeave workflow format.
"""

import re
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qs, urlparse

from app.services.secret_utils import detect_secrets_in_value


def parse_curl_to_workflow(curl_commands: str, sanitize: bool = True) -> dict[str, Any]:
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
