# MCP Integration

*APIWeave's local Model Context Protocol (MCP) server: the loopback HTTP bridge that lets AI coding agents on the same machine drive workflows, projects, environments, secrets, and runs through a single machine-to-machine protocol. Covers the bridge setup, the per-install static token, the tool surface, and setup recipes for five major agents.*

## Prerequisites

- [Installation](../getting-started/installation.md) so the desktop app is running.
- [Concepts](../getting-started/concepts.md) for the vocabulary of projects, workflows, environments, secrets, and runs.
- [Architecture](../reference/architecture.md) for the place MCP occupies in the system.
- The MCP bridge is opt-in. Enable it in **Settings → Enable MCP bridge**. The bridge binds to `127.0.0.1` and listens on a port chosen by the app. The **MCP** panel in the app shows the URL and the static token; the same token is written to a file in the user data directory so agents can pick it up automatically.

## Table of Contents

- [What is MCP](#what-is-mcp)
- [Loopback HTTP Transport](#loopback-http-transport)
- [Quick Start](#quick-start)
- [Per-Install Static Token](#per-install-static-token)
- [Tool Inventory](#tool-inventory)
- [Setup for Major Agents](#setup-for-major-agents)
  - [Claude Desktop](#claude-desktop)
  - [Cursor](#cursor)
  - [VS Code](#vs-code)
  - [opencode](#opencode)
  - [Codex](#codex)
- [Secret Policy](#secret-policy)
- [Agent Workflow Examples](#agent-workflow-examples)
- [Troubleshooting](#troubleshooting)

## What is MCP

The Model Context Protocol (MCP) is an open standard for connecting AI agents to the tools and data of an application. The agent speaks the protocol, and the application exposes its capabilities as a set of named **tools** (actions), **resources** (read-only context), and **prompts** (guided templates).

The desktop app runs an MCP server so agents such as Claude, Cursor, VS Code, opencode, and Codex can manage workflows, run them, read results, and import specifications without driving the browser. The server is bound to `127.0.0.1` only; nothing is exposed to the network. The server uses the official MCP TypeScript SDK and calls the same IPC handler registry that the renderer uses, so behavior is consistent with the app's UI.

Why expose MCP at all? Because agents that already understand API testing benefit from a structured surface that hides transport quirks, paginates results, and never echoes back a secret it should not have seen.

## Loopback HTTP Transport

The desktop app exposes a single MCP transport: **loopback HTTP** on `127.0.0.1`. There is no `stdio` transport in the desktop app and no Streamable HTTP across the network. The desktop app has no exposed network surface by default.

| Transport | Use case | Authentication |
| --- | --- | --- |
| **Loopback HTTP** | Local AI agents on the same machine | Static per-install token in `Authorization: Bearer …` |

The bridge is opt-in. Until you enable it in **Settings**, nothing is listening on any port. The app picks a free loopback port on first enable; the **MCP** panel in the app shows the URL and the static token, and the same token is written to the user data directory for tools that prefer to read it.

## Quick Start

1. Open the desktop app.
2. Open **Settings** and toggle **Enable MCP bridge**.
3. Open the **MCP** panel. Note the URL (`http://127.0.0.1:<port>/mcp`) and the static token.
4. Point your local agent at the URL with the token in the `Authorization` header.

That's it. The tool list the agent sees is the same set the app exposes to itself. There is no separate "admin" tool list; what the app can do, the agent can do.

## Per-Install Static Token

The MCP bridge authenticates with a static per-install token. The token is generated when the bridge is first enabled and stored in a file in the user data directory (`mcp.token` on most platforms; the app shows the exact path in the **MCP** panel). The token is not rotated automatically. To rotate, click **Rotate token** in the **MCP** panel; the old token stops working immediately and the new token is written to disk.

There is no per-agent permission model. The desktop app has a single local user. Anyone on the same machine who can read the token file can drive the app. Treat the token like a private key: keep the file readable only by your user account, and rotate it if you suspect it leaked.

## Tool Inventory

The MCP server exposes the same set of operations the renderer's IPC channel exposes. Tools are grouped by resource:

- **Server info**: `server_info`.
- **Workflows**: list, get, create, update, add node, delete, export, import, import dry-run, run, resume, list runs, get run status, get run results, get run node result, cancel run.
- **Projects**: list, get, create, update, delete, list workflows, add workflow, remove workflow, reorder workflows, export, import, import dry-run, run.
- **Environments**: list, get, create, update, delete.
- **Secrets**: list (metadata only), get (metadata only), write (sealed box), rotate (sealed box), delete, get public key.
- **Runs**: get status, get results, get node result, list, cancel, latest failed.

The complete per-tool schema is in the running server's `tools/list` response. Treat the per-tool signature as the source of truth; this list changes as the surface evolves.

## Setup for Major Agents

The configuration snippet for each agent follows. Replace `http://127.0.0.1:<port>/mcp` with the URL the **MCP** panel shows, and replace `YOUR_MCP_TOKEN` with the per-install token from the same panel.

### Claude Desktop

Open Claude Desktop, go to **Settings → Developer → Edit Config**, and add the URL entry:

```json
{
  "mcpServers": {
    "apiweave": {
      "url": "http://127.0.0.1:<port>/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

Restart Claude Desktop. The `apiweave` server appears in the tool picker with every tool the app exposes.

### Cursor

Open **Cursor → Settings → Features → MCP**, click **Add new global MCP server**, and paste the same JSON shape used for Claude Desktop. Cursor supports URL entries. The server name `apiweave` shows up under the tool menu once Cursor finishes loading.

### VS Code

Create `.vscode/mcp.json` in your workspace root:

```json
{
  "servers": {
    "apiweave": {
      "type": "http",
      "url": "http://127.0.0.1:<port>/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

The GitHub Copilot Chat extension in VS Code reads the same file. If you do not want a workspace file, put the configuration in your user MCP store.

### opencode

Add the following block to `opencode.json` or `opencode.jsonc` at the project root:

```json
{
  "mcp": {
    "apiweave": {
      "type": "http",
      "url": "http://127.0.0.1:<port>/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

opencode also supports reading the token from an environment variable through a header template like `${env.APIWEAVE_MCP_TOKEN}`.

### Codex

Codex uses TOML. The configuration file is `~/.codex/config.toml` (user) or `.codex/config.toml` (project). Add a server with the CLI:

```bash
codex mcp add apiweave --url http://127.0.0.1:<port>/mcp --bearer-token-env-var APIWEAVE_MCP_TOKEN
```

Or write the file directly:

```toml
[mcp_servers.apiweave]
url = "http://127.0.0.1:<port>/mcp"
bearer_token_env_var = "APIWEAVE_MCP_TOKEN"
enabled = true
```

The `APIWEAVE_MCP_TOKEN` environment variable holds your per-install token. Optional `enabled_tools` and `disabled_tools` lists give you a per-agent allow or deny list.

## Secret Policy

The MCP bridge enforces the same secret handling the rest of the app enforces:

| Operation | Secret behavior |
| --- | --- |
| **Read tools** (`workflow_get`, environment list, project export, and similar) | Persisted secrets are redacted to `<SECRET>`. The metadata-only display shows name, scope, key id, and last update. |
| **Export tools** (`workflow_export`, `project_export`) | Secrets are not exported. The `.awecollection` bundle carries references only. |
| **`workflow_run` and `project_run`** | The runner resolves secrets through the local scope chain at run time. The runtime does not accept a plaintext secret value, and the response does not echo back a stored value. |
| **Write tools** (`secrets_write`, `secrets_rotate`) | The payload must be a Libsodium sealed box encrypted against the scope's public key. The main process rejects plaintext or wrong-key ciphertext. |
| **Import tools** | Secret-like values in workflow or project content are sanitized during import. The destination environment's secret references are created through the same sealed-box flow. |

Values matching patterns like `sk-`, `key_`, `secret`, `password`, `token`, and `api_key` are detected in tool responses and redacted. The detection logic lives in the secret detection service. If you see what looks like a real secret in an MCP response, treat it as a bug and add the pattern to the detector.

## Agent Workflow Examples

These are end-to-end playbooks an agent can follow without further prompting. The numbers in parentheses are the MCP tool names.

### Create and Run a Workflow

1. Call `server_info` to confirm the bridge is reachable and the token is accepted.
2. Call `workflow_list` to see the existing workflows.
3. Call `import_openapi_url` with the spec URL to discover endpoints.
4. Call `workflow_create` with the discovered nodes, edges, and variables.
5. Call `environment_list` to find the right environment for the run, or rely on the default.
6. Call `workflow_run` with the workflow id and the selected environment id.
7. Call `run_get_status` to poll. Honor the polling hint interval in the response.
8. When the run reaches a terminal state, call `run_get_results` for a summary, then `run_get_node_result` for the full payload of any node that needs inspection.

### Add a Node to an Existing Workflow

Use `workflow_add_node` for incremental edits instead of resending the whole graph through `workflow_update`. `workflow_update` replaces the entire `nodes`/`edges` arrays, so on a large workflow a single addition means re-transmitting everything (and risks wiping nodes you forgot to include).

1. Call `workflow_add_node` with the workflow id and the new `node` (`{nodeId, type, config, position, label}`).
2. Pass `after` (the predecessor nodeId) and/or `before` (the successor nodeId) to auto-wire the edges. If `after` and `before` are already directly connected, the new node is spliced between them and the old direct edge is removed (`splice=true`, the default).
3. For branching sources, pass `source_handle` (`"pass"` / `"fail"`) so the incoming edge leaves the correct handle of an assertion or condition node; use `edge_label` to label it.
4. The response is the full updated workflow detail, with secrets redacted like `workflow_get`.

### Provision a New Secret

1. Call `secrets_get_public_key` for the target scope (workspace or environment) to fetch the scope's public key.
2. Encrypt the secret value with a Libsodium sealed box in the agent runtime.
3. Call `secrets_write` with the scope id, the secret name, and the sealed-box ciphertext.
4. The response returns metadata only. The plaintext never appears in the response or in any subsequent tool output.

### Resume a Failed Workflow

1. Call `run_latest_failed` with the workflow id to get the failed run and its failed node ids.
2. Call `workflow_run` with `resume_mode="single"` (just the first failed node) or `resume_mode="all-failed"` (every failed node), and pass `resume_source_run_id` from the failed run.
3. Poll with `run_get_status`, then summarize with `run_get_results`.

### Import from cURL

1. Call `import_curl` with the curl command string.
2. Review the returned nodes.
3. Call `workflow_create` with the nodes, then `workflow_run` to execute.

## Troubleshooting

- **If the agent cannot reach the bridge**, confirm the desktop app is running, the bridge is enabled in **Settings**, and the URL matches the one shown in the **MCP** panel. The app must be running for the bridge to be reachable.
- **If HTTP requests get a 401 response**, the bearer token is missing or rotated. Open the **MCP** panel, copy the current token, and update the agent config. If the token file on disk is out of sync, click **Rotate token** in the panel to issue a fresh one.
- **If `tools/list` returns zero tools**, the bridge is enabled but no IPC handlers are registered. Restart the desktop app. If the issue persists, the app may be running an old build; reinstall.
- **If a secret write returns a key-mismatch error**, the scope's public key rotated between the call to `secrets_get_public_key` and the call to `secrets_write`. Refetch the public key and retry.
- **If a tool call fails with a database error**, the SQLite database is locked by another process. Quit any other instance of the app, or use a tool that opens the database read-only.
- **If a secret value appears in a tool response**, the value did not match the detection patterns. Open `secret_utils.ts`, add the pattern that catches it, and reopen an issue. Do not paste the secret into a public channel.
- **If an import from a private URL fails with a network error**, the runner's SSRF block rejected the target. Use a public spec URL, or set up an environment variable in the desktop app to allow the host.

## Related

- [Architecture](../reference/architecture.md) for where MCP fits in the request lifecycle.
- [Concepts](../getting-started/concepts.md) for the project, environment, secret, and run vocabulary used by the tool descriptions.
- [Environments and Secrets](environments-and-secrets.md) for how the persisted secret model that MCP redaction protects actually works.
