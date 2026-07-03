# MCP Integration

*APIWeave 2.0's Model Context Protocol (MCP) server, the bridge that lets AI coding agents drive workflows, projects, environments, secrets, service tokens, and audit through a single machine-to-machine protocol. Covers both supported transports, the rebuilt scoped tool surface, setup recipes for five major agents, and the scoped service token that every tool requires.*

## Prerequisites

- [Installation](../getting-started/installation.md) so the backend and MongoDB are running.
- [Concepts](../getting-started/concepts.md) for the vocabulary of workspaces, projects, environments, secrets, and service tokens.
- [Architecture](../reference/architecture.md) for the place MCP occupies in the system.
- A scoped service token. See [Service Tokens](../operations/service-tokens.md) once that doc lands, or create one in the workspace or organization settings.

## Table of Contents

- [What is MCP](#what-is-mcp)
- [Transports: stdio vs Streamable HTTP](#transports-stdio-vs-streamable-http)
- [Quick Start](#quick-start)
- [Scoped Service Tokens](#scoped-service-tokens)
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

APIWeave 2.0 runs an MCP server so agents such as Claude, Cursor, VS Code, opencode, and Codex can manage workflows, run them, read results, and import specifications without driving the browser. The server uses the official MCP Python SDK with FastMCP, and both transports call the same shared service layer, so behavior stays consistent with the REST API and the frontend.

Why expose MCP at all? Because agents that already understand API testing benefit from a structured surface that hides transport quirks, paginates results, scopes every call to an explicit org or workspace, and never echoes back a secret it should not have seen.

## Transports: stdio vs Streamable HTTP

APIWeave supports two MCP transports. Pick the one that matches where the agent runs.

| Transport | Use case | Authentication |
| --- | --- | --- |
| **stdio** | Local agents launched as subprocesses (Claude Desktop, Codex CLI) | None. Process boundary is the trust boundary. |
| **Streamable HTTP** | IDE extensions, remote agents, browser-based agents, any caller that can reach `/mcp` over HTTP | Scoped service token + Origin validation |

**stdio** is the simplest setup. The agent starts `python mcp_stdio.py` as a child process, talks to it over standard input and output, and the process exits when the agent quits. The Python process loads `.env` from the `backend` directory and then registers every tool before handling the first request.

**Streamable HTTP** mounts the MCP server at `/mcp` on the FastAPI app. Any HTTP-capable agent connects to `http://localhost:8000/mcp` (or your deployed URL), sends `Authorization: Bearer <scoped-service-token>`, and gets the same tools over JSON-RPC. This is the only choice for remote or multi-user deployments.

## Quick Start

Add the following settings to `backend/.env`, then restart the backend:

```env
# Enable the MCP server module
MCP_ENABLED=true

# Enable the Streamable HTTP transport (set to false for stdio-only)
MCP_HTTP_ENABLED=true

# Comma-separated origins allowed to call the HTTP transport
MCP_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

The bearer token for HTTP MCP is no longer a global `MCP_API_KEY`. Create a scoped service token in the workspace or organization settings, then paste the token into the agent's configuration.

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

## Scoped Service Tokens

Every MCP tool now requires a scoped service token. The token is bound to an organization or workspace, carries an explicit permission set, and can be revoked, rotated, or narrowed without reissuing unrelated tokens. The raw token value is shown once at creation time and never again.

Common token shapes:

| Scope | Typical permissions | Typical agent |
|-------|---------------------|----------------|
| Organization | `orgs.read`, `orgs.members.read`, `orgs.audit.read` | Read-only org administrator agent |
| Workspace (read) | `workflows.read`, `runs.read`, `audit.read` | Code-review helper that pulls run history |
| Workspace (read + run) | `workflows.read`, `runs.read`, `runs.write`, `audit.read` | CI helper that triggers a workflow on demand |
| Workspace (write) | `workflows.read`, `workflows.write`, `secrets.read.metadata`, `secrets.write`, `audit.read` | Provisioning agent that creates workflows and stores secrets |

A token's permissions are a hard list. There is no "wildcard" or "admin" permission that grants everything. If a tool needs a permission the token does not have, the call returns `403 Forbidden` with the missing permission in the response body.

The 1.0 flow that used a global `MCP_API_KEY` plus an `MCP_ALLOW_SECRET_WRITES` flag is gone. Secret writes require an explicit `secrets.write` permission on a scoped service token. There is no global toggle.

## Tool Inventory

The MCP server in 2.0 ships a rebuilt scoped tool surface. Every tool operates against an explicit scope (org, workspace, or environment) and accepts a scoped service token. Read and export tools redact persisted secrets at the response layer. Runtime secret input is removed. The full tool list is regenerated from the registered tools at every backend start; refer to the running server's `tools/list` for the authoritative count.

The tool groups are:

- **Server Info**: `server_info`.
- **Organizations**: list, get, create, update.
- **Teams**: list, get, create, update, delete, list members, add member, remove member, list permission grants, grant permission, revoke permission.
- **Org Members**: list, get, update role, remove.
- **Invites**: list, create, resend, cancel.
- **Outside Collaborators**: list, add, remove.
- **Workspaces**: list, get, create, update, list members.
- **Workflows**: list, get, create, update, add node, delete, export, import, import dry-run, run, resume, list runs, get run status, get run results, get run node result, cancel run.
- **Projects**: list, get, create, update, delete, list workflows, add workflow, remove workflow, reorder workflows, export, import, import dry-run, run.
- **Environments**: list, get, create, update, delete, list allowed workspaces, add allowed workspace, remove allowed workspace.
- **Environment Protection**: get, update, list approvals, approve, deny.
- **Secrets**: list (metadata only), get (metadata only), write (sealed box), rotate (sealed box), delete, get public key, list override flags.
- **Service Tokens**: list, get, create, rotate, narrow, revoke.
- **Webhooks**: list, get, create, update, delete, regenerate credentials, get logs.
- **Audit**: list events, export events.
- **Imports**: `import_openapi_url`, `import_openapi`, `import_openapi_dry_run`, `import_har`, `import_har_dry_run`, `import_curl`.

The complete per-tool schema is in the running server's `tools/list` response and the MCP tool inventory. Treat the per-tool signature as the source of truth; this list changes as the surface evolves.

## Setup for Major Agents

The configuration snippet for each agent follows. Replace `/path/to/apiweave/backend` with the absolute path to the `backend` directory on your machine, and replace `YOUR_SCOPED_SERVICE_TOKEN` with the value of a token you created in the workspace or organization settings. Use stdio for a local agent that can run subprocesses, and Streamable HTTP for anything else.

### Claude Desktop

Open Claude Desktop, go to **Settings -> Developer -> Edit Config**, and add the stdio entry:

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
        "Authorization": "Bearer YOUR_SCOPED_SERVICE_TOKEN"
      }
    }
  }
}
```

Restart Claude Desktop. The apiweave server appears in the tool picker with every tool that the token's permission set allows.

### Cursor

Open **Cursor -> Settings -> Features -> MCP**, click **Add new global MCP server**, and paste the same JSON shape used for Claude Desktop. Cursor supports both `command` (stdio) and `url` (HTTP) entries. The server name `apiweave` shows up under the tool menu once Cursor finishes loading.

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

For Streamable HTTP, switch the type to `http`, set `url` to your MCP endpoint, and add the `Authorization` header. opencode inherits the scoped service token from the environment, so a header template that reads `${env.APIWEAVE_MCP_TOKEN}` works as well.

### Codex

Codex uses TOML. The configuration file is `~/.codex/config.toml` (user) or `.codex/config.toml` (project). Add a server with the CLI:

```bash
# stdio
codex mcp add apiweave --cwd /path/to/apiweave/backend -- python mcp_stdio.py

# Streamable HTTP
codex mcp add apiweave --url http://localhost:8000/mcp --bearer-token-env-var APIWEAVE_MCP_TOKEN
```

Or write the file directly:

```toml
[mcp_servers.apiweave]
command = "python"
args = ["mcp_stdio.py"]
cwd = "/path/to/apiweave/backend"
enabled = true
```

The `APIWEAVE_MCP_TOKEN` environment variable holds your scoped service token. Optional `enabled_tools` and `disabled_tools` lists give you a per-agent allow or deny list. Use them to give read-only agents only the read tools.

## Streamable HTTP Authentication

The HTTP transport is machine-to-machine scoped service token authentication. It is intentionally separate from the human SSO session, CSRF cookies, and browser permissions used by the frontend. Do not use a service token as a user login, and do not put a service token in frontend code.

When `MCP_HTTP_ENABLED=true`:

- Every request to `/mcp` must carry `Authorization: Bearer <scoped-service-token>`.
- The `Origin` header is validated against the comma-separated list in `MCP_ALLOWED_ORIGINS`. A missing or unmatched origin returns 403.
- A request with no token, an unknown token, an expired token, or a revoked token returns 401.
- A request whose token does not have the permission for the called tool returns 403 with the missing permission in the response body.
- The `Host` header is checked against a trusted host list (DNS rebinding protection) that is derived automatically from `MCP_ALLOWED_ORIGINS` — each origin's hostname is accepted on any port. Override with `MCP_ALLOWED_HOSTS` only if the backend is served on a host that doesn't appear in the origin list.

Production deployments must set `MCP_ALLOWED_ORIGINS` to the exact origins the agent will call from, generate tokens with the narrowest permission set that still works, and rotate or revoke tokens on agent retirements.

## Secret Policy

MCP enforces strict secret handling at the service layer:

| Operation | Secret behavior |
| --- | --- |
| **Read tools** (`workflow_get`, environment list, project export, and similar) | Persisted secrets are redacted to `<SECRET>`. The metadata-only display shows name, scope, key id, and last update. |
| **Export tools** (`workflow_export`, `project_export`) | Secrets are not exported. The `.awecollection` v2 bundle carries references only. |
| **`workflow_run` and `project_run`** | The runner resolves secrets through the override chain at run time. The runtime does not accept a plaintext secret value, and the response does not echo back a stored value. |
| **Write tools** (`secrets_write`, `secrets_rotate`) | The payload must be a Libsodium sealed box encrypted against the scope's public key. The backend rejects plaintext or wrong-key ciphertext. |
| **Import tools** | Secret-like values in workflow or project content are sanitized during import. The destination workspace's secret references are created through the same sealed-box flow. |

Values matching patterns like `sk-`, `key_`, `secret`, `password`, `token`, and `api_key` are detected in tool responses and redacted. The detection logic lives in the secret detection service. If you see what looks like a real secret in an MCP response, treat it as a bug and add the pattern to the detector.

## MCP Import Security

MCP import tools inherit SSRF protection from the service layer. When `import_openapi_url` or `import_har` reaches out to fetch a spec, the request is routed through the same approval gate that the REST API uses.

- Private IP ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, IPv6 link-local, and similar) are blocked when `BLOCK_PRIVATE_NETWORKS=true` (the default).
- Hostnames must resolve to a public IP, or the host must appear in the `APPROVED_DOMAINS` list with `APPROVED_DOMAINS_ENABLED=true`.
- The redirect chain is followed, but each hop is re-checked against the approval gate.

If your agent needs to import a spec from an internal service, publish the spec through a public-facing proxy, or add the host to `APPROVED_DOMAINS` and restart the backend. The agent cannot override the gate from the MCP call.

## Agent Workflow Examples

These are end-to-end playbooks an agent can follow without further prompting. The numbers in parentheses are the MCP tool names.

### Create and Run a Workflow

1. Call `workspace_list` (or `server_info` to confirm the token scope) to verify the agent can see the right workspace.
2. Call `import_openapi_url` with the spec URL to discover endpoints.
3. Call `workflow_create` with the discovered nodes, edges, and variables.
4. Call `environment_list` to find the right environment for the run, or rely on the workspace's default environment.
5. Call `workflow_run` with the workflow id and the selected environment id. The run is bound to the calling token's actor for the audit log.
6. Call `run_get_status` to poll. Honor the `polling_hint` interval in the response.
7. When the run reaches a terminal state, call `run_get_results` for a summary, then `run_get_node_result` for the full payload of any node that needs inspection.

### Add a Node to an Existing Workflow

Use `workflow_add_node` for incremental edits instead of resending the whole graph through `workflow_update`. `workflow_update` replaces the entire `nodes`/`edges` arrays, so on a large workflow a single addition means re-transmitting everything (and risks wiping nodes you forgot to include).

1. Call `workflow_add_node` with the workflow id and the new `node` (`{nodeId, type, config, position, label}`).
2. Pass `after` (the predecessor nodeId) and/or `before` (the successor nodeId) to auto-wire the edges. If `after` and `before` are already directly connected, the new node is spliced between them and the old direct edge is removed (`splice=true`, the default).
3. For branching sources, pass `source_handle` (`"pass"` / `"fail"`) so the incoming edge leaves the correct handle of an assertion or condition node; use `edge_label` to label it.
4. The response is the full updated workflow detail, with secrets redacted like `workflow_get`.

### Provision a New Secret

1. Call `secrets_get_public_key` for the target scope (organization, workspace, or environment) to fetch the scope's public key.
2. Encrypt the secret value with a Libsodium sealed box in the agent runtime.
3. Call `secrets_write` with the scope id, the secret name, and the sealed-box ciphertext.
4. The response returns metadata only. The plaintext never appears in the response, in the audit log, or in any subsequent tool output.

### Resume a Failed Workflow

1. Call `run_latest_failed` with the workflow id to get the failed run and its failed node ids.
2. Call `workflow_run` with `resume_mode="single"` (just the first failed node) or `resume_mode="all-failed"` (every failed node), and pass `resume_source_run_id` from the failed run.
3. Poll with `run_get_status`, then summarize with `run_get_results`.

### Import from cURL

1. Call `import_curl` with the curl command string.
2. Review the returned nodes.
3. Call `workflow_create` with the nodes, then `workflow_run` to execute.

## Troubleshooting

- **If the stdio server prints nothing and the agent times out**, the `.env` file was not found. The `cwd` in the agent config must point at the `backend` directory, or `PYTHONPATH` must include it. Logs go to stderr, not stdout, so a missing `.env` will not crash the process.
- **If `tools/list` returns zero tools**, the registration call did not run before the server accepted the first request. Restart the agent, and confirm `MCP_ENABLED=true` in `.env`. For HTTP, restart the FastAPI process after editing `.env`.
- **If HTTP requests get a 401 response**, the bearer token is missing, expired, or revoked. Confirm the agent config has `Bearer YOUR_SCOPED_SERVICE_TOKEN` and that the token is current in the workspace or organization settings.
- **If HTTP requests get a 403 response**, the `Origin` header is not in `MCP_ALLOWED_ORIGINS`, or the token does not have the required permission. Add the agent's origin to the list and restart the backend, or narrow the token's permission set to the tools the agent actually needs.
- **If a secret write returns 422 with a key-mismatch error**, the scope's public key rotated between the call to `secrets_get_public_key` and the call to `secrets_write`. Refetch the public key and retry. The error response carries the new public key for an automatic retry.
- **If a tool call fails with a database error**, MongoDB is not running or `MONGODB_URL` is wrong. Verify the connection from the backend container, not just from your shell.
- **If a secret value appears in a tool response**, the value did not match the detection patterns. Open `secret_utils.py`, add the pattern that catches it, and reopen an issue. Do not paste the secret into a public channel.
- **If an import from a private URL fails with a network error**, the approval gate is blocking it. Either publish the spec through a public proxy, or add the host to `APPROVED_DOMAINS` and restart the backend.

## Related

- [Architecture](../reference/architecture.md) for where MCP fits in the request lifecycle.
- [Concepts](../getting-started/concepts.md) for the workspace, project, environment, secret, and service token vocabulary used by the tool descriptions.
- [Webhooks](webhooks.md) for the human-triggered counterpart of the MCP `webhook_*` tools.
- [Environments and Secrets](environments-and-secrets.md) for how the persisted secret model that MCP redaction protects actually works.
- [Audit Log](../operations/audit.md) for the events that every MCP tool writes.
