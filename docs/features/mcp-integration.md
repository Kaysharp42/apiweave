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
- Requests must name the server by its own address: a `Host` header other than
  `127.0.0.1:<port>` or `localhost:<port>` is refused, and browser-originated
  requests are accepted only from APIWeave or a loopback origin. Together these
  protect the local endpoint against DNS rebinding.
- The MCP surface is an explicit whitelist over the shared IPC handler registry.
  It is intentionally smaller than the renderer's complete IPC surface.
- Secret tools expose names, scopes, and resolution metadata only. They never
  return plaintext or ciphertext and do not allow secret mutation over MCP.
- A run an agent starts that would send stored secrets does not proceed until
  you approve it. APIWeave shows a native dialog naming the agent (as it
  reports itself), the workflow, each secret, and where the requests go —
  the host when the URL is known before the run, the URL as written when it is
  built during the run. **Allow once** lets that one run continue; **Allow for
  this session** and **Never ask again** also answer for later runs of the same
  workflow from the same agent — in memory until the app restarts, and
  persisted across restarts, respectively — and both ask again the moment the
  secrets, destinations or scripts change. Remembered answers are listed, with
  a revoke action, under Settings > MCP Server. That page also has a persistent
  **Skip secret approval for agent runs** switch — off by default — which removes
  the question for every client at once; the destination and script limits
  still apply to each allowed run. **Deny**, or no answer within
  two minutes, fails the run before any request is sent, and the agent sees
  `deniedByUser: true`. The run executes the workflows as they were
  when you were asked: an edit made while the dialog is open does not change
  where an approved secret goes. An allowed run may only reach the hosts the
  dialog listed: a request whose host turns out different when it is sent —
  a URL shown as written, a variable an extractor or script rewrote, a
  redirect — fails instead. Runs you start yourself, and agent runs that
  use no secret, are not affected. A secret a [script](scripting.md) reads
  with `aw.secrets.get("NAME")` counts, and when the workflow runs scripts the
  dialog says so: a pre-request script can change a request, though not send
  it to a host the dialog did not list.
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

The desktop app serves MCP over loopback HTTP, and ships a stdio launcher that
agents run to reach it:

| Transport | Endpoint | Authentication |
| --- | --- | --- |
| Streamable HTTP | `http://127.0.0.1:<port>/mcp` | `Authorization: Bearer <token>` |
| stdio launcher | `node <user data>/apiweave-mcp.cjs` | Reads the token from the user-data folder it sits in |

The bridge prefers port `47271`. If another process owns that port, APIWeave
selects a free loopback port and shows the live URL on the **MCP Server**
settings page. There is no Python server, remote endpoint, webhook, or public
trigger.

### The stdio launcher

An MCP client connects to its servers once, when it starts, and marks one that
does not answer as failed until you reconnect it by hand. With a direct HTTP
config, that is what happens whenever the agent starts before APIWeave does.
The launcher removes that ordering: the agent starts it, so it is always there.

- **It answers at once.** The handshake and the tool, resource and prompt lists
  come from `mcp-catalog.json`, which the app writes each time its MCP server
  starts, so the agent never waits for the app to start.
- **It starts APIWeave when needed.** If the app's server is not reachable, the
  launcher starts APIWeave with `--hidden`, in the tray with no window, and
  waits up to 30 seconds for it. A tool call made meanwhile waits for it. If
  APIWeave is already running, the hidden launch does not bring its window
  forward.
- **Everything else goes to the app unchanged.** Tool calls, resource reads,
  subscriptions and notifications travel over the same loopback HTTP and token
  as any other client. The app sees the agent's own name, which is the name
  secret approvals show. The launcher reads no APIWeave data itself.
- **It reconnects.** A session the app closed, because it was idle or because
  APIWeave restarted, is reopened on the next request, along with the agent's
  resource subscriptions. A read is retried on the new session. A write is not
  retried when the connection broke during it, because it may already have run:
  the agent is told to check first.
- **It needs Node.js 20 or newer** on the `PATH` the agent runs with. It is a
  single bundled script with no dependencies to install.

The app copies `apiweave-mcp.cjs` into its user-data folder on every launch,
next to `mcp-token`, `mcp-catalog.json` and `mcp-launch.json`, which records
how to start the app. The user-data folder is a fixed place, unlike an AppImage's
temporary mount or an install folder an update replaces:

| Platform | Launcher path |
| --- | --- |
| Windows | `%APPDATA%\APIWeave\apiweave-mcp.cjs` |
| macOS | `~/Library/Application Support/APIWeave/apiweave-mcp.cjs` |
| Linux | `~/.config/APIWeave/apiweave-mcp.cjs` (under `$XDG_CONFIG_HOME` when set) |

Most clients expand neither `~` nor `%APPDATA%`, so copy the exact path from
**Settings → MCP Server**. APIWeave must have been opened once with the MCP server
on, so that the launcher, the token and the catalog exist. Turning the server off
in Settings still wins. The launcher never turns it back on: after 30 seconds it
tells the agent to turn it on in Settings.

The transport is hybrid. A sessionless (non-`initialize`) POST is served as a
stateless one-shot with a JSON response — the simple poll fallback for clients
that cannot hold a session. An `initialize` POST opens a retained,
bearer-authenticated session keyed by a server-issued `Mcp-Session-Id`: POST
carries client→server messages, GET opens the server→client SSE stream, and
DELETE tears the session down. Sessions are bounded (excess `initialize`
requests get `503`) and idle-evicted. Retained sessions can subscribe to the run
resource and receive `notifications/resources/updated`; the notification is a
change signal, so the client re-reads the resource for the new snapshot.

The protocol version is negotiated by the official MCP TypeScript SDK the bridge
is built on: the client proposes a version in `initialize`, and the bridge
answers with that version when the SDK supports it, or with the newest one the
SDK supports otherwise.

## Enable The Bridge

1. Start the APIWeave desktop app.
2. Open **Settings → MCP Server**.
3. Enable the local MCP server.
4. Under **Connect your agents**, click **Connect** for each MCP client you use
   (see [Connect Your Agents](#connect-your-agents)). Alternatively, copy a
   config by hand: the launcher config, or the direct HTTP one with the live URL
   and token.
5. For a client not in the list, add the config yourself (see
   [Client Configuration](#client-configuration)).
6. Restart or reconnect the MCP client, then call `server_info`.

The token is generated on first enable and stored with the selected port in the
app's user-data directory as `mcp-token`. Re-enabling the bridge reuses that
token. If it may have leaked, choose **Regenerate token** in the MCP settings:
the old token stops working at once, open MCP sessions are closed, and every
client — including agents launched from APIWeave before the change — has to be
given the new one.

## Authoring Guides

The conventions an agent needs to build a working graph — node and edge shapes,
the `pass`/`fail` handles an assertion's outgoing edges require, placeholder
syntax, assertion path rules per source, and the diagnostic codes — are served as
readable resources. A plain `resources/list` returns all of them, and
`server_info` repeats their URIs for clients that do not read resources:

| URI | Covers |
| --- | --- |
| `apiweave://guide/start-here` | The find, write, diagnose, run, debug loop that finds mistakes statically instead of with live requests, and a minimal working graph |
| `apiweave://guide/workflow-authoring` | Every node type with its config shape, edge handles, and changing a graph without resending it |
| `apiweave://guide/placeholders` | `{{env.x}}`, `{{variables.x}}`, `{{prev.x}}`, `{{secrets.x}}`, and extractor paths |
| `apiweave://guide/assertions` | What `path` means for each source, operator rules, and the suggest/validate/apply flow |
| `apiweave://guide/diagnostics` | Every `workflow_diagnose` code and how to fix it |
| `apiweave://guide/redaction` | What reads withhold, and why `<SECRET>` must never be written back |

Clients that cannot read resources fetch the same text with `guides_get` and a
slug (`start-here`, `workflow-authoring`, …). These ship inside the desktop
bundle rather than being read from `docs/`, which is not packaged. This page stays the human-facing reference; the guides are the
agent-facing one.

## Tool Discovery

Use MCP's standard `tools/list` request as the authoritative inventory. Every
tool includes:

- A description and JSON input schema.
- A JSON output schema and structured result, with text JSON as a compatibility
  fallback.
- Read-only, destructive, idempotent, and open-world annotations.

`runs_create` and `projects_run` are marked open-world because they execute
workflows' outbound HTTP requests on this machine. Other tools operate on local
APIWeave data.

`workflows_search`, `workflows_get`, `workflows_patch`, `workflows_debugContext`
and `runs_create` carry `_meta: {"anthropic/alwaysLoad": true}`, so Claude Code
loads them up front instead of behind its tool search. Every other tool stays
deferred until the agent searches for it.

## Current Tool Inventory

### Server

- `server_info`

### Workspaces

- `workspaces_list`
- `workspaces_get`
- `workspaces_create`
- `workspaces_update`
- `workspaces_delete`
- `workspaces_map`

`workspaces_delete` deletes a workspace and the resources in it.

`workspaces_map` orients an agent in a workspace with one paged read (30
workflows per page by default, `collectionId` narrows to one project). Per
workflow it returns `workflowId`, `name`, `rev`, `collectionId`, the endpoints
its request and SSE nodes call as `METHOD /path/{{…}}` (host, query string and
userinfo dropped, placeholders collapsed so a route appears once), the variable
names it produces and consumes, the `env` and `secrets` names it references, the
workflows its `workflow` nodes call, and its latest run's `runId` and `status`.
Empty lists are left out; a list longer than 20 names is cut and the rest
counted in `omitted`. Everything comes from names and path templates, never a
config value, and the latest runs for a page come from a single query.

### Workflows

- `workflows_search`
- `workflows_get`
- `workflows_searchNodes`
- `workflow_diagnose`
- `workflows_debugContext`
- `workflows_nodeSchema`
- `workflows_create`
- `workflows_patch`
- `workflows_layout`
- `workflows_delete`
- `workflows_listRevisions`
- `workflows_attachToCollection`
- `workflows_setEnvironment`
- `workflows_moveToWorkspace`

`workflows_patch` changes a workflow by id: `upsertNodes` and `upsertEdges`
replace matching entries by id and append the rest, `removeNodeIds` and
`removeEdgeIds` delete by id (edges attached to a removed node go with it),
`setVariables`/`unsetVariables` merge into the stored map, and `name`,
`description` and `tags` replace their stored values. There is no whole-graph
replace tool for agents. `expectedRevision` makes the write a compare-and-swap
against the revision the caller last read, so a concurrent desktop edit produces
a conflict rather than being overwritten. The desktop canvas saves the same way:
an agent's edit that lands while the canvas has unsaved changes is never
overwritten by the canvas's next save.

The write tools advertise each node as `{ nodeId, type, label?, parentId?,
position?, config? }` with `config` an open object, rather than repeating the
full per-type schema in every tool. `workflows_nodeSchema({ type })` returns one
node type's config as JSON Schema, generated from the same definitions the write
path validates with. Validation itself is unchanged: a bad config is rejected
with a path that names the node list and index, such as
`["nodes", 1, "config", "body"]`.

Every agent write keeps the workflow as it was just before it as a version
(see [Version history](workflows-and-nodes.md#version-history)), so the user can
undo it. `workflows_listRevisions` lists those versions, metadata only; reading
a version's content and restoring one are not agent tools.

`workflows_create` and `workflows_patch` each return `{ result, diagnosis }`,
where `result` is a compact revision and touched-id summary and `diagnosis` is
the report `workflow_diagnose` produces for the workflow just written. The
analysis is static and sends no HTTP, so a graph mistake — a missing assertion
edge handle, an assertion path that cannot address a value — is visible in the
write's own response instead of requiring a live run to discover.

`workflows_searchNodes` finds nodes in one workflow, or in every workflow of the
workspace (or of one project, with `collectionId`) when `workflowId` is omitted.
Filters combine, and every one given must hold:

- `query` is a literal substring of the node id, label, type, request method,
  URL path or extractor name. Bodies, headers, auth and query values are never
  searched.
- `ref` names a placeholder reference: `variables.NAME`, `env.NAME` or
  `secrets.NAME`. It finds the nodes that use it in their URL, headers, query
  parameters, cookies, body, GraphQL, auth, scripts (`aw.secrets.get`,
  `aw.variables.get`/`set`, `aw.env.get`), workflow-call input and output
  mappings, extractors and assertions. Each match lists where (`field`) and
  whether the node `produces` the value (an extractor, an `outputMapping` key,
  `aw.variables.set`) or `consumes` it.
- `nodeTypes` limits the node types considered.

Request and SSE matches carry `method` and `urlPath` (the path template, with
host, query string and userinfo dropped). A workspace-wide match also carries
`workflowId` and `workflowName`; a one-workflow match carries neighbour node and
incident edge ids instead. Pages hold 20 matches by default; `totalMatched`
counts every match and `nextCursor` continues the search until the searched
workflows change. The command palette uses the same search.

### Projects

- `projects_list`
- `projects_get`
- `projects_create`
- `projects_update`
- `projects_delete`
- `projects_run`
- `projects_getRun`
- `projects_listRuns`
- `projects_cancelRun`
- `projects_moveToWorkspace`
- `projects_export`
- `projects_dryRun`
- `projects_import`

`projects_run` runs a project's enabled workflows one after another, in the
project's order, against one `environmentId` (or `null` for none), and returns
at once with the project run `running`. Each workflow's run is an ordinary run
that `runs_get` reads by the item's `runId`, and one that would send stored
secrets waits for the user's approval like any run an agent starts. Project
membership itself is read with `workflows_search` and written with
`workflows_attachToCollection`.

### Environments

- `environments_list`
- `environments_get`
- `environments_create`
- `environments_update`
- `environments_delete`
- `environments_setVariable`
- `environments_deleteVariable`
- `environments_duplicate`
- `environments_moveToWorkspace`

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
- `runs_wait`
- `runs_get`
- `runs_getNodeResult`
- `runs_history`
- `runs_cancel`

`runs_history` is the one run query: filter by workflow or status, newest
first; the latest run is `limit: 1`, the latest failure adds `status: "failed"`.

`runs_create` also reruns part of a workflow: `resume: { nodeId }` starts at
that step, `resume: {}` reruns the steps the latest run failed, and `fromRunId`
picks another source run. Upstream steps are not sent again; their stored
results and variables are reused, and a rerun that would need a value stored
masked is refused. See
[Rerun from a node](visualization-and-debugging.md#6-rerun-from-a-node-or-rerun-failed-branches).

`runs_getNodeResult` is the exception to the metadata-only rule: it returns one
node's stored request and response from a run, body included, after the same
secret-redaction pass every MCP read gets. Use it to inspect a single node's
payload without leaving the agent; secret-shaped values still come back
withheld.

### Guides

- `guides_get`

### Secret Metadata

- `secrets_list`
- `secrets_resolve`

Secret mutation handlers and Electron file/shell operations are deliberately
not exposed.

## Reuse Primitives for Agents

Three reuse features are reachable over MCP. Each has one caveat an agent should
know before it writes anything.

### Sub-workflows (the `workflow` node)

`workflows_create` and `workflows_patch` accept a node of `type: "workflow"`
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
| `projects` | The sidebar's projects list, and an open project page. |
| `environments` | The environment store the run-time picker reads, and the workspace environments page. |
| `nodePresets` | The preset store the Add Nodes palette reads. |

The event is deliberately coarse: it names a domain, not a row. These stores hold
whole lists loaded by `useEffect` rather than a query cache, so a row would be
data the renderer throws away, and an occasional refetch it did not strictly
need is cheaper than the bookkeeping to prove it. A burst of writes is coalesced
into one refetch per surface.

The renderer's own writes are never published: they already update its stores,
and announcing them would fight its optimistic updates. Besides MCP writes, the
one publisher is a workspace's [git sync](../guides/git-workflows.md#sync-with-the-remote):
an import from the remote rewrites records underneath the renderer exactly as an
agent does, so each import that commits announces `workspaces`, `projects`,
`workflows`, `environments` and `nodePresets` with the action `gitImport` and
the imported `workspaceId`. Presets synced from the remote therefore appear in
the Add Nodes palette without a reload.

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

The bridge ships two MCP prompts, discoverable via the standard `prompts/list`
request and readable via `prompts/get`. Clients that support prompts show them
as slash commands: `/apiweave:e2e` in OpenCode and Claude Code. Codex does not
show MCP prompts.

- `e2e` — the one command for testing with APIWeave, so you never have to tell
  the agent to use it. The agent finds the workspace (from
  `APIWEAVE_WORKSPACE_ID` when APIWeave launched it), reads the service's code
  for real routes and fields, reuses existing workflows and conventions, builds
  journey-shaped workflows with extracted ids, an assertion after every request
  and negative cases, fixes every diagnosis error before running, runs, and
  debugs. It tells a workflow bug from an API bug, never weakens an assertion
  to make a run pass, asks before the first run against anything that looks
  like production, and ends with a report.

  The one optional argument, `task`, is what to test. **Quote it**:
  `/apiweave:e2e "invoice create and list"`. OpenCode 2.x and Claude Code
  split what you type on spaces and pass only the first word otherwise; the
  prompt tells the agent to ask when a one-word task looks cut short. With no
  task the agent asks what to test.

- `author_assertions` — steers the connected agent to turn a natural-language
  assertion request into canonical rules, validate and preview them, get the
  user's approval, then apply them under a revision guard.

APIWeave embeds no model. The prompt is pure instruction text: your agent does
the language-to-rules translation, and APIWeave only validates and persists the
result. All of `author_assertions`'s arguments (`workspaceId`, `workflowId`,
`assertionNodeId`, `runId`) are optional so the prompt is discoverable before any data exists; supplied
values are woven into the instruction text but no workspace or run data is
embedded until you pass them.

`author_assertions` directs the agent through this flow:

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

## Connect Your Agents

**Settings → MCP Server → Connect your agents** adds the launcher to each MCP
client's own user settings for you. Every client APIWeave knows is listed with
the file it would edit and its state: **Connected**, **Old entry** (an
`apiweave` entry that is not this launcher, such as a direct HTTP one),
**Not connected**, or **Not found**. Click **Connect** (or **Replace**) for one,
or **Connect all**, then restart that client. **Disconnect** removes the entry
again.

| Client | What Connect changes |
| --- | --- |
| Claude Code | Runs `claude mcp add --scope user apiweave -- <node> <launcher>`. Any old user-scope `apiweave` entry is removed first. |
| Codex | Runs `codex mcp add apiweave -- <node> <launcher>`, which writes `[mcp_servers.apiweave]` in `config.toml`. |
| OpenCode | Edits `opencode.jsonc` or `opencode.json` in `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`, Windows included), entry `mcp.apiweave`. |
| Cursor | Edits `~/.cursor/mcp.json`, entry `mcpServers.apiweave`. |
| VS Code | Edits `mcp.json` in the default profile's user folder, entry `servers.apiweave`. |
| Claude Desktop | Edits `claude_desktop_config.json`, entry `mcpServers.apiweave`. On Windows, the Microsoft Store/MSIX install reads a copy under `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude`, and that copy is the one edited when it exists. |

- **Nothing is written until you click.** These are other applications' files.
- **Only the `apiweave` entry changes.** Comments, formatting and every other
  setting in a JSON file are kept, because the edit is applied in place, not by
  rewriting the file. A file that is not valid JSON is left alone, and the error
  names it.
- **Each entry runs Node.js by its absolute path**, the one APIWeave finds on
  your `PATH`. A client opened from the Dock or Start menu may not see your
  shell's `PATH`, so a bare `node` could fail there. If you later remove or
  move that Node.js, click **Replace**.
- **Sessions you launch from APIWeave use the same entry.** Once Codex or
  OpenCode is connected, APIWeave launches it without its own per-session
  `apiweave` server, because both would merge the two entries into one that
  neither accepts. Claude Code sessions are unaffected, because their
  per-session config replaces the user's.
- Connecting needs Node.js 20 or newer, like the launcher itself.

## Client Configuration

To configure a client by hand, there are two ways to connect it:

- **The stdio launcher (recommended).** The client runs
  `node <user data>/apiweave-mcp.cjs`, which starts APIWeave when it is not
  running. See [The stdio launcher](#the-stdio-launcher). It needs **Node.js 20 or
  newer** on the `PATH` the client runs with. The config holds no token, so it is
  safe to keep in a dotfiles repository.
- **Direct HTTP.** The client connects to `http://127.0.0.1:<port>/mcp` with the
  bearer token. No Node.js is needed, but APIWeave must already be running when
  the client starts, or the client marks the server as failed until you
  reconnect it. Replace `YOUR_MCP_TOKEN` locally, never commit the populated
  config, and replace the example URL if the **MCP Server** settings page shows a
  fallback port.

In the examples, replace `LAUNCHER_PATH` with the path shown in
**Settings → MCP Server**, for example
`C:\\Users\\you\\AppData\\Roaming\\APIWeave\\apiweave-mcp.cjs` (backslashes
doubled in JSON) or `/home/you/.config/APIWeave/apiweave-mcp.cjs`.

### Claude Desktop, Claude Code and Cursor

Launcher (`claude_desktop_config.json`, a project's `.mcp.json`, or
`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "apiweave": {
      "command": "node",
      "args": ["LAUNCHER_PATH"]
    }
  }
}
```

With Claude Code you can add it from the command line instead:

```bash
claude mcp add apiweave -- node "LAUNCHER_PATH"
```

Direct HTTP, for Claude Code and Cursor:

```json
{
  "mcpServers": {
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

Claude Desktop starts local commands only, so it uses the launcher.

### VS Code

Put this in `.vscode/mcp.json` or the user MCP configuration. Launcher:

```json
{
  "servers": {
    "apiweave": {
      "type": "stdio",
      "command": "node",
      "args": ["LAUNCHER_PATH"]
    }
  }
}
```

Direct HTTP:

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

Launcher:

```json
{
  "mcp": {
    "apiweave": {
      "type": "local",
      "command": ["node", "LAUNCHER_PATH"]
    }
  }
}
```

Direct HTTP:

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

Launcher:

```bash
codex mcp add apiweave -- node "LAUNCHER_PATH"
```

Direct HTTP: store the token in `APIWEAVE_MCP_TOKEN`, then add the server:

```bash
codex mcp add apiweave --url http://127.0.0.1:47271/mcp --bearer-token-env-var APIWEAVE_MCP_TOKEN
```

Checked-in templates are available under `mcp-configs/` for Claude Desktop,
Cursor, VS Code, and OpenCode. Codex uses the CLI commands above.

Agents launched from inside APIWeave are given the direct HTTP connection
automatically: the app is running whenever they are.

## Agent Workflow Example

1. Call `server_info` to verify the bridge.
2. Call `workspaces_list`, then `workflows_search` with the selected workspace.
3. Call `environments_list` if the workflow needs a selected environment.
4. Call `runs_create` with `workspaceId` and `workflowId`. It waits up to 10
   seconds; if the run is still going, call `runs_wait` with its `runId`.
5. On a failure, call `workflows_debugContext` for the failed nodes, their
   diagnosis and error previews, then `runs_getNodeResult` for more evidence.
6. Summarize node status metadata. Ask the user to inspect the desktop response
   panel when diagnosis requires raw payload content.

Finding everything that touches a route or a credential takes one call each:

```json
{ "name": "workflows_searchNodes", "arguments": { "workspaceId": "ws-1", "query": "/orders" } }
```

```json
{ "name": "workflows_searchNodes", "arguments": { "workspaceId": "ws-1", "ref": "secrets.API_KEY" } }
```

The second call returns:

```json
{
  "workspaceId": "ws-1",
  "items": [
    {
      "workflowId": "wf-auth",
      "workflowName": "auth",
      "nodeId": "login",
      "type": "http-request",
      "label": "Log in",
      "method": "POST",
      "urlPath": "/v1/login",
      "matchedOn": ["ref"],
      "references": [{ "field": "auth", "role": "consumes" }]
    }
  ],
  "totalMatched": 1,
  "omittedMatchCount": 0,
  "nextCursor": null
}
```

## Giving the agent a map of your code

An agent learning the API under test (routes, request and response shapes, auth)
usually greps your repository, which spends a lot of tokens. A code map lets it
query instead. [graphify](https://github.com/Graphify-Labs/graphify) builds a
knowledge graph of a folder into `graphify-out/` and answers
`graphify query "<route or handler>"`, `graphify path A B` and
`graphify explain X`. APIWeave does not install or run it for you.

Paste this into your agent (Settings → Agents shows the same prompt):

```text
Install graphify for this repository: run `uv tool install graphifyy` (or `pipx install graphifyy`), then `graphify install --project`, then build the graph with `/graphify .`. Ask me whether to commit or gitignore `graphify-out/`.
```

The official PyPI package is `graphifyy` (double y); other `graphify*` packages
are not affiliated. [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
is an alternative that exposes a code graph over MCP.

When an agent is launched from APIWeave, it checks the project's folder by path
only (no repository file is read) and adjusts the session briefing:

| Folder state | What the agent is told |
| --- | --- |
| `graphify-out/graph.json` exists | Query it with `graphify query`, `graphify path` and `graphify explain` instead of grepping; `GRAPH_REPORT.md` for broad context only. graphify for the code; `workflows_searchNodes` / `workspaces_map` for the workflows. |
| No graph, `graphify` on PATH | graphify is installed and `/graphify .` would build a map; suggest it to you rather than running it unasked. |
| Neither | Nothing. |

Only agents that can carry a per-session briefing receive this: Claude Code,
OpenCode, Aider and Pi. Every other agent that connects to the bridge gets one
sentence in the `start-here` guide telling it to query `graphify-out/` with
`graphify query` if the repository has one.

## Troubleshooting

- **The server shows as failed or disconnected:** With a direct HTTP config,
  APIWeave must be running before the client starts. Switch to the launcher
  config, which starts APIWeave itself.
- **`node` is not found, or the launcher exits at once:** The launcher needs
  Node.js 20 or newer on the `PATH` the client runs with. A client started from
  the desktop rather than a terminal may not see a `PATH` set in your shell
  profile. Name Node's full path as the `command`, for example
  `/usr/local/bin/node` or `C:\\Program Files\\nodejs\\node.exe`.
- **"APIWeave has not been opened on this computer yet":** The launcher has no
  record of where APIWeave is installed. Open APIWeave once and turn on
  **Settings → MCP Server**.
- **"APIWeave did not start its MCP server within 30 seconds":** APIWeave
  started, or was already running, but its MCP server is off. Turn on
  **Settings → MCP Server**. The launcher never turns it on for you.
- **"APIWeave closed the connection during this call":** APIWeave quit or
  restarted while a write was in flight. It may have been applied, so check
  before repeating it.
- **Connection refused (direct HTTP):** APIWeave must be running and the MCP
  bridge must be enabled. Copy the current URL from **Settings → MCP Server**
  instead of assuming `47271`.
- **401 Unauthorized:** The bearer token is missing or does not match the token
  shown by the app. Update the client configuration and reconnect.
- **403 Forbidden Origin:** A browser or proxy supplied a non-loopback Origin.
  Connect through a native MCP client or the stdio launcher.
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
