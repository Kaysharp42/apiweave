# MCP Integration

APIWeave includes an optional local Model Context Protocol (MCP) server. It lets
an AI agent on the same machine manage APIWeave structures and start local runs
without driving the renderer.

## Security Boundary

- The bridge is disabled until you enable it in the desktop app.
- It binds only to `127.0.0.1`; it is never exposed on a LAN or public address.
- Every request requires the per-install MCP access token.
- Browser-originated requests are accepted only from APIWeave or a loopback
  origin, protecting the local endpoint against DNS rebinding.
- The MCP surface is an explicit whitelist over the shared IPC handler registry.
  It is intentionally smaller than the renderer's complete IPC surface.
- Secret tools expose names, scopes, and resolution metadata only. They never
  return plaintext or ciphertext and do not allow secret mutation over MCP.
- Run tools return metadata-only projections. Request and response bodies,
  headers, cookies, URLs, variable values, assertion actual values, and raw
  errors remain available only in the local desktop UI.

Treat the MCP token like a password. Anyone who can read it while APIWeave is
running can call every whitelisted tool, including tools that create, update,
delete, import, or run local workflows.

## Transport

The desktop app exposes one MCP transport:

| Transport | Endpoint | Authentication |
| --- | --- | --- |
| Streamable HTTP | `http://127.0.0.1:<port>/mcp` | `Authorization: Bearer <token>` |

The bridge prefers port `47271`. If another process owns that port, APIWeave
selects a free loopback port and shows the live URL in the MCP panel. There is
no Python server, bundled stdio server, remote endpoint, webhook, or public
trigger.

The transport is hybrid. A sessionless (non-`initialize`) POST is served as a
stateless one-shot with a JSON response — the simple poll fallback for clients
that cannot hold a session. An `initialize` POST opens a retained,
bearer-authenticated session keyed by a server-issued `Mcp-Session-Id`: POST
carries client→server messages, GET opens the server→client SSE stream, and
DELETE tears the session down. Sessions are bounded (excess `initialize`
requests get `503`) and idle-evicted. Retained sessions can subscribe to the run
resource and receive `notifications/resources/updated`; the notification is a
change signal, so the client re-reads the resource for the new snapshot.

## Enable The Bridge

1. Start the APIWeave desktop app.
2. Open **Settings** or the **MCP** panel.
3. Enable the local MCP server.
4. Copy the live loopback URL and access token shown by the app.
5. Add them to the MCP client configuration.
6. Restart or reconnect the MCP client, then call `server_info`.

The token is generated on first enable and stored with the selected port in the
app's user-data directory as `mcp-token`. Re-enabling the bridge reuses that
token. Automatic and in-app token rotation are not currently implemented.

## Tool Discovery

Use MCP's standard `tools/list` request as the authoritative inventory. Every
tool includes:

- A description and JSON input schema.
- A JSON output schema and structured result, with text JSON as a compatibility
  fallback.
- Read-only, destructive, idempotent, and open-world annotations.

`runs_create` is marked open-world because it executes the workflow's outbound
HTTP requests on this machine. Other tools operate on local APIWeave data.

## Current Tool Inventory

### Server

- `server_info`

### Workspaces

- `workspaces_list`
- `workspaces_get`
- `workspaces_create`
- `workspaces_update`
- `workspaces_delete`

### Workflows

- `workflows_list`
- `workflows_get`
- `workflow_diagnose`
- `workflows_create`
- `workflows_update`
- `workflows_delete`
- `workflows_attachToCollection`
- `workflows_setEnvironment`

### Projects

- `projects_list`
- `projects_get`
- `projects_create`
- `projects_update`
- `projects_delete`
- `projects_addWorkflow`
- `projects_removeWorkflow`
- `projects_listWorkflows`
- `projects_export`
- `projects_dryRun`
- `projects_import`

### Environments

- `environments_list`
- `environments_get`
- `environments_create`
- `environments_update`
- `environments_delete`
- `environments_setVariable`
- `environments_deleteVariable`

### Assertions

- `assertion_suggest` (read) — derive deterministic assertion candidates from one HTTP node's stored run result without changing the workflow.
- `assertion_validate` (read) — canonicalize and validate assertion rules against the workflow graph and, optionally, run evidence; returns a safe preview.
- `assertion_apply` (write) — apply validated rules to one existing assertion node under a revision guard.

### Runs

- `runs_create`
- `runs_get`
- `runs_listByWorkflow`
- `runs_listByWorkspace`
- `runs_getLatest`
- `runs_getLatestFailed`
- `runs_cancel`

### Secret Metadata

- `secrets_list`
- `secrets_resolve`

Secret mutation handlers and Electron file/shell operations are deliberately
not exposed.

## Workflow Diagnosis

`workflow_diagnose` performs deterministic analysis without calling a model or
changing the workflow. Pass `workspaceId`, `workflowId`, and optionally a
specific `runId`. Without a run it reports static topology, reachability,
cycles, assertion sources and branches, extractor paths, and variable
provenance issues. With a run it also correlates HTTP status/transport failures,
extractor missing paths and traversal type mismatches, assertion reason codes,
truncated evidence, skipped nodes, and unresolved secret-reference metadata.

Findings are coded and sorted by severity. Their evidence includes structural
metadata such as node IDs, source/path/operator, status code, JSON type, and
match state. It never includes request or response payloads, headers, cookies,
URLs, variable values, assertion actual/expected values, secret values, or raw
error messages. A supplied run must belong to the requested workflow and
workspace; mismatches return `not_found`.

## Run Responses

Run tools return operational metadata suitable for an agent to monitor a run:

- Run, workspace, workflow, and selected-environment IDs.
- Current and terminal status.
- Start/completion timestamps and duration.
- Failed node IDs.
- Per-node status, HTTP status code, timing, and a `hasError` flag.
- Assertion outcome without the assertion message or actual value.
- Referenced secret names and safe resolved/scope metadata.
- Resume lineage and record revision.

Run responses intentionally omit raw request/response and variable content. Use
the desktop response inspector when those payloads are needed.

Run tools do not push updates themselves. A session client can subscribe to the
run resource for `notifications/resources/updated` change signals (see
Resources); otherwise, after calling `runs_create`, re-read `runs_get` until
`status` is one of `completed`, `failed`, `cancelled`, or `interrupted`. Keep
polling moderate; the bridge is local but does not apply a transport rate limit.

## Resources

The bridge ships one MCP resource template, discoverable via the standard
`resources/templates/list` request and readable via `resources/read`:

- `run-snapshot` — `apiweave://workspaces/{workspaceId}/runs/{runId}`

A read returns the same safe, metadata-only run snapshot the run tools return
(status, terminal flag, `latestSequence`, timings, and a per-node map of status,
HTTP status code, and duration). It never includes response bodies, headers,
cookies, request URLs, variable values, assertion actual values, or secret
values. Reads enforce workspace ownership; a run in another workspace returns
`not_found`.

**Subscriptions.** A retained session (opened by an `initialize` POST) can
`resources/subscribe` to a run URI and receive `notifications/resources/updated`
whenever that run advances. The notification carries no payload — re-read the
resource and compare `latestSequence` for the new snapshot. Notifications go
only to sessions subscribed to that exact run URI.

**Polling fallback:** clients that cannot subscribe — or cannot display
resources at all — should re-read the resource (or call `runs_get`) until
`terminal` is `true`. Keep polling moderate; the bridge is local but does not
apply a transport rate limit.

## Prompts

The bridge ships one MCP prompt, discoverable via the standard `prompts/list`
request and readable via `prompts/get`:

- `author_assertions` — steers the connected agent to turn a natural-language
  assertion request into canonical rules, validate and preview them, get the
  user's approval, then apply them under a revision guard.

APIWeave embeds no model. The prompt is pure instruction text: your agent does
the language-to-rules translation, and APIWeave only validates and persists the
result. All arguments (`workspaceId`, `workflowId`, `assertionNodeId`, `runId`)
are optional so the prompt is discoverable before any data exists; supplied
values are woven into the instruction text but no workspace or run data is
embedded until you pass them.

The prompt directs the agent through this flow:

1. Inspect with `workflows_get`, and (if a run exists) `runs_get`,
   `workflow_diagnose`, and `assertion_suggest`.
2. Translate the user's intent into canonical `{ source, path, operator,
   expectedValue? }` rules.
3. Call `assertion_validate` and show the returned preview and issues.
4. Ask the user to approve the previewed rules.
5. Call `assertion_apply` with `expectedRevision` from the workflow's current
   `rev`. A stale revision returns a conflict; re-read and retry.

### Example rule shapes

The agent produces these canonical rules from plain-language requests:

- **Status** — "it should return 200":
  `{ "source": "status", "path": "", "operator": "equals", "expectedValue": 200 }`
- **Body path** — "the response must include a token":
  `{ "source": "prev", "path": "response.body.token", "operator": "exists" }`
- **Header** — "the response should be JSON":
  `{ "source": "headers", "path": "content-type", "operator": "contains", "expectedValue": "application/json" }`
- **Count** — "there should be three items":
  `{ "source": "prev", "path": "response.body.items", "operator": "count", "expectedValue": 3 }`
- **Latency** — "it must respond within half a second":
  `{ "source": "prev", "path": "response.duration", "operator": "lte", "expectedValue": 500 }`

Secret-looking literals (tokens, passwords, API keys) are rejected in
`expectedValue`. To compare against a secret, use a `{{secrets.NAME}}`
reference. `assertion_apply` re-validates and enforces the revision guard
regardless of what the agent sends, so an agent that ignores the prompt still
cannot apply invalid or stale rules.

## Client Configuration

Always replace the example URL if the MCP panel shows a fallback port. Replace
`YOUR_MCP_TOKEN` locally and never commit the populated config.

### Claude Desktop

Claude Desktop can launch `mcp-remote` as a stdio adapter:

```json
{
  "mcpServers": {
    "apiweave": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://127.0.0.1:47271/mcp",
        "--header",
        "Authorization: Bearer YOUR_MCP_TOKEN"
      ]
    }
  }
}
```

### Cursor

```json
{
  "mcpServers": {
    "apiweave": {
      "url": "http://127.0.0.1:47271/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

### VS Code

Put this in `.vscode/mcp.json` or the user MCP configuration:

```json
{
  "servers": {
    "apiweave": {
      "type": "http",
      "url": "http://127.0.0.1:47271/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

### OpenCode

```json
{
  "mcp": {
    "apiweave": {
      "type": "http",
      "url": "http://127.0.0.1:47271/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

### Codex

Store the token in `APIWEAVE_MCP_TOKEN`, then add the server:

```bash
codex mcp add apiweave --url http://127.0.0.1:47271/mcp --bearer-token-env-var APIWEAVE_MCP_TOKEN
```

Checked-in templates are available under `mcp-configs/`.

## Agent Workflow Example

1. Call `server_info` to verify the bridge.
2. Call `workspaces_list`, then `workflows_list` with the selected workspace.
3. Call `environments_list` if the workflow needs a selected environment.
4. Call `runs_create` with `workspaceId`, `workflowId`, and optionally
   `selectedEnvironmentId`.
5. Re-read `runs_get` until the run is terminal.
6. Call `workflow_diagnose` with the terminal `runId` for coded, value-free
   findings and proposed remediations.
7. Summarize node status metadata. Ask the user to inspect the desktop response
   panel when diagnosis requires raw payload content.

## Troubleshooting

- **Connection refused:** APIWeave must be running and the MCP bridge must be
  enabled. Copy the current URL from the MCP panel instead of assuming `47271`.
- **401 Unauthorized:** The bearer token is missing or does not match the token
  shown by the app. Update the client configuration and reconnect.
- **403 Forbidden Origin:** A browser or proxy supplied a non-loopback Origin.
  Connect through a native MCP client or a local stdio-to-HTTP adapter.
- **Tool not found:** Use `tools/list`; old singular names such as
  `workflow_run` and `run_get_status` belonged to the removed backend.
- **No raw response body:** This is intentional. MCP run tools expose safe
  metadata; inspect the body in the desktop UI.
- **No resource updates:** Change notifications require a retained session
  (opened with `initialize`) and a `resources/subscribe` on the run URI. Clients
  that cannot subscribe should poll the run resource or `runs_get` until the run
  is terminal.

## Related

- [Architecture](../reference/architecture.md)
- [IPC API Reference](../reference/api.md)
- [Environments and Secrets](environments-and-secrets.md)
- [Variables and Extractors](variables-and-extractors.md)
