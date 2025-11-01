"""
Workflow API routes
CRUD operations for workflows
"""
from fastapi import APIRouter, HTTPException, status, Query, UploadFile, File
from fastapi.responses import JSONResponse
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import uuid
import json
import re
from bson import ObjectId

from app.models import Workflow, WorkflowCreate, WorkflowUpdate, PaginatedWorkflows
from app.database import get_database
from app.config import settings
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


# Helper functions for export/import

def detect_secrets_in_value(value: str) -> bool:
    """Detect if a value might be a secret based on patterns"""
    if not isinstance(value, str):
        return False
    
    secret_patterns = [
        r'bearer\s+[a-zA-Z0-9_\-\.]+',  # Bearer tokens
        r'api[_-]?key',  # API keys
        r'secret',  # Secret keywords
        r'token',  # Token keywords
        r'password',  # Password keywords
        r'sk_live_',  # Stripe live keys
        r'pk_live_',  # Stripe public keys
    ]
    
    for pattern in secret_patterns:
        if re.search(pattern, value, re.IGNORECASE):
            return True
    
    return False


def sanitize_secrets_in_dict(data: Dict[str, Any], secret_refs: List[str], path: str = "") -> Dict[str, Any]:
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


def parse_curl_to_workflow(curl_commands: str, sanitize: bool = True) -> Dict[str, Any]:
    """
    Convert curl command(s) to APIWeave workflow format
    
    Args:
        curl_commands: Single curl command or multiple commands (one per line, or separated by &&)
        sanitize: Whether to filter sensitive headers
        
    Returns:
        Workflow dict ready for import
    """
    from urllib.parse import urlparse, parse_qs
    import shlex
    
    def normalize_curl_command(cmd_text: str) -> str:
        """
        Normalize curl command by handling line continuations (backslashes)
        and ensuring it's a single line
        """
        # Remove line continuations (backslash at end of line)
        normalized = re.sub(r'\\\s*\n\s*', ' ', cmd_text)
        return normalized.strip()
    
    # First, split multiple commands intelligently
    # Look for lines that START with 'curl' to identify command boundaries
    commands = []
    current_cmd = []
    
    for line in curl_commands.split('\n'):
        stripped = line.strip()
        
        # If line is empty, skip it
        if not stripped:
            continue
        
        # If line starts with 'curl', it's a new command
        if stripped.startswith('curl'):
            if current_cmd:
                # Save previous command
                full_cmd = '\n'.join(current_cmd)
                normalized = normalize_curl_command(full_cmd)
                if normalized:
                    commands.append(normalized)
            current_cmd = [line]
        else:
            # Continuation of current command
            current_cmd.append(line)
    
    # Don't forget the last command
    if current_cmd:
        full_cmd = '\n'.join(current_cmd)
        normalized = normalize_curl_command(full_cmd)
        if normalized:
            commands.append(normalized)
    
    if not commands:
        raise ValueError("No valid curl commands found")
    
    nodes = []
    edges = []
    
    # Create start node
    start_node_id = str(uuid.uuid4())
    nodes.append({
        "nodeId": start_node_id,
        "type": "start",
        "label": "Start",
        "position": {"x": 100, "y": 100},
        "config": {}
    })
    
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
            if curl_cmd.startswith('curl '):
                curl_cmd = curl_cmd[5:].strip()
            
            # Simple curl parser - handles most common cases
            method = 'GET'
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
                    elif char in (' ', '\t') and not in_quotes:
                        if current_token:
                            tokens.append(''.join(current_token))
                            current_token = []
                    else:
                        current_token.append(char)
                if current_token:
                    tokens.append(''.join(current_token))
            
            i = 0
            while i < len(tokens):
                token = tokens[i]
                
                # Skip empty tokens
                if not token:
                    i += 1
                    continue
                
                # Method flags
                if token == '-X' or token == '--request':
                    if i + 1 < len(tokens):
                        method = tokens[i + 1].upper()
                        i += 2
                        continue
                
                # URL (first non-flag argument or after -url)
                elif token == '-u' or token == '--url':
                    if i + 1 < len(tokens):
                        url = tokens[i + 1]
                        i += 2
                        continue
                
                # Headers
                elif token == '-H' or token == '--header':
                    if i + 1 < len(tokens):
                        header_str = tokens[i + 1]
                        if ':' in header_str:
                            key, val = header_str.split(':', 1)
                            key = key.strip()
                            val = val.strip()
                            if sanitize and detect_secrets_in_value(f"{key}:{val}"):
                                headers[key] = "[FILTERED]"
                            else:
                                headers[key] = val
                        i += 2
                        continue
                
                # Cookies
                elif token == '-b' or token == '--cookie':
                    if i + 1 < len(tokens):
                        cookie_str = tokens[i + 1]
                        for cookie in cookie_str.split(';'):
                            cookie = cookie.strip()
                            if '=' in cookie:
                                k, v = cookie.split('=', 1)
                                cookies[k.strip()] = v.strip()
                        i += 2
                        continue
                
                # Data/Body
                elif token == '-d' or token == '--data' or token == '--data-raw':
                    if i + 1 < len(tokens):
                        body = tokens[i + 1]
                        if method == 'GET':
                            method = 'POST'  # -d implies POST
                        i += 2
                        continue
                
                # If token doesn't start with -, it might be the URL
                elif not token.startswith('-') and url is None:
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
            query_params_str = "\n".join([f"{k}={v}" for k, v in query_params.items()]) if query_params else ""
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
                "config": node_config
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
    nodes.append({
        "nodeId": end_node_id,
        "type": "end",
        "label": "End",
        "position": {"x": end_x, "y": end_y},
        "config": {}
    })
    
    # Connect start to end
    edges.append({
        "edgeId": str(uuid.uuid4()),
        "source": start_node_id,
        "target": end_node_id,
        "label": None
    })
    
    workflow = {
        "name": f"Imported from curl - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {len(nodes) - 2} HTTP requests from curl commands",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["curl-import"]
    }
    
    return workflow


def parse_har_to_workflow(har_data: Dict[str, Any], import_mode: str = "linear", sanitize: bool = True) -> Dict[str, Any]:
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
    nodes.append({
        "nodeId": start_node_id,
        "type": "start",
        "label": "Start",
        "position": {"x": 100, "y": 100},
        "config": {}
    })

    # Smart grid layout: arrange nodes in rows to prevent sprawling too far
    nodes_per_row = 8
    x_spacing = 400  # Horizontal spacing between nodes
    y_spacing = 200  # Vertical spacing between rows
    start_x = 600    # Starting X position (after Start node)
    start_y = 100    # Starting Y position

    for idx, entry in enumerate(entries):
        request = entry.get("request", {})
        response = entry.get("response", {})

        node_id = str(uuid.uuid4())

        # Extract method and URL
        method = request.get("method", "GET")
        url = request.get("url", "")

        # Parse URL for host/path/query
        from urllib.parse import urlparse, parse_qs, urlunparse
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
            "isExample": True
        }

        # Convert objects to string format expected by frontend
        # Format: key=value\nkey2=value2
        headers_str = "\n".join([f"{k}={v}" for k, v in headers.items()]) if headers else ""
        query_params_str = "\n".join([f"{k}={v}" for k, v in query_params.items()]) if query_params else ""
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
            "exampleResponse": example_response
        }

        node = {
            "nodeId": node_id,
            "type": "http-request",
            "label": label,
            "position": {"x": x_position, "y": y_position},
            "config": node_config
        }

        nodes.append(node)
        # No auto-linking between nodes

    # Create end node positioned below the grid
    total_rows = (len(entries) + nodes_per_row - 1) // nodes_per_row  # Ceiling division
    end_x = start_x + (nodes_per_row // 2) * x_spacing  # Center horizontally
    end_y = start_y + total_rows * y_spacing + y_spacing  # Below last row
    
    end_node_id = str(uuid.uuid4())
    nodes.append({
        "nodeId": end_node_id,
        "type": "end",
        "label": "End",
        "position": {"x": end_x, "y": end_y},
        "config": {}
    })

    # Only connect Start to End (no HTTP node edges)
    edges.append({
        "edgeId": str(uuid.uuid4()),
        "source": start_node_id,
        "target": end_node_id,
        "label": None
    })

    workflow = {
        "name": f"Imported from HAR - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {len(entries)} HTTP requests from HAR file",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["har-import"]
    }

    return workflow


def resolve_openapi_schema_ref(ref_path: str, openapi_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Resolve a $ref path in OpenAPI spec (e.g., #/components/schemas/MyDto)
    
    Args:
        ref_path: Reference path starting with #/
        openapi_data: Full OpenAPI spec
        
    Returns:
        Resolved schema object or empty dict
    """
    if not ref_path.startswith("#/"):
        return {}
    
    parts = ref_path[2:].split("/")  # Remove #/ and split
    current = openapi_data
    
    for part in parts:
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return {}
    
    return current if isinstance(current, dict) else {}


def generate_example_from_schema(schema: Dict[str, Any], openapi_data: Dict[str, Any]) -> Any:
    """
    Generate example value from OpenAPI schema
    
    Args:
        schema: OpenAPI schema object
        openapi_data: Full spec for resolving references
        
    Returns:
        Example value based on schema
    """
    # If schema has example, use it
    if "example" in schema:
        return schema["example"]
    
    # If schema is a reference, resolve it
    if "$ref" in schema:
        resolved = resolve_openapi_schema_ref(schema["$ref"], openapi_data)
        return generate_example_from_schema(resolved, openapi_data)
    
    schema_type = schema.get("type", "object")
    
    if schema_type == "object":
        properties = schema.get("properties", {})
        result = {}
        for prop_name, prop_schema in properties.items():
            result[prop_name] = generate_example_from_schema(prop_schema, openapi_data)
        return result
    elif schema_type == "array":
        items_schema = schema.get("items", {})
        example_item = generate_example_from_schema(items_schema, openapi_data)
        return [example_item] if example_item else []
    elif schema_type == "string":
        schema_format = schema.get("format", "")
        if schema_format == "uuid":
            return "00000000-0000-0000-0000-000000000000"
        elif schema_format == "date":
            return "2024-01-01"
        elif schema_format == "date-time":
            return "2024-01-01T00:00:00Z"
        elif schema_format == "email":
            return "user@example.com"
        return schema.get("default", "string")
    elif schema_type == "integer":
        return schema.get("default", 0)
    elif schema_type == "number":
        return schema.get("default", 0.0)
    elif schema_type == "boolean":
        return schema.get("default", False)
    
    return None


def parse_openapi_to_workflow(openapi_data: Dict[str, Any], base_url: str = "", tag_filter: Optional[List[str]] = None, sanitize: bool = True) -> Dict[str, Any]:
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
    nodes.append({
        "nodeId": start_node_id,
        "type": "start",
        "label": "Start",
        "position": {"x": 100, "y": 100},
        "config": {}
    })
    
    # Smart grid layout: arrange nodes in rows to prevent sprawling too far
    # Strategy: Create a grid with ~8 nodes per row for balance
    nodes_per_row = 8
    x_spacing = 400  # Horizontal spacing between nodes
    y_spacing = 200  # Vertical spacing between rows
    start_x = 600    # Starting X position (after Start node)
    start_y = 100    # Starting Y position
    
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
                    path_params[param_name] = str(param_example) if param_example else f"{{{param_name}}}"
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
            query_params_str = "\n".join([f"{k}={v}" for k, v in query_params.items()]) if query_params else ""
            
            # Build label: [METHOD] /path - operationId
            operation_id = operation.get("operationId", "")
            summary = operation.get("summary", "")
            label_text = operation_id or summary or path
            if len(label_text) > 40:
                label_text = label_text[:37] + "..."
            label = f"[{method.upper()}] {label_text}"
            
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
                "extractors": {}
            }
            
            node = {
                "nodeId": node_id,
                "type": "http-request",
                "label": label,
                "position": {"x": x_position, "y": y_position},
                "config": node_config
            }
            
            nodes.append(node)
            idx += 1
    
    # Create end node positioned below the grid
    total_rows = (idx + nodes_per_row - 1) // nodes_per_row  # Ceiling division
    end_x = start_x + (nodes_per_row // 2) * x_spacing  # Center horizontally
    end_y = start_y + total_rows * y_spacing + y_spacing  # Below last row
    
    end_node_id = str(uuid.uuid4())
    nodes.append({
        "nodeId": end_node_id,
        "type": "end",
        "label": "End",
        "position": {"x": end_x, "y": end_y},
        "config": {}
    })
    
    # Only connect Start to End
    edges.append({
        "edgeId": str(uuid.uuid4()),
        "source": start_node_id,
        "target": end_node_id,
        "label": None
    })
    
    api_title = openapi_data.get("info", {}).get("title", "API")
    workflow = {
        "name": f"Imported from OpenAPI - {api_title} - {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}",
        "description": f"Imported {idx} endpoints from OpenAPI specification",
        "nodes": nodes,
        "edges": edges,
        "variables": {},
        "tags": ["openapi-import"]
    }
    
    return workflow


@router.post("", response_model=Workflow, status_code=status.HTTP_201_CREATED)
async def create_workflow(workflow: WorkflowCreate):
    """Create a new workflow"""
    db = get_database()
    
    workflow_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    workflow_doc = {
        "workflowId": workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "nodes": [node.model_dump() for node in workflow.nodes],
        "edges": [edge.model_dump() for edge in workflow.edges],
        "variables": workflow.variables,
        "tags": workflow.tags,
        "nodeTemplates": workflow.nodeTemplates,
        "collectionId": workflow.collectionId,  # Include collectionId if provided
        "createdAt": now,
        "updatedAt": now,
        "version": 1
    }
    
    await db.workflows.insert_one(workflow_doc)
    
    return Workflow(**workflow_doc)


@router.get("", response_model=PaginatedWorkflows)
async def list_workflows(skip: int = 0, limit: int = 20, tag: Optional[str] = None):
    """List workflows with pagination"""
    db = get_database()
    
    query = {}
    if tag:
        query["tags"] = tag
    
    # Get total count
    total = await db.workflows.count_documents(query)
    
    # Get workflows for current page
    cursor = db.workflows.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    workflows = await cursor.to_list(length=limit)
    
    # Calculate if there are more results
    has_more = (skip + len(workflows)) < total
    
    return PaginatedWorkflows(
        workflows=[Workflow(**workflow) for workflow in workflows],
        total=total,
        skip=skip,
        limit=limit,
        hasMore=has_more
    )


@router.get("/unattached", response_model=PaginatedWorkflows)
async def list_unattached_workflows(skip: int = 0, limit: int = 20):
    """Get all workflows not attached to any collection with pagination."""
    db = get_database()
    
    query = {"collectionId": None}
    
    # Get total count
    total = await db.workflows.count_documents(query)
    
    # Get workflows for current page
    cursor = db.workflows.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    workflows = await cursor.to_list(length=limit)
    
    # Calculate if there are more results
    has_more = (skip + len(workflows)) < total
    
    return PaginatedWorkflows(
        workflows=[Workflow(**workflow) for workflow in workflows],
        total=total,
        skip=skip,
        limit=limit,
        hasMore=has_more
    )


@router.get("/{workflow_id}", response_model=Workflow)
async def get_workflow(workflow_id: str):
    """Get a workflow by ID"""
    db = get_database()
    
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return Workflow(**workflow)


@router.put("/{workflow_id}", response_model=Workflow)
async def update_workflow(workflow_id: str, update: WorkflowUpdate):
    """Update a workflow"""
    db = get_database()
    
    # Check if workflow exists
    existing = await db.workflows.find_one({"workflowId": workflow_id})
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Build update document
    update_doc = {"updatedAt": datetime.now(UTC)}
    if update.name is not None:
        update_doc["name"] = update.name
    if update.description is not None:
        update_doc["description"] = update.description
    if update.nodes is not None:
        update_doc["nodes"] = [node.model_dump() for node in update.nodes]
    if update.edges is not None:
        update_doc["edges"] = [edge.model_dump() for edge in update.edges]
    if update.variables is not None:
        update_doc["variables"] = update.variables
    if update.tags is not None:
        update_doc["tags"] = update.tags
    if update.nodeTemplates is not None:
        update_doc["nodeTemplates"] = update.nodeTemplates
    
    # Increment version
    update_doc["version"] = existing.get("version", 1) + 1
    
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": update_doc}
    )
    
    # Fetch and return updated workflow
    updated = await db.workflows.find_one({"workflowId": workflow_id})
    return Workflow(**updated)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: str):
    """Delete a workflow"""
    db = get_database()
    
    result = await db.workflows.delete_one({"workflowId": workflow_id})
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return None


@router.post("/{workflow_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_workflow(workflow_id: str, environmentId: Optional[str] = Query(None)):
    """Trigger a workflow run with optional environment"""
    from app.runner.executor import WorkflowExecutor
    import asyncio
    
    db = get_database()
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Verify environment exists if provided
    if environmentId:
        environment = await db.environments.find_one({"environmentId": environmentId})
        if not environment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environmentId} not found"
            )
    
    run_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    run_doc = {
        "runId": run_id,
        "workflowId": workflow_id,
        "environmentId": environmentId,  # Store which environment to use for this run
        "status": "pending",
        "trigger": "manual",
        "variables": workflow.get("variables", {}),
        "callbackUrl": None,
        "results": [],
        "createdAt": now,
        "startedAt": None,
        "completedAt": None,
        "duration": None,
        "error": None
    }
    
    await db.runs.insert_one(run_doc)
    
    # Trigger workflow execution as a background task
    # This allows immediate response while execution happens in background
    async def execute_workflow():
        try:
            executor = WorkflowExecutor(run_id, workflow_id)
            await executor.execute()
        except Exception as e:
            # Error is already logged in executor
            pass
    
    # Schedule the execution as a background task (non-blocking)
    asyncio.create_task(execute_workflow())
    
    return {
        "message": "Workflow run triggered",
        "runId": run_id,
        "workflowId": workflow_id,
        "environmentId": environmentId,
        "status": "pending"
    }


@router.get("/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str, page: int = 1, limit: int = 10):
    """Get runs for a workflow with pagination (lightweight list view)"""
    db = get_database()
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Calculate skip value for pagination
    skip = (page - 1) * limit
    
    # Get total count
    total_count = await db.runs.count_documents({"workflowId": workflow_id})
    
    # Get runs sorted by most recent first (createdAt descending)
    # Only fetch essential fields for list view - exclude heavy nodeStatuses
    projection = {
        "_id": 0,
        "runId": 1,
        "workflowId": 1,
        "status": 1,
        "trigger": 1,
        "createdAt": 1,
        "startedAt": 1,
        "completedAt": 1,
        "duration": 1,
        "error": 1
    }
    
    cursor = db.runs.find(
        {"workflowId": workflow_id},
        projection
    ).sort("createdAt", -1).skip(skip).limit(limit)
    
    runs = await cursor.to_list(length=limit)
    
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
            "hasPrevious": page > 1
        }
    }


@router.get("/{workflow_id}/runs/{run_id}")
async def get_run_status(workflow_id: str, run_id: str):
    """Get the status of a workflow run with full node results"""
    db = get_database()
    
    run = await db.runs.find_one({"runId": run_id, "workflowId": workflow_id})
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    # Remove MongoDB _id from response
    run.pop('_id', None)
    
    # Fetch full node results from separate collection
    if run.get('nodeStatuses'):
        gridfs_bucket = AsyncIOMotorGridFSBucket(db)
        
        for node_id in run['nodeStatuses'].keys():
            full_result = await db.node_results.find_one(
                {"runId": run_id, "nodeId": node_id},
                {"_id": 0}
            )
            if full_result:
                result = full_result.get('result', {})
                
                # Check if result is stored in GridFS
                if isinstance(result, dict) and result.get('stored_in_gridfs'):
                    gridfs_file_id = result.get('gridfs_file_id')
                    if gridfs_file_id:
                        try:
                            # Download the file from GridFS
                            grid_out = await gridfs_bucket.open_download_stream(ObjectId(gridfs_file_id))
                            file_data = await grid_out.read()
                            
                            # Parse JSON and replace with actual result
                            actual_result = json.loads(file_data.decode('utf-8'))
                            
                            # Replace summary with full result (including GridFS metadata)
                            run['nodeStatuses'][node_id] = {
                                "status": full_result.get('status'),
                                "result": actual_result,  # Full result from GridFS
                                "timestamp": full_result.get('timestamp'),
                                "metadata": {
                                    "stored_in_gridfs": True,
                                    "size_mb": result.get('size_mb')
                                }
                            }
                        except Exception as e:
                            # If GridFS fetch fails, keep the reference
                            run['nodeStatuses'][node_id] = {
                                "status": full_result.get('status'),
                                "result": {"error": f"Failed to retrieve large result: {str(e)}"},
                                "timestamp": full_result.get('timestamp')
                            }
                    else:
                        # Missing file ID
                        run['nodeStatuses'][node_id] = {
                            "status": full_result.get('status'),
                            "result": result,
                            "timestamp": full_result.get('timestamp')
                        }
                else:
                    # Regular result (not in GridFS)
                    run['nodeStatuses'][node_id] = {
                        "status": full_result.get('status'),
                        "result": result,
                        "timestamp": full_result.get('timestamp')
                    }
    
    return run


@router.get("/{workflow_id}/runs/{run_id}/nodes/{node_id}/result")
async def get_node_result(workflow_id: str, run_id: str, node_id: str):
    """
    Get the full result for a specific node in a run.
    Handles both regular results and GridFS-stored large results.
    """
    db = get_database()
    
    # Verify run exists
    run = await db.runs.find_one({"runId": run_id, "workflowId": workflow_id})
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    # Fetch node result
    node_result = await db.node_results.find_one(
        {"runId": run_id, "nodeId": node_id},
        {"_id": 0}
    )
    
    if not node_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Result for node {node_id} not found"
        )
    
    # Check if result is stored in GridFS
    result = node_result.get('result', {})
    if result.get('stored_in_gridfs'):
        gridfs_file_id = result.get('gridfs_file_id')
        if not gridfs_file_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="GridFS file ID missing"
            )
        
        try:
            # Initialize GridFS bucket
            gridfs_bucket = AsyncIOMotorGridFSBucket(db)
            
            # Download the file from GridFS
            grid_out = await gridfs_bucket.open_download_stream(ObjectId(gridfs_file_id))
            file_data = await grid_out.read()
            
            # Parse JSON and return
            full_result = json.loads(file_data.decode('utf-8'))
            
            return {
                "nodeId": node_id,
                "runId": run_id,
                "status": node_result.get('status'),
                "timestamp": node_result.get('timestamp'),
                "result": full_result,
                "metadata": {
                    "stored_in_gridfs": True,
                    "size_mb": result.get('size_mb'),
                    "gridfs_file_id": gridfs_file_id
                }
            }
            
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to retrieve result from GridFS: {str(e)}"
            )
    
    # Regular result (not in GridFS)
    return {
        "nodeId": node_id,
        "runId": run_id,
        "status": node_result.get('status'),
        "timestamp": node_result.get('timestamp'),
        "result": result,
        "metadata": {
            "stored_in_gridfs": False
        }
    }


@router.get("/{workflow_id}/export")
async def export_workflow(workflow_id: str, include_environment: bool = Query(True)):
    """
    Export a complete workflow bundle as JSON
    Includes workflow, referenced environment (without secrets), and metadata
    Secrets are replaced with <SECRET> placeholders
    """
    db = get_database()
    
    try:
        # Fetch workflow
        workflow = await db.workflows.find_one({"workflowId": workflow_id})
        if not workflow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workflow {workflow_id} not found"
            )
        
        # Remove MongoDB _id
        workflow.pop('_id', None)
        
        # Convert datetime objects to ISO strings
        if workflow.get("createdAt"):
            workflow["createdAt"] = workflow["createdAt"].isoformat()
        if workflow.get("updatedAt"):
            workflow["updatedAt"] = workflow["updatedAt"].isoformat()
        
        # Track secret references
        secret_refs = []
        
        # Sanitize secrets in workflow variables
        if workflow.get("variables"):
            workflow["variables"] = sanitize_secrets_in_dict(workflow["variables"], secret_refs, "variables")
        
        # Sanitize secrets in node configs
        for node in workflow.get("nodes", []):
            if node.get("config"):
                node["config"] = sanitize_secrets_in_dict(node["config"], secret_refs, f"nodes.{node['nodeId']}.config")
        
        # Build export bundle
        export_bundle = {
            "workflow": workflow,
            "environments": [],
            "secretReferences": secret_refs,
            "metadata": {
                "exportedAt": datetime.now(UTC).isoformat(),
                "apiweaveVersion": settings.VERSION,
                "sourceHost": None
            }
        }
        
        # Include environment if requested and workflow has one
        if include_environment and workflow.get("environmentId"):
            env_id = workflow["environmentId"]
            environment = await db.environments.find_one({"environmentId": env_id})
            
            if environment:
                environment.pop('_id', None)
                
                # Convert datetime objects to ISO strings
                if environment.get("createdAt"):
                    environment["createdAt"] = environment["createdAt"].isoformat()
                if environment.get("updatedAt"):
                    environment["updatedAt"] = environment["updatedAt"].isoformat()
                
                # Sanitize secrets in environment variables
                if environment.get("variables"):
                    environment["variables"] = sanitize_secrets_in_dict(
                        environment["variables"], 
                        secret_refs, 
                        f"environments.{env_id}.variables"
                    )
                export_bundle["environments"].append(environment)
        
        return JSONResponse(content=export_bundle)
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Export error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {str(e)}"
        )


@router.post("/import")
async def import_workflow(
    bundle: Dict[str, Any],
    environment_mapping: Optional[Dict[str, str]] = None,
    create_missing_environments: bool = True,
    sanitize: bool = False
):
    """
    Import a workflow bundle
    Validates structure, handles environment mapping, optionally creates missing environments
    """
    db = get_database()
    
    # Validate bundle structure
    if "workflow" not in bundle:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid bundle: missing 'workflow' key"
        )
    
    workflow_data = bundle["workflow"]
    environments = bundle.get("environments", [])
    
    # Validate required workflow fields
    required_fields = ["name", "nodes", "edges"]
    for field in required_fields:
        if field not in workflow_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid workflow: missing '{field}' field"
            )
    
    # Handle environment mapping
    old_env_id = workflow_data.get("environmentId")
    new_env_id = None
    
    if old_env_id:
        # Check if there's a mapping provided
        if environment_mapping and old_env_id in environment_mapping:
            new_env_id = environment_mapping[old_env_id]
            
            # Verify mapped environment exists
            existing_env = await db.environments.find_one({"environmentId": new_env_id})
            if not existing_env:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Mapped environment {new_env_id} not found"
                )
        elif create_missing_environments and environments:
            # Try to find the environment in the bundle and create it
            env_data = next((e for e in environments if e.get("environmentId") == old_env_id), None)
            if env_data:
                # Create new environment with new ID
                new_env_id = str(uuid.uuid4())
                now = datetime.now(UTC)
                
                env_doc = {
                    "environmentId": new_env_id,
                    "name": env_data.get("name", "Imported Environment"),
                    "description": env_data.get("description"),
                    "variables": env_data.get("variables", {}),
                    "isActive": False,
                    "createdAt": now,
                    "updatedAt": now
                }
                
                await db.environments.insert_one(env_doc)
        else:
            # No mapping and can't create - set to null
            new_env_id = None
    
    # Create new workflow with new IDs
    new_workflow_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    # Optionally sanitize again (belt and suspenders)
    if sanitize:
        if workflow_data.get("variables"):
            secret_refs = []
            workflow_data["variables"] = sanitize_secrets_in_dict(workflow_data["variables"], secret_refs)
        
        for node in workflow_data.get("nodes", []):
            if node.get("config"):
                secret_refs = []
                node["config"] = sanitize_secrets_in_dict(node["config"], secret_refs)
    
    workflow_doc = {
        "workflowId": new_workflow_id,
        "name": workflow_data["name"],
        "description": workflow_data.get("description"),
        "nodes": workflow_data["nodes"],
        "edges": workflow_data["edges"],
        "variables": workflow_data.get("variables", {}),
        "tags": workflow_data.get("tags", []),
        "environmentId": new_env_id,
        "createdAt": now,
        "updatedAt": now,
        "version": 1
    }
    
    await db.workflows.insert_one(workflow_doc)
    
    return {
        "message": "Workflow imported successfully",
        "workflowId": new_workflow_id,
        "environmentId": new_env_id,
        "secretReferences": bundle.get("secretReferences", [])
    }


@router.post("/import/dry-run")
async def import_workflow_dry_run(bundle: Dict[str, Any]):
    """
    Validate a workflow bundle without persisting
    Returns summary of what would be created/modified
    """
    db = get_database()
    
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
    
    # Check for environment references
    old_env_id = workflow_data.get("environmentId")
    if old_env_id:
        env_exists = await db.environments.find_one({"environmentId": old_env_id})
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
        warnings.append(f"Workflow contains {len(secret_refs)} secret references that must be re-entered")
    
    summary = {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "nodes": len(workflow_data.get("nodes", [])),
            "edges": len(workflow_data.get("edges", [])),
            "variables": len(workflow_data.get("variables", {})),
            "secretReferences": len(secret_refs),
            "environmentsIncluded": len(bundle.get("environments", []))
        }
    }
    
    return summary


@router.post("/import/har")
async def import_har_file(
    file: Optional[UploadFile] = File(None),
    import_mode: str = Query("linear"),
    environment_id: Optional[str] = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False)  # NEW: Just return nodes without creating workflow
):
    """
    Import a HAR file and convert to workflow
    Accepts file upload via multipart/form-data
    
    If parse_only=true, returns just the parsed nodes array without creating a workflow
    """
    db = get_database()
    
    try:
        # Parse HAR data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="HAR file is required"
            )
        
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in HAR file: {str(e)}"
            )
        
        # Validate HAR structure
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key"
            )
        
        # Convert HAR to workflow
        try:
            workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalRequests": len(http_nodes),
                    "importMode": import_mode
                }
            }
        
        # Otherwise, create full workflow in database
        new_workflow_id = str(uuid.uuid4())
        now = datetime.now(UTC)
        
        workflow_doc = {
            "workflowId": new_workflow_id,
            "name": workflow_data["name"],
            "description": workflow_data["description"],
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "variables": workflow_data.get("variables", {}),
            "tags": workflow_data.get("tags", []),
            "nodeTemplates": [],  # Initialize empty templates
            "environmentId": environment_id,
            "createdAt": now,
            "updatedAt": now,
            "version": 1
        }
        
        await db.workflows.insert_one(workflow_doc)
        
        return {
            "message": "HAR file imported successfully",
            "workflowId": new_workflow_id,
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importMode": import_mode
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"HAR import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import HAR file: {str(e)}"
        )


@router.post("/import/har/dry-run")
async def import_har_dry_run(
    file: Optional[UploadFile] = File(None),
    import_mode: str = Query("linear"),
    sanitize: bool = Query(True)
):
    """
    Preview HAR import without persisting
    Returns proposed workflow structure
    """
    try:
        # Parse HAR data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="HAR file is required"
            )
        
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in HAR file: {str(e)}"
            )
        
        # Validate HAR structure
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key"
            )
        
        # Convert HAR to workflow (preview only)
        try:
            workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Return preview
        return {
            "message": "HAR preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"])
            },
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importMode": import_mode,
                "entries": len(har_data.get("log", {}).get("entries", []))
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"HAR dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview HAR file: {str(e)}"
        )
    
    # Return preview
    entries = har_data.get("log", {}).get("entries", [])
    preview_entries = []
    
    for entry in entries[:10]:  # Show first 10 for preview
        request = entry.get("request", {})
        preview_entries.append({
            "method": request.get("method", ""),
            "url": request.get("url", ""),
            "time": entry.get("time", 0)
        })
    
    return {
        "valid": True,
        "workflow": workflow_data,
        "preview": preview_entries,
        "stats": {
            "totalEntries": len(entries),
            "nodes": len(workflow_data["nodes"]),
            "edges": len(workflow_data["edges"]),
            "importMode": import_mode
        }
    }


@router.post("/import/openapi")
async def import_openapi_file(
    file: Optional[UploadFile] = File(None),
    base_url: str = Query(""),
    tag_filter: Optional[str] = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False)  # NEW: Just return nodes without creating workflow
):
    """
    Import an OpenAPI/Swagger file and convert to workflow
    Accepts file upload via multipart/form-data
    
    If parse_only=true, returns just the parsed nodes array without creating a workflow
    """
    db = get_database()
    
    try:
        # Parse OpenAPI data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OpenAPI file is required"
            )
        
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {str(e)}"
            )
        
        # Validate OpenAPI structure
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key"
            )
        
        # Parse tag filter
        tags = tag_filter.split(",") if tag_filter else None
        
        # Convert OpenAPI to workflow
        try:
            workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalEndpoints": len(http_nodes),
                    "apiTitle": openapi_data.get("info", {}).get("title", "API")
                }
            }
        
        # Otherwise, create full workflow in database
        new_workflow_id = str(uuid.uuid4())
        now = datetime.now(UTC)
        
        workflow_doc = {
            "workflowId": new_workflow_id,
            "name": workflow_data["name"],
            "description": workflow_data["description"],
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "variables": workflow_data.get("variables", {}),
            "tags": workflow_data.get("tags", []),
            "nodeTemplates": [],  # Initialize empty templates
            "environmentId": None,
            "createdAt": now,
            "updatedAt": now,
            "version": 1
        }
        
        await db.workflows.insert_one(workflow_doc)
        
        return {
            "message": "OpenAPI file imported successfully",
            "workflowId": new_workflow_id,
            "stats": {
                "totalEndpoints": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "apiTitle": openapi_data.get("info", {}).get("title", "API")
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"OpenAPI import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI file: {str(e)}"
        )


@router.post("/import/openapi/dry-run")
async def import_openapi_dry_run(
    file: Optional[UploadFile] = File(None),
    base_url: str = Query(""),
    tag_filter: Optional[str] = Query(None),
    sanitize: bool = Query(True)
):
    """
    Preview OpenAPI import without persisting
    Returns proposed workflow structure
    """
    try:
        # Parse OpenAPI data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OpenAPI file is required"
            )
        
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {str(e)}"
            )
        
        # Validate OpenAPI structure
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key"
            )
        
        # Parse tag filter
        tags = tag_filter.split(",") if tag_filter else None
        
        # Get available tags from spec
        available_tags = []
        spec_tags = openapi_data.get("tags", [])
        for tag in spec_tags:
            available_tags.append({
                "name": tag.get("name", ""),
                "description": tag.get("description", "")
            })
        
        # Get available servers
        available_servers = []
        for server in openapi_data.get("servers", []):
            available_servers.append({
                "url": server.get("url", ""),
                "description": server.get("description", "")
            })
        
        # Convert OpenAPI to workflow (preview only)
        try:
            workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Return preview
        return {
            "message": "OpenAPI preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"])
            },
            "stats": {
                "totalEndpoints": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "apiTitle": openapi_data.get("info", {}).get("title", "API"),
                "apiVersion": openapi_data.get("info", {}).get("version", "")
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "availableTags": available_tags,
            "availableServers": available_servers
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"OpenAPI dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview OpenAPI file: {str(e)}"
        )


@router.post("/import/curl/dry-run")
async def import_curl_dry_run(
    sanitize: bool = Query(True),
    curl_command: Optional[str] = Query(None)
):
    """
    Preview curl command(s) import without persisting
    Returns proposed workflow structure
    Accepts curl command via query parameter or request body
    """
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="curl command is required"
            )
        
        # Convert curl to workflow (preview only)
        try:
            workflow_data = parse_curl_to_workflow(curl_command, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Return preview
        return {
            "message": "Curl preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"])
            },
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importType": "curl"
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Curl dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview curl command: {str(e)}"
        )



@router.put("/{workflow_id}/collection")
async def attach_workflow_to_collection(workflow_id: str, collection_id: Optional[str] = Query(None)):
    """
    Attach or detach a workflow to/from a collection.
    
    If collection_id is null, workflow becomes unattached.
    Multiple workflows can be attached to the same collection.
    """
    db = get_database()
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # If attaching, verify collection exists
    if collection_id:
        collection = await db.collections.find_one({"collectionId": collection_id})
        if not collection:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection {collection_id} not found"
            )
    
    # Update workflow
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": {
            "collectionId": collection_id,
            "updatedAt": datetime.now(UTC)
        }}
    )
    
    # Return updated workflow
    updated = await db.workflows.find_one({"workflowId": workflow_id})
    return Workflow(**updated)


@router.get("/by-collection/{collection_id}")
async def list_workflows_by_collection(collection_id: str):
    """Get all workflows attached to a collection."""
    db = get_database()
    
    cursor = db.workflows.find({"collectionId": collection_id}).sort("createdAt", -1)
    workflows = await cursor.to_list(length=None)
    return [Workflow(**w) for w in workflows]



@router.post("/bulk-attach-collection")
async def bulk_attach_workflows(
    workflow_ids: List[str] = Query(...),
    collection_id: Optional[str] = Query(None)
):
    """Attach multiple workflows to a collection."""
    db = get_database()
    
    # Verify all workflows exist
    for wid in workflow_ids:
        workflow = await db.workflows.find_one({"workflowId": wid})
        if not workflow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workflow {wid} not found"
            )
    
    # If attaching, verify collection exists
    if collection_id:
        collection = await db.collections.find_one({"collectionId": collection_id})
        if not collection:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection {collection_id} not found"
            )
    
    # Update all workflows
    await db.workflows.update_many(
        {"workflowId": {"$in": workflow_ids}},
        {"$set": {
            "collectionId": collection_id,
            "updatedAt": datetime.now(UTC)
        }}
    )
    
    return {
        "message": f"Updated {len(workflow_ids)} workflows",
        "count": len(workflow_ids),
        "collectionId": collection_id
    }


# Node Templates Management Endpoints

@router.get("/{workflow_id}/templates")
async def get_workflow_templates(workflow_id: str):
    """Get all node templates for a workflow"""
    db = get_database()
    
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return {
        "workflowId": workflow_id,
        "templates": workflow.get("nodeTemplates", [])
    }


@router.post("/{workflow_id}/templates")
async def add_workflow_templates(
    workflow_id: str,
    templates: List[Dict[str, Any]]
):
    """Add node templates to a workflow (appends to existing templates)"""
    db = get_database()
    
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Get existing templates
    existing_templates = workflow.get("nodeTemplates", [])
    
    # Append new templates
    updated_templates = existing_templates + templates
    
    # Update workflow
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": {
            "nodeTemplates": updated_templates,
            "updatedAt": datetime.now(UTC)
        }}
    )
    
    return {
        "message": f"Added {len(templates)} template(s) to workflow",
        "workflowId": workflow_id,
        "totalTemplates": len(updated_templates)
    }


@router.put("/{workflow_id}/templates")
async def replace_workflow_templates(
    workflow_id: str,
    templates: List[Dict[str, Any]]
):
    """Replace all node templates for a workflow"""
    db = get_database()
    
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Replace templates
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": {
            "nodeTemplates": templates,
            "updatedAt": datetime.now(UTC)
        }}
    )
    
    return {
        "message": "Templates replaced successfully",
        "workflowId": workflow_id,
        "totalTemplates": len(templates)
    }


@router.delete("/{workflow_id}/templates")
async def clear_workflow_templates(workflow_id: str):
    """Clear all node templates for a workflow"""
    db = get_database()
    
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Clear templates
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": {
            "nodeTemplates": [],
            "updatedAt": datetime.now(UTC)
        }}
    )
    
    return {
        "message": "Templates cleared successfully",
        "workflowId": workflow_id
    }


@router.post("/import/curl")
async def import_curl_file(
    sanitize: bool = Query(True),
    curl_command: Optional[str] = Query(None),
    workflowId: Optional[str] = Query(None),
    parse_only: bool = Query(False)  # NEW: Just return nodes without creating workflow
):
    """
    Import curl command(s) and convert to workflow.
    
    If parse_only=true, returns just the parsed nodes array without creating/updating a workflow.
    If workflowId is provided, append to that workflow. Otherwise, create new workflow.
    """
    db = get_database()
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="curl command is required"
            )
        # Convert curl to workflow nodes/edges
        try:
            workflow_data = parse_curl_to_workflow(curl_command, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalRequests": len(http_nodes),
                    "importType": "curl"
                }
            }

        if workflowId:
            # Append to existing workflow
            existing = await db.workflows.find_one({"workflowId": workflowId})
            if not existing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Workflow {workflowId} not found"
                )
            # Remove start/end nodes from imported data
            imported_nodes = [n for n in workflow_data["nodes"] if n["type"] != "start" and n["type"] != "end"]
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
            existing_positions = [n.get("position", {}) for n in existing["nodes"] if n.get("position")]
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

            # Append nodes/edges
            updated_nodes = existing["nodes"] + imported_nodes
            updated_edges = existing["edges"] + imported_edges
            # Update DB
            await db.workflows.update_one(
                {"workflowId": workflowId},
                {"$set": {
                    "nodes": updated_nodes,
                    "edges": updated_edges,
                    "updatedAt": datetime.now(UTC)
                }}
            )
            return {
                "message": f"Curl commands imported and appended to workflow {workflowId}",
                "workflowId": workflowId,
                "stats": {
                    "totalRequests": len(imported_nodes),
                    "importType": "curl"
                }
            }
        else:
            # Create new workflow as before
            new_workflow_id = str(uuid.uuid4())
            now = datetime.now(UTC)
            workflow_doc = {
                "workflowId": new_workflow_id,
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodes": workflow_data["nodes"],
                "edges": workflow_data["edges"],
                "variables": workflow_data.get("variables", {}),
                "tags": workflow_data.get("tags", []),
                "nodeTemplates": [],  # Initialize empty templates
                "environmentId": None,
                "createdAt": now,
                "updatedAt": now,
                "version": 1
            }
            await db.workflows.insert_one(workflow_doc)
            return {
                "message": "Curl commands imported successfully",
                "workflowId": new_workflow_id,
                "stats": {
                    "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                    "importType": "curl"
                }
            }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Curl import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import curl command: {str(e)}"
        )

