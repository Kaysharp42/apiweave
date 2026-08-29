# MCP Integration

APIWeave includes an optional local Model Context Protocol (MCP) server. It lets
an AI agent on the same machine manage APIWeave structures and start local runs
without driving the renderer. Writes and runs it makes are reflected live in the
desktop UI — see [Runs in the Desktop UI](#runs-in-the-desktop-ui) and
[Writes in the Desktop UI](#writes-in-the-desktop-ui).

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
- Run tools return metadata-only projections: request and response bodies,
  headers, cookies, URLs, variable values, and assertion actual values stay in
  the local desktop UI. The one exception is `runs_getNodeResult`, which returns
  one node's stored request/response — including its body — after the same
  blanket secret-redaction pass every MCP read gets, so secret-looking values
  are withheld there too.

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

The bridge speaks MCP protocol version `2025-06-18` (negotiated by the SDK).

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

## Authoring Guides

The conventions an agent needs to build a working graph — node and edge shapes,
the `pass`/`fail` handles an assertion's outgoing edges require, placeholder
syntax, assertion path rules per source, and the diagnostic codes — are served as
readable resources. A plain `resources/list` returns all of them, and
`server_info` repeats their URIs for clients that do not read resources:

| URI | Covers |
| --- | --- |
| `apiweave://guide/start-here` | The order of operations that finds mistakes statically instead of with live requests, and a minimal working graph |
| `apiweave://guide/workflow-authoring` | Every node type with its config shape, edge handles, and changing a graph without resending it |
| `apiweave://guide/placeholders` | `{{env.x}}`, `{{variables.x}}`, `{{prev.x}}`, `{{secrets.x}}`, and extractor paths |
| `apiweave://guide/assertions` | What `path` means for each source, operator rules, and the suggest/validate/apply flow |
| `apiweave://guide/diagnostics` | Every `workflow_diagnose` code and how to fix it |
| `apiweave://guide/redaction` | What reads withhold, and why `<SECRET>` must never be written back |

These ship inside the desktop bundle rather than being read from `docs/`, which
is not packaged. This page stays the human-facing reference; the guides are the
agent-facing one.

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
- `workflows_patch`
- `workflows_delete`
- `workflows_attachToCollection`
- `workflows_setEnvironment`

`workflows_update` replaces the `nodes`, `edges` and `variables` lists wholesale.
`workflows_patch` changes a subset instead: `upsertNodes` and `upsertEdges`
replace matching entries by id and append the rest, `removeNodeIds` and
`removeEdgeIds` delete by id (edges attached to a removed node go with it), and
`setVariables`/`unsetVariables` merge into the stored map. Passing
`expectedRevision` makes the write a compare-and-swap against the revision the
caller last read, so a concurrent desktop edit produces a conflict rather than
being overwritten.

`workflows_create`, `workflows_update` and `workflows_patch` each return
`{ result, diagnosis }`, where `diagnosis` is the same report `workflow_diagnose`
produces for the workflow just written. The analysis is static and sends no HTTP,
so a graph mistake — a missing assertion edge handle, an assertion path that
cannot address a value — is visible in the write's own response instead of
requiring a live run to discover.

Each of the three also accepts a `return` echo-shape parameter —
`"diagnosis"` (the default), `"summary"`, or `"full"` — to control how much of
the written workflow comes back in the response, for clients on a token budget.

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

`environments_create` and `environments_update` accept `baseEnvironmentId`, the
environment this one inherits plain variables from; `null` clears it. See
[Reuse Primitives for Agents](#reuse-primitives-for-agents).

### Node Presets

- `nodePresets_list`
- `nodePresets_create`
- `nodePresets_update`
- `nodePresets_delete`

### Assertions

- `assertion_suggest` (read) — derive deterministic assertion candidates from one HTTP node's stored run result without changing the workflow.
- `assertion_validate` (read) — canonicalize and validate assertion rules against the workflow graph and, optionally, run evidence; returns a safe preview.
- `assertion_apply` (write) — apply validated rules to one existing assertion node under a revision guard.

### Runs

- `runs_create`
- `runs_get`
- `runs_getNodeResult`
- `runs_listByWorkflow`
- `runs_listByWorkspace`
- `runs_getLatest`
- `runs_getLatestFailed`
- `runs_cancel`

`runs_getNodeResult` is the exception to the metadata-only rule: it returns one
node's stored request and response from a run, body included, after the same
secret-redaction pass every MCP read gets. Use it to inspect a single node's
payload without leaving the agent; secret-shaped values still come back
withheld.

### Secret Metadata

- `secrets_list`
- `secrets_resolve`

Secret mutation handlers and Electron file/shell operations are deliberately
not exposed.

## Reuse Primitives for Agents

Three reuse features are reachable over MCP. Each has one caveat an agent should
know before it writes anything.

### Sub-workflows (the `workflow` node)

`workflows_create` and `workflows_update` accept a node of `type: "workflow"`
that runs another workflow in the same workspace as one step:

```json
{
  "nodeId": "call-auth",
  "type": "workflow",
  "position": { "x": 120, "y": 0 },
  "config": {
    "targetWorkflowId": "wf_abc123",
    "inputMapping": { "tenant": "{{variables.tenantId}}" },
    "outputMapping": { "authToken": "accessToken" }
  }
}
```

`inputMapping` is `target variable = caller expression`; `outputMapping` is
`caller variable = sub-workflow variable`. A target outside the workspace, or
the calling workflow itself, is rejected on write. An indirect cycle is not
rejected on write — the runner caps nesting at 8 levels and fails the node
instead. A `{{secrets.NAME}}` on the right-hand side of an input mapping fails
the node by design; the sub-workflow resolves secrets itself.

The sub-workflow runs inside the caller's run, so there is no second run to
poll: `runs_get` reports the calling node's status, and the run tools never
expose a child run id because none exists.

**Reading a mapping back is lossy.** The redaction pass that protects MCP reads
works on key names anywhere in a config, so a mapping entry whose *variable
name* looks secret-ish — `token`, `apiKey`, `password`, `secret` — comes back as
`<SECRET>` from `workflows_get` even though the mapping itself is not a secret.
The stored workflow is unaffected; only the MCP read is redacted. Write the
mapping you intend rather than round-tripping one you read: the write tools
reject a stored `<SECRET>` outright, naming the offending paths, so a
read-modify-write cycle fails loudly instead of replacing a working credential
with a literal placeholder.

**`workflow_diagnose` does not analyze these nodes.** It reports topology,
reachability, cycles, assertion and extractor findings for HTTP and assertion
nodes; a Call Workflow node with an unset or dangling `targetWorkflowId` will
not appear in its findings. Read the node's `config` from `workflows_get` to
check a target yourself.

### Environment inheritance

Set `baseEnvironmentId` on create or update to inherit plain variables from
another environment in the same workspace; `environments_get` reports the link.
The effective set an agent should reason about is the whole chain merged from
the root down, with each descendant overriding the names it redefines — the
tools return each environment's *own* variables, not the resolved set, so
resolve the chain yourself if you need the effective values. Secrets are not
inherited, self-reference and cycles are rejected, and chains are followed at
most 8 levels deep. See [Environment Inheritance](environments-and-secrets.md#environment-inheritance).

### Node presets

`nodePresets_*` manages the workspace's library of saved node configurations.
Reads pass through the same redaction every MCP read gets: a preset's name, node
type, ids and structure come back intact, with credential values reported as
`<SECRET>`. An agent can therefore catalogue the library, create presets from
configuration it wrote itself, and rename or delete them — but it cannot
faithfully copy a preset whose values were withheld, because it never receives
those literals. Applying a preset to a canvas stays a desktop action. See
[Node Presets](node-presets.md).

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

Run responses intentionally omit raw request/response and variable content —
except `runs_getNodeResult`, which returns one node's stored request/response
under the standard secret-redaction pass. Use the desktop response inspector
when full payloads for other nodes are needed.

Run tools do not push updates themselves. A session client can subscribe to the
run resource for `notifications/resources/updated` change signals (see
Resources); otherwise, after calling `runs_create`, re-read `runs_get` until
`status` is one of `completed`, `failed`, `cancelled`, or `interrupted`. Keep
polling moderate; the bridge is local but does not apply a transport rate limit.

## Runs in the Desktop UI

A run an agent starts with `runs_create` is shown in the desktop app the same
way one started from the Run button: nodes light up as they execute, edge
traversals are paced, and the run camera follows the executing front. The agent
does nothing to arrange this and cannot opt out of it.

Every run is announced to the renderer on an unkeyed `apiweave:run-started`
channel carrying the run's workspace and workflow ids. The canvas showing that
workflow adopts the run and streams its progress; a canvas that opens a workflow
whose run is already in flight picks it up on mount, so nodes that finished
before it opened are painted at the end of the run rather than live.

If the workflow is not the one on screen, the app raises a notice naming it with
a way to open it — it never switches the user's canvas on its own. A run of a
workflow in a workspace other than the current one is not announced.

## Writes in the Desktop UI

Every successful write tool is announced to the renderer on an unkeyed
`apiweave:agent-write` channel carrying `{domain, action}` and the `workspaceId`
the call named, if it named one. The renderer answers by refetching — the same
fetches it runs when the window regains focus — so the surfaces that show the
written data catch up without the user touching anything:

| Domain | What refreshes |
| --- | --- |
| `workspaces` | The workspace list and switcher. Deleting the workspace the user is *in* also sends the app to `/app`, which re-picks one that still exists. |
| `workflows`, `assertions` | The sidebar's workflow list (the open canvas is already covered by `apiweave:workflow-changed`) and an open project page. |
| `projects` | The sidebar's projects and collections lists, and an open project page. |
| `environments` | The environment store the run-time picker reads, and the workspace environments page. |
| `nodePresets` | The preset store the Add Nodes palette reads. |

The event is deliberately coarse: it names a domain, not a row. These stores hold
whole lists loaded by `useEffect` rather than a query cache, so a row would be
data the renderer throws away, and an occasional refetch it did not strictly
need is cheaper than the bookkeeping to prove it. A burst of writes is coalesced
into one refetch per surface.

Only MCP writes are published. The renderer's own writes already update its
stores, and announcing those would fight its optimistic updates.

`secrets` is absent because MCP has no secret write tools, and run history is
covered by the run channel above.

## Resources

The bridge ships two kinds of resource, both readable via `resources/read`:

- The authoring guides at `apiweave://guide/<topic>`, registered as concrete
  resources so a plain `resources/list` enumerates them. See
  [Authoring Guides](#authoring-guides).
- `run-snapshot` — `apiweave://workspaces/{workspaceId}/runs/{runId}`, a
  template discoverable via `resources/templates/list` (every run cannot be
  enumerated without a workspace, so it is not listed as a concrete resource).

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

Checked-in templates are available under `mcp-configs/` for Claude Desktop,
Cursor, VS Code, and OpenCode. Codex uses the CLI command above.

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
- **No raw response body:** Run tools other than `runs_getNodeResult` expose
  safe metadata only. Inspect a full body in the desktop UI, or call
  `runs_getNodeResult` for one node's stored request/response (secret-shaped
  values still come back redacted).
- **A config value comes back as `<SECRET>`:** Intentional — the structure is
  intact, the credential value is withheld. It is why an agent cannot re-apply
  an existing preset; drag it onto the canvas in the desktop app instead.
- **A write is rejected for containing `<SECRET>`:** The payload carries a value
  from a redacted read. Send the real value, a `{{secrets.NAME}}` reference, or
  omit the field — with `workflows_patch` you can usually omit it, since a patch
  only touches the nodes it names.
- **A Call Workflow node is missing from `workflow_diagnose`:** The analyzer
  covers HTTP and assertion nodes. Check `targetWorkflowId` on the node config
  from `workflows_get`.
- **No resource updates:** Change notifications require a retained session
  (opened with `initialize`) and a `resources/subscribe` on the run URI. Clients
  that cannot subscribe should poll the run resource or `runs_get` until the run
  is terminal.

## Related

- [Architecture](../reference/architecture.md)
- [IPC API Reference](../reference/api.md)
- [Environments and Secrets](environments-and-secrets.md)
- [Node Presets](node-presets.md)
- [Workflows and Nodes](workflows-and-nodes.md)
- [Variables and Extractors](variables-and-extractors.md)
