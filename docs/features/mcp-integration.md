# MCP Integration

*APIWeave's Model Context Protocol (MCP) server, the bridge that lets AI coding agents drive workflows, environments, collections, runs, imports, webhooks, and secrets through a single machine-to-machine protocol. Covers both supported transports, the full tool surface, setup recipes for five major agents, and the security rules agents must follow.*

## Prerequisites

- [Installation](../getting-started/installation.md) so the backend and MongoDB are running.
- [Concepts](../getting-started/concepts.md) for the vocabulary of workflows, environments, runs, and secrets.
- [Architecture](../reference/architecture.md) for the place MCP occupies in the system.

## Table of Contents

- [What is MCP](#what-is-mcp)
- [Transports: stdio vs Streamable HTTP](#transports-stdio-vs-streamable-http)
- [Quick Start](#quick-start)
- [Tool Inventory](#tool-inventory)
- [Setup for Major Agents](#setup-for-major-agents)
  - [Claude Desktop](#claude-desktop)
  - [Cursor](#cursor)
  - [VS Code](#vs-code)
  - [opencode](#opencode)
  - [Codex](#codex)
- [Streamable HTTP Authentication](#streamable-http-authentication)
- [Secret Policy](#secret-policy)
- [MCP Import Security](#mcp-import-security)
- [Agent Workflow Examples](#agent-workflow-examples)
- [Troubleshooting](#troubleshooting)

## What is MCP

The Model Context Protocol (MCP) is an open standard for connecting AI agents to the tools and data of an application. The agent speaks the protocol, and the application exposes its capabilities as a set of named **tools** (actions), **resources** (read-only context), and **prompts** (guided templates).

APIWeave runs an MCP server so agents such as Claude, Cursor, VS Code, opencode, and Codex can manage workflows, run them, read results, and import specifications without driving the browser. The server uses the official `mcp` Python SDK with FastMCP, and both transports call the same shared service layer in `backend/app/services/`, so behavior stays consistent with the REST API and the frontend.

Why expose MCP at all? Because agents that already understand API testing benefit from a structured surface that hides transport quirks, paginates results, and never echoes back a secret it should not have seen.

## Transports: stdio vs Streamable HTTP

APIWeave supports two MCP transports. Pick the one that matches where the agent runs.

| Transport | Use case | Authentication |
| --- | --- | --- |
| **stdio** | Local agents launched as subprocesses (Claude Desktop, Codex CLI) | None. Process boundary is the trust boundary. |
| **Streamable HTTP** | IDE extensions, remote agents, browser-based agents, any caller that can reach `/mcp` over HTTP | API key + Origin validation |

**stdio** is the simplest setup. The agent starts `python mcp_stdio.py` as a child process, talks to it over standard input and output, and the process exits when the agent quits. The Python process loads `.env` from the `backend` directory and then registers every tool before handling the first request.

**Streamable HTTP** mounts the MCP server at `/mcp` on the FastAPI app. Any HTTP-capable agent connects to `http://localhost:8000/mcp` (or your deployed URL), sends an `Authorization: Bearer <MCP_API_KEY>` header, and gets the same tools over JSON-RPC. This is the only choice for remote or multi-user deployments.

## Quick Start

Add the following settings to `backend/.env`, then restart the backend:

```env
# Enable the MCP server module
MCP_ENABLED=true

# Enable the Streamable HTTP transport (set to false for stdio-only)
MCP_HTTP_ENABLED=true

# API key for the HTTP transport. Generate a strong random string.
MCP_API_KEY=replace-with-a-long-random-string

# Comma-separated origins allowed to call the HTTP transport
MCP_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Require the API key on every HTTP request (do not disable in production)
MCP_REQUIRE_API_KEY=true

# Permit write tools for persisted environment secrets (default false)
MCP_ALLOW_SECRET_WRITES=false
```

**Run the stdio server** (for local agents):

```bash
cd backend
python mcp_stdio.py
```

**Run the HTTP server** (mounted on the FastAPI app):

```bash
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The MCP endpoint is then reachable at `http://localhost:8000/mcp`.

## Tool Inventory

As of 2026-06-13, the MCP server exposes **56 tools**, registered as `server.tool(` calls in the `backend/app/mcp/` module. The count comes from the function-based registration pattern (FastMCP), not the `@decorator` syntax. The 56 tools break down as `server.py` (1), `collections.py` (11), `workflows.py` (10), `environments.py` (9), `runs.py` (7), `webhooks.py` (7), `imports.py` (6), `collection_runs.py` (3), and `secrets.py` (2). The server also ships 5 resources and 4 prompts that are listed at the end of this section.

All read and export tools redact persisted secrets. Runtime secrets are accepted only on the `workflow_run` tool and are never persisted or echoed back.

### Server Info (1)

| Tool | Description |
| --- | --- |
| `server_info` | Return information about the APIWeave MCP server (capability flags, no secrets). |

### Workflow Tools (10)

| Tool | Description |
| --- | --- |
| `workflow_list` | List and search workflows with pagination, tag, and name filters. |
| `workflow_get` | Get a workflow definition. Secret-like values are redacted. |
| `workflow_create` | Create a workflow from structured nodes, edges, variables, and tags. |
| `workflow_update` | Update metadata, nodes, edges, variables, tags, and templates. |
| `workflow_export` | Export a sanitized workflow bundle. Secrets are never included. |
| `workflow_import` | Import a workflow bundle with sanitization. |
| `workflow_import_dry_run` | Validate an import bundle without persisting anything. |
| `workflow_delete` | Delete a workflow permanently. Destructive. |
| `workflow_attach_collection` | Attach or detach a workflow to or from a collection. |
| `workflow_set_environment` | Assign or clear the default environment for a workflow. |

### Environment Tools (9)

| Tool | Description |
| --- | --- |
| `environment_list` | List all environments with secrets redacted. |
| `environment_get_active` | Get the active environment with secrets redacted. |
| `environment_create` | Create a new environment. Persisted secrets are not accepted. |
| `environment_get` | Get an environment by ID with secrets redacted. |
| `environment_update` | Update environment metadata and variables. Persisted secrets are not accepted. |
| `environment_delete` | Delete an environment. Blocked if workflows still reference it. |
| `environment_activate` | Set an environment as active. Deactivates all others. |
| `environment_duplicate` | Duplicate an environment. Variables are copied; secrets are redacted in the response. |
| `mcp_get_config_summary` | Return the MCP server configuration summary. Capability flags only. |

### Collection Tools (11)

| Tool | Description |
| --- | --- |
| `collection_list` | List collections with workflow counts. |
| `collection_list_workflows` | List the workflows in a collection. |
| `collection_create` | Create a new collection. |
| `collection_get` | Get a collection by ID with workflow count. |
| `collection_update` | Update collection metadata. |
| `collection_delete` | Delete a collection. Blocked if workflows still exist in it. |
| `collection_export` | Export a sanitized collection bundle that includes all workflows. |
| `collection_import` | Import a collection bundle. |
| `collection_import_dry_run` | Validate a collection import bundle without persisting. |
| `collection_add_workflow` | Add a workflow to a collection. |
| `collection_remove_workflow` | Remove a workflow from a collection. |

### Run Tools (7)

| Tool | Description |
| --- | --- |
| `workflow_run` | Trigger workflow execution with optional environment, resume config, and runtime secrets. |
| `run_get_status` | Poll run status with compact node summaries. Full payloads are omitted. |
| `run_get_results` | Get a human-readable run result summary without request or response payloads. |
| `run_get_node_result` | Fetch the full result for one node, including GridFS-backed payloads. |
| `run_latest_failed` | Get the latest failed run metadata for a resume workflow. |
| `run_list` | List runs with workflow and status filters and pagination. |
| `run_cancel` | Cancel a pending or running workflow execution. |

### Import Tools (6)

| Tool | Description |
| --- | --- |
| `import_openapi_url` | Import request nodes from an OpenAPI or Swagger UI URL. |
| `import_openapi` | Import OpenAPI content from a JSON or YAML string. |
| `import_openapi_dry_run` | Preview an OpenAPI import. Validates without creating. |
| `import_har` | Import HTTP requests from HAR file content. |
| `import_har_dry_run` | Preview a HAR import. Validates without creating. |
| `import_curl` | Import one or more curl commands as request nodes. |

### Environment Secret Tools (2, config-gated)

These tools require `MCP_ALLOW_SECRET_WRITES=true` in the backend `.env`. They ship disabled by default for safety.

| Tool | Description |
| --- | --- |
| `environment_set_secret` | Set a persisted secret on an environment. Write only, never returned. Requires `MCP_ALLOW_SECRET_WRITES=true`. |
| `environment_delete_secret` | Delete a persisted secret from an environment. Requires `MCP_ALLOW_SECRET_WRITES=true`. |

### Webhook Tools (7)

| Tool | Description |
| --- | --- |
| `webhook_list` | List webhooks with an optional resource filter and pagination. |
| `webhook_get` | Get webhook details with credentials redacted. |
| `webhook_create` | Create a webhook. Returns one-time credentials. Save them immediately. |
| `webhook_update` | Update webhook configuration: environment, enabled flag, description. |
| `webhook_delete` | Delete a webhook. Destructive, cannot be undone. |
| `webhook_regenerate_credentials` | Regenerate webhook token and HMAC secret. Invalidates the old credentials. |
| `webhook_get_logs` | Get webhook execution logs with pagination. Sensitive fields are redacted. |

### Collection Run Read Tools (3)

Read-only tools. Execution tools for collections are deferred until the backend collection execution is stable.

| Tool | Description |
| --- | --- |
| `collection_run_list` | List collection runs for a collection with pagination. Read only. |
| `collection_run_get` | Get a collection run by ID. Read only. |
| `collection_run_latest` | Get the latest collection run for a collection. Read only. |

### Resources (5)

Resources are read-only context that an agent can reference. They do not perform actions.

| Resource URI | Description |
| --- | --- |
| `environment://{environment_id}` | Read-only snapshot of an environment with secrets redacted. |
| `environments://list` | Read-only list of all environments. |
| `run://{run_id}` | Read-only snapshot of a workflow run status and metadata. |
| `workflow://{workflow_id}` | Read-only snapshot of a workflow definition with secrets redacted. |
| `webhook://{webhook_id}` | Read-only snapshot of a webhook with credentials redacted. |

### Prompts (4)

Prompts are user-invoked templates that guide the agent through common workflows.

| Prompt | Description |
| --- | --- |
| `create_test_from_openapi` | Generate a test workflow from an OpenAPI or Swagger specification. |
| `create_test_from_curl` | Generate a test workflow from curl commands. |
| `debug_failed_run` | Structured plan for debugging a failed workflow run. |
| `resume_failed_workflow` | Structured plan for resuming a failed workflow from the failed nodes. |

## Setup for Major Agents

The configuration snippet for each agent follows. Replace `/path/to/apiweave/backend` with the absolute path to the `backend` directory on your machine, and replace `YOUR_MCP_API_KEY` with the value of `MCP_API_KEY` from `backend/.env`. Use stdio for a local agent that can run subprocesses, and Streamable HTTP for anything else.

### Claude Desktop

Open Claude Desktop, go to **Settings → Developer → Edit Config**, and add the stdio entry:

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

For Streamable HTTP, use a URL entry instead:

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

Restart Claude Desktop. The apiweave server appears in the tool picker with all 56 tools.

### Cursor

Open **Cursor → Settings → Features → MCP**, click **Add new global MCP server**, and paste the same JSON shape used for Claude Desktop. Cursor supports both `command` (stdio) and `url` (HTTP) entries. The server name `apiweave` shows up under the tool menu once Cursor finishes loading.

### VS Code

Create `.vscode/mcp.json` in your workspace root:

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

For Streamable HTTP, switch to a URL entry and add the bearer header. The GitHub Copilot Chat extension in VS Code reads the same file. If you do not want a workspace file, set `chat.mcp.discovery.enabled: true` in your user `settings.json` and put the configuration in your user MCP store.

### opencode

Add the following block to `opencode.json` or `opencode.jsonc` at the project root:

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

For Streamable HTTP, switch the type to `http`, set `url` to your MCP endpoint, and add the `Authorization` header. opencode inherits `MCP_API_KEY` from the environment, so a header template that reads `${env.MCP_API_KEY}` works as well.

### Codex

Codex uses TOML. The configuration file is `~/.codex/config.toml` (user) or `.codex/config.toml` (project). Add a server with the CLI:

```bash
# stdio
codex mcp add apiweave --cwd /path/to/apiweave/backend -- python mcp_stdio.py

# Streamable HTTP
codex mcp add apiweave --url http://localhost:8000/mcp --bearer-token-env-var MCP_API_KEY
```

Or write the file directly:

```toml
[mcp_servers.apiweave]
command = "python"
args = ["mcp_stdio.py"]
cwd = "/path/to/apiweave/backend"
enabled = true
```

Optional `enabled_tools` and `disabled_tools` lists give you a per-agent allow or deny list. Use them to give read-only agents only the read tools.

## Streamable HTTP Authentication

The HTTP transport is machine-to-machine key authentication. It is intentionally separate from the human SSO session, CSRF cookies, and browser permissions used by the frontend. Do not use an MCP key as a user login, and do not put an MCP key in frontend code.

When `MCP_HTTP_ENABLED=true` and `MCP_REQUIRE_API_KEY=true`:

- Every request to `/mcp` must carry `Authorization: Bearer <MCP_API_KEY>`.
- The `Origin` header is validated against the comma-separated list in `MCP_ALLOWED_ORIGINS`. A missing or unmatched origin returns 403.
- A request with no key, an unknown key, or a malformed header returns 401.
- The `Host` header is also checked against the trusted host list to prevent DNS rebinding.

Production deployments must keep `MCP_REQUIRE_API_KEY=true`, generate a strong random `MCP_API_KEY` (32 bytes or more), and restrict `MCP_ALLOWED_ORIGINS` to the exact origins the agent will call from. Disabling key auth is acceptable only on an isolated local development machine with no network exposure.

## Secret Policy

MCP enforces strict secret handling at the service layer:

| Operation | Secret behavior |
| --- | --- |
| **Read tools** (`workflow_get`, `environment_list`, `webhook_get`, and so on) | Persisted secrets are redacted to `<SECRET>`. |
| **Export tools** (`workflow_export`, `collection_export`) | Secrets are removed or replaced with placeholders. |
| **`workflow_run`** | Runtime secrets are accepted but never persisted or echoed back in the response. |
| **Create and update tools** | Persisted secrets are rejected at the boundary. Use `runtime_secrets` on `workflow_run` instead. |
| **Import tools** | Secret-like values are sanitized during import. |

Values matching patterns like `sk-`, `key_`, `secret`, `password`, `token`, and `api_key` are detected and redacted. The detection logic lives in `backend/app/services/secret_utils.py`. If you see what looks like a real secret in an MCP response, treat it as a bug and add the pattern to the detector.

## MCP Import Security

MCP import tools inherit SSRF protection from the service layer. When `import_openapi_url` or `import_har` reaches out to fetch a spec, the request is routed through the same approval gate that the REST API uses.

- Private IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, IPv6 link-local, and similar) are blocked when `BLOCK_PRIVATE_NETWORKS=true` (the default).
- Hostnames must resolve to a public IP, or the host must appear in the `APPROVED_DOMAINS` list with `APPROVED_DOMAINS_ENABLED=true`.
- The redirect chain is followed, but each hop is re-checked against the approval gate.

If your agent needs to import a spec from an internal service, publish the spec through a public-facing proxy, or add the host to `APPROVED_DOMAINS` and restart the backend. The agent cannot override the gate from the MCP call.

## Agent Workflow Examples

These are end-to-end playbooks an agent can follow without further prompting. The numbers in parentheses are the MCP tool names.

### Create and Run a Workflow

1. Call `workflow_list` (or `workflow_search` if available) to check for duplicates.
2. Call `import_openapi_url` with the spec URL to discover endpoints.
3. Call `workflow_create` with the discovered nodes, edges, and variables.
4. Call `environment_list` to find the right environment, or `environment_get_active` to reuse the current one.
5. Call `workflow_run` with the workflow ID, the environment ID, and any runtime secrets.
6. Call `run_get_status` to poll. Honor the `polling_hint` interval in the response.
7. When the run reaches a terminal state, call `run_get_results` for a summary, then `run_get_node_result` for the full payload of any node that needs inspection.

### Resume a Failed Workflow

1. Call `run_latest_failed` with the workflow ID to get the failed run and its failed node IDs.
2. Call `workflow_run` with `resume_mode="single"` (just the first failed node) or `resume_mode="all-failed"` (every failed node), and pass `resume_source_run_id` from the failed run.
3. Poll with `run_get_status`, then summarize with `run_get_results`.

### Import from cURL

1. Call `import_curl` with the curl command string.
2. Review the returned nodes.
3. Call `workflow_create` with the nodes, then `workflow_run` to execute.

## Troubleshooting

- **If the stdio server prints nothing and the agent times out**, the `.env` file was not found. The `cwd` in the agent config must point at the `backend` directory, or `PYTHONPATH` must include it. Logs go to stderr, not stdout, so a missing `.env` will not crash the process.
- **If `tools/list` returns zero tools**, the registration call did not run before the server accepted the first request. Restart the agent, and confirm `MCP_ENABLED=true` in `.env`. For HTTP, restart the FastAPI process after editing `.env`.
- **If HTTP requests get a 401 response**, the `Authorization` header is missing or the key does not match `MCP_API_KEY`. Confirm the agent config has `Bearer YOUR_MCP_API_KEY` and that the backend has been restarted since the key was last changed.
- **If HTTP requests get a 403 response**, the `Origin` header is not in `MCP_ALLOWED_ORIGINS`. Add the agent's origin to the list and restart the backend, or set the origin to the exact URL the agent calls from.
- **If a tool call fails with a database error**, MongoDB is not running or `MONGODB_URL` is wrong. Verify the connection from the backend container, not just from your shell.
- **If a secret value appears in a tool response**, the value did not match the detection patterns. Open `secret_utils.py`, add the pattern that catches it, and reopen an issue. Do not paste the secret into a public channel.
- **If an import from a private URL fails with a network error**, the approval gate is blocking it. Either publish the spec through a public proxy, or add the host to `APPROVED_DOMAINS` and restart the backend.

## Related

- [Architecture](../reference/architecture.md) for where MCP fits in the request lifecycle.
- [Concepts](../getting-started/concepts.md) for the workflow, environment, run, and secret vocabulary used by the tool descriptions.
- [Webhooks](webhooks.md) for the human-triggered counterpart of the MCP `webhook_*` tools.
- [Environments and Secrets](environments-and-secrets.md) for how the persisted secret model that MCP redaction protects actually works.
