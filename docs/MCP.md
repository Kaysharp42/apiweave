# MCP Integration Guide

> Model Context Protocol (MCP) server for APIWeave — enables AI coding agents to manage workflows, environments, collections, and executions programmatically.

---

## Overview

APIWeave exposes an MCP server so AI agents (Claude, Cursor, VS Code, opencode, etc.) can interact with the backend without going through the REST API. The server uses the official `mcp` Python SDK with FastMCP and supports two transports:

| Transport | Use Case | Auth |
|-----------|----------|------|
| **stdio** | Local CLI/desktop agents launched as subprocesses | None (local only) |
| **Streamable HTTP** | IDE/browser/remote agents | API key + Origin validation |

Both transports call the same shared service layer in `backend/app/services/`, ensuring consistent behavior and secret sanitization.

---

## Quick Start

### Prerequisites

- Python 3.12+
- MongoDB running and accessible
- Backend dependencies installed (`cd backend && pip install -e .`)

### Configuration

Add these settings to `backend/.env`:

```env
# Enable MCP
MCP_ENABLED=true

# Enable HTTP transport (set to false for stdio-only)
MCP_HTTP_ENABLED=true

# API key for HTTP transport (generate a secure random string)
MCP_API_KEY=your-secret-api-key

# Allowed origins for HTTP transport (comma-separated)
MCP_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Require API key for HTTP transport
MCP_REQUIRE_API_KEY=true
```

### Running the Server

**Stdio mode** (for local agents):
```bash
cd backend && python mcp_stdio.py
```

**HTTP mode** (mounted at `/mcp` on the FastAPI server):
```bash
cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The MCP endpoint will be available at `http://localhost:8000/mcp` when `MCP_HTTP_ENABLED=true`.

---

## Tool Inventory

The MCP server exposes **56 tools** organized by domain, plus **5 resources** and **4 prompts**. All read/export tools redact persisted secrets. Runtime secrets are accepted only for `workflow_run` and are never persisted or echoed back.

### Server Info

| Tool | Description |
|------|-------------|
| `server_info` | Return information about the APIWeave MCP server |

### Workflow Tools (10)

| Tool | Description |
|------|-------------|
| `workflow_list` | List/search workflows with pagination, tag, and name filters |
| `workflow_get` | Get full workflow definition with secret-like values redacted |
| `workflow_create` | Create a workflow from structured nodes, edges, variables, tags |
| `workflow_update` | Update workflow metadata, nodes, edges, variables, tags, templates |
| `workflow_export` | Export a sanitized workflow bundle (secrets never returned) |
| `workflow_import` | Import a workflow bundle with sanitization |
| `workflow_import_dry_run` | Validate a workflow import bundle without persisting |
| `workflow_delete` | Delete a workflow permanently (destructive) |
| `workflow_attach_collection` | Attach or detach a workflow to/from a collection |
| `workflow_set_environment` | Assign or clear the default environment for a workflow |

### Environment Tools (7)

| Tool | Description |
|------|-------------|
| `environment_list` | List all environments with secrets redacted |
| `environment_get_active` | Get the active environment with secrets redacted |
| `environment_create` | Create a new environment (no secrets accepted) |
| `environment_get` | Get an environment by ID with secrets redacted |
| `environment_update` | Update environment metadata/variables (no secrets) |
| `environment_delete` | Delete an environment (blocked if workflows reference it) |
| `environment_activate` | Set an environment as active (deactivates others) |
| `environment_duplicate` | Duplicate an environment. Variables copied; secrets redacted in response |
| `mcp_get_config_summary` | Get MCP server configuration summary. Capability flags only — no secrets |

### Collection Tools (11)

| Tool | Description |
|------|-------------|
| `collection_list` | List collections with workflow counts |
| `collection_list_workflows` | List workflows in a collection |
| `collection_create` | Create a new collection |
| `collection_get` | Get a collection by ID with workflow count |
| `collection_update` | Update collection metadata |
| `collection_delete` | Delete a collection (blocked if workflows exist) |
| `collection_export` | Export a sanitized collection bundle with all workflows |
| `collection_import` | Import a collection bundle |
| `collection_import_dry_run` | Validate a collection import bundle |
| `collection_add_workflow` | Add a workflow to a collection |
| `collection_remove_workflow` | Remove a workflow from a collection |

### Run Tools (7)

| Tool | Description |
|------|-------------|
| `workflow_run` | Trigger workflow execution with optional environment, resume config, runtime secrets |
| `run_get_status` | Poll run status with compact node summaries (no full payloads) |
| `run_get_results` | Get human-readable run result summary (no request/response payloads) |
| `run_get_node_result` | Fetch full result for one node, including GridFS-backed payloads |
| `run_latest_failed` | Get latest failed run metadata for resume workflows |
| `run_list` | List runs with workflow/status filters and pagination |
| `run_cancel` | Cancel a pending or running workflow execution |

### Import Tools (6)

| Tool | Description |
|------|-------------|
| `import_openapi_url` | Import request nodes from OpenAPI/Swagger UI URL |
| `import_openapi` | Import OpenAPI content from JSON/YAML string |
| `import_openapi_dry_run` | Preview OpenAPI import (validates without creating) |
| `import_har` | Import HTTP requests from HAR file content |
| `import_har_dry_run` | Preview HAR import (validates without creating) |
| `import_curl` | Import one or more curl commands as request nodes |

### Environment Secret Tools (2) — Config-Gated

These tools require `MCP_ALLOW_SECRET_WRITES=true` in server configuration. They are shipped but disabled by default for safety.

| Tool | Description |
|------|-------------|
| `environment_set_secret` | Set a persisted secret on an environment (write-only, never returned). Requires `MCP_ALLOW_SECRET_WRITES=true`. |
| `environment_delete_secret` | Delete a persisted secret from an environment. Requires `MCP_ALLOW_SECRET_WRITES=true`. |

### Webhook Tools (7)

| Tool | Description |
|------|-------------|
| `webhook_list` | List webhooks with optional resource filter and pagination |
| `webhook_get` | Get webhook details with credentials redacted |
| `webhook_create` | Create a webhook. Returns one-time credentials — save immediately! |
| `webhook_update` | Update webhook configuration (environment, enabled, description) |
| `webhook_delete` | Delete a webhook. Destructive — cannot be undone. |
| `webhook_regenerate_credentials` | Regenerate webhook token and HMAC secret. Invalidates old credentials. |
| `webhook_get_logs` | Get webhook execution logs with pagination. Sensitive fields redacted. |

### Collection-Run Read Tools (3)

Read-only tools based on backend readiness gate. Execution tools deferred until backend collection execution is stable.

| Tool | Description |
|------|-------------|
| `collection_run_list` | List collection runs for a collection with pagination. Read-only. |
| `collection_run_get` | Get a collection run by ID. Read-only. |
| `collection_run_latest` | Get the latest collection run for a collection. Read-only. |

### Resources (5)

Resources are read-only context that agents can reference. They do not perform actions.

| Resource URI | Description |
|--------------|-------------|
| `environment://{environment_id}` | Read-only snapshot of an environment with secrets redacted |
| `environments://list` | List all environments as read-only reference |
| `run://{run_id}` | Read-only snapshot of a workflow run status and metadata |
| `workflow://{workflow_id}` | Read-only snapshot of a workflow definition with secrets redacted |

### Prompts (4)

Prompts are user-invoked templates that guide agents through common workflows.

| Prompt | Description |
|--------|-------------|
| `create_test_from_openapi` | Generate a test workflow from an OpenAPI/Swagger specification |
| `create_test_from_curl` | Generate a test workflow from curl commands |
| `debug_failed_run` | Structured plan for debugging a failed workflow run |
| `resume_failed_workflow` | Structured plan for resuming a failed workflow from failed nodes |

---

## Setup Instructions

### Claude Desktop

1. Open Claude Desktop settings
2. Go to the Developer tab → "Edit Config"
3. Add the stdio configuration:

```json
{
  "mcpServers": {
    "apiweave": {
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "/path/to/apiweave/backend"
    }
  }
}
```

For HTTP transport, use:
```json
{
  "mcpServers": {
    "apiweave": {
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

See `mcp-configs/claude_desktop_config.json` for a complete example.

### Cursor

1. Go to Settings → Features → MCP
2. Add a new MCP server with the stdio or HTTP configuration

See `mcp-configs/cursor_mcp.json` for the format.

### VS Code

1. Create `.vscode/mcp.json` in your workspace
2. Add the server configuration:

```json
{
  "servers": {
    "apiweave": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "${workspaceFolder}/backend"
    }
  }
}
```

See `mcp-configs/vscode_mcp.json` for a complete example.

### GitHub Copilot CLI

1. Open GitHub Copilot CLI
2. Run the interactive command: `/mcp add apiweave`
3. Select **Local or STDIO** as the server type
4. Enter the command: `python mcp_stdio.py`
5. Set the working directory to your `backend` folder
6. Press `Ctrl+S` to save

Alternatively, edit `~/.copilot/mcp-config.json` directly:

```json
{
  "mcpServers": {
    "apiweave": {
      "type": "local",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "/path/to/apiweave/backend",
      "tools": ["*"]
    }
  }
}
```

For HTTP transport, use:
```json
{
  "mcpServers": {
    "apiweave": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      },
      "tools": ["*"]
    }
  }
}
```

**Managing servers in Copilot CLI:**
- `/mcp show` — list all configured servers
- `/mcp show apiweave` — view server details and tools
- `/mcp edit apiweave` — edit configuration
- `/mcp disable apiweave` — temporarily disable
- `/mcp enable apiweave` — re-enable

### GitHub Copilot (VS Code)

1. Create `.vscode/mcp.json` in your workspace root
2. Add the server configuration:

```json
{
  "servers": {
    "apiweave": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "${workspaceFolder}/backend"
    }
  }
}
```

For HTTP transport:
```json
{
  "servers": {
    "apiweave": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

Alternatively, add to your VS Code `settings.json`:
```json
{
  "chat.mcp.discovery.enabled": true
}
```

See `mcp-configs/vscode_mcp.json` for a complete example.

### OpenAI Codex (CLI, VS Code, Desktop)

Codex uses TOML configuration files. All three interfaces (CLI, VS Code extension, macOS Desktop app) share the same config.

**Configuration locations:**

| Scope | Windows | macOS/Linux |
|-------|---------|-------------|
| User (global) | `%USERPROFILE%\.codex\config.toml` | `~/.codex/config.toml` |
| Project | `.codex\config.toml` | `.codex/config.toml` |

**Quick setup via CLI:**
```bash
# Add stdio server
codex mcp add apiweave -- python mcp_stdio.py

# Add with working directory
codex mcp add apiweave --cwd /path/to/apiweave/backend -- python mcp_stdio.py

# Add HTTP server
codex mcp add apiweave --url http://localhost:8000/mcp --bearer-token-env-var MCP_API_KEY
```

**Manual config (`~/.codex/config.toml` or `.codex/config.toml`):**

```toml
[mcp_servers.apiweave]
command = "python"
args = ["mcp_stdio.py"]
cwd = "/path/to/apiweave/backend"
enabled = true
```

For HTTP transport:
```toml
[mcp_servers.apiweave]
url = "http://localhost:8000/mcp"
bearer_token_env_var = "MCP_API_KEY"
enabled = true
```

**Tool control (optional):**
```toml
[mcp_servers.apiweave]
command = "python"
args = ["mcp_stdio.py"]
cwd = "/path/to/apiweave/backend"
enabled = true
enabled_tools = ["workflow_list", "workflow_run", "run_get_status"]
# Or deny specific tools:
# disabled_tools = ["workflow_delete", "environment_delete"]
```

**Managing servers in Codex CLI:**
```bash
codex mcp list              # List all servers
codex mcp get apiweave      # Show server details
codex mcp remove apiweave   # Remove server
codex mcp login apiweave    # OAuth login (if server supports it)
```

### opencode

Add to your `opencode.json` or `opencode.jsonc`:

```json
{
  "mcp": {
    "apiweave": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "${workspaceFolder}/backend"
    }
  }
}
```

For HTTP transport:
```json
{
  "mcp": {
    "apiweave": {
      "type": "http",
      "url": "http://localhost:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}
```

See `mcp-configs/opencode_mcp.json` for a complete example.

---

## Stdio Working Directory and `.env` Loading

The stdio entry point (`mcp_stdio.py`) loads `.env` from the **backend** working directory:

```python
load_dotenv(backend_dir / ".env")
```

When configuring a stdio client, ensure the `cwd` (or equivalent) is set to the `backend` directory so that:
- The `.env` file is found and loaded
- Relative paths (e.g., `ARTIFACTS_PATH`) resolve correctly
- The Python module path includes `backend/app/`

If your client does not support a `cwd` field, use an absolute path to `mcp_stdio.py` and set the `PYTHONPATH` environment variable to include the backend directory.

---

## Streamable HTTP Authentication

MCP HTTP authentication is machine-to-machine key authentication. It is intentionally separate from APIWeave human SSO sessions, CSRF cookies, and browser permissions. Do not use MCP keys as user login credentials, and do not expose them to frontend code.

When `MCP_HTTP_ENABLED=true` and `MCP_REQUIRE_API_KEY=true`:

- All requests to `/mcp` must include an `Authorization: Bearer <MCP_API_KEY>` header
- The `Origin` header is validated against `MCP_ALLOWED_ORIGINS`
- Requests without valid auth receive a 401/403 response

Production deployments must keep `MCP_REQUIRE_API_KEY=true`, use a strong random `MCP_API_KEY`, and restrict `MCP_ALLOWED_ORIGINS` to trusted agent hosts only. Disabling API-key auth is only acceptable for isolated local development.

---

## Secret Policy

MCP enforces strict secret handling:

| Operation | Secret Behavior |
|-----------|----------------|
| **Read tools** (`workflow_get`, `environment_list`, etc.) | Persisted secrets are redacted to `<SECRET>` |
| **Export tools** (`workflow_export`, `collection_export`) | Secrets are removed or replaced with placeholders |
| **`workflow_run`** | Runtime secrets are accepted but never persisted or echoed back |
| **Create/Update tools** | Persisted secrets are not accepted; use `runtime_secrets` on `workflow_run` |
| **Import tools** | Secret-like values are sanitized during import |

### What is considered a secret?

Values matching patterns like `sk-`, `key_`, `secret`, `password`, `token`, `api_key`, etc. are detected and redacted. The detection logic is in `backend/app/services/secret_utils.py`.

---

## Agent Workflow Examples

### Creating and Running a Workflow

```
1. Call workflow_list to check existing workflows
2. Call import_openapi_url to discover endpoints from an API spec
3. Call workflow_create with the discovered nodes
4. Call environment_list to find an environment
5. Call workflow_run with the workflow ID and environment
6. Call run_get_status to poll (use the polling_hint interval)
7. When terminal, call run_get_results for a summary
8. Use run_get_node_result for specific node details if needed
```

### Resuming a Failed Workflow

```
1. Call run_latest_failed with the workflow ID
2. Use the returned failed_node_ids and run_id
3. Call workflow_run with resume_mode="single" or "all-failed"
   and resume_source_run_id from the failed run
```

### Importing from curl

```
1. Call import_curl with the curl command string
2. Review the returned nodes
3. Call workflow_create with the nodes
```

---

## Troubleshooting

### MCP server won't start (stdio)

- **Symptom**: No output or garbled output
- **Cause**: `print()` statements corrupting stdout
- **Fix**: Ensure no `print()` calls exist in the execution path. All diagnostics use `logging` to stderr.

### Tools not found

- **Symptom**: `tools/list` returns empty or missing tools
- **Cause**: `register_tools()` was not called before starting
- **Fix**: Ensure `register_tools()` is called in the stdio entry point or during FastAPI startup

### HTTP transport returns 401

- **Symptom**: Unauthorized error on `/mcp` requests
- **Cause**: Missing or incorrect API key
- **Fix**: Include `Authorization: Bearer <MCP_API_KEY>` header

### HTTP transport returns 403

- **Symptom**: Forbidden error on `/mcp` requests
- **Cause**: Origin header not in `MCP_ALLOWED_ORIGINS`
- **Fix**: Add your origin to `MCP_ALLOWED_ORIGINS` in `.env`

### Database connection errors

- **Symptom**: Tool calls fail with database errors
- **Cause**: MongoDB not running or `MONGODB_URL` incorrect
- **Fix**: Verify MongoDB is accessible and `.env` has correct `MONGODB_URL`

### Secret values appearing in responses

- **Symptom**: Tool responses contain what look like API keys or tokens
- **Cause**: The value doesn't match the secret detection patterns
- **Fix**: Review `detect_secrets_in_value()` in `secret_utils.py` and add patterns if needed

---

## Future/Deferred Capabilities

The following are not currently implemented but may be added in future phases:

- **Collection execution trigger**: Backend collection webhook execution is a placeholder; MCP exposure deferred until backend execution is stable
- **Advanced run creation with callback URLs**: SSRF-safe callback validation needed before exposure
- **Workflow bulk collection attachment**: Requires stable service-layer atomicity guarantees
- **Template marketplace / scheduling / notifications**: Out of scope for MCP parity phase

---

## Architecture

```
AI Agents
    |
    | MCP stdio or Streamable HTTP
    v
backend/app/mcp/
    server.py          FastMCP server instance and tool registration
    transport.py       stdio and Streamable HTTP helpers
    auth.py            Streamable HTTP auth and Origin checks
    schemas/           Pydantic input/output models
    tools/             Thin MCP adapters grouped by resource
    |
    | calls shared services
    v
backend/app/services/
    workflow_service.py
    run_service.py
    environment_service.py
    collection_service.py
    import_service.py
    secret_utils.py
    |
    | uses repositories/models/executor
    v
MongoDB + Beanie + WorkflowExecutor
```

FastAPI routes call the same service functions, ensuring no duplication of business logic.
