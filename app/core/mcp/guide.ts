/**
 * The MCP documentation surface: the conventions an agent has to know to author
 * a working APIWeave workflow, served as readable resources.
 *
 * These exist because `tools/list` alone is not enough. A JSON schema says
 * `path` is a string; it cannot say that a `prev` path must address the response
 * object, or that an assertion's outgoing edges are handle-routed, or that
 * `{{variables.x}}` is plural. Field-level `.describe()` annotations (see
 * `WorkflowEdgeSchema`, `AssertionItemSchema`, `HTTPNodeDataSchema`) carry the
 * short form; these guides carry the worked examples and the order of
 * operations, which do not fit in a schema.
 *
 * The text lives here rather than in `docs/`, which is not packaged: only
 * `dist/desktop/**` ships (see `app/package.json` `build.files`), so a guide
 * read from the repo tree would 404 in an installed app. `docs/` remains the
 * human-facing copy; this is the agent-facing copy, deliberately shorter.
 */

import { DYNAMIC_FUNCTIONS } from "@shared/constants/dynamicFunctions"

export interface McpGuide {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly text: string
}

export const GUIDE_URI_PREFIX = "apiweave://guide/"

export function guideUri(slug: string): string {
  return `${GUIDE_URI_PREFIX}${slug}`
}

const START_HERE = `# Building and editing an APIWeave workflow

A workflow is a directed graph of nodes. A run starts at the \`start\` node and
follows edges; nothing runs unless an edge leads to it.

## The loop

1. **Find.** \`workflows_search\` (summaries, never graphs), then
   \`workflows_get\` outline, then \`view: "nodes"\` for the ids you will touch.
   A similar workflow shows this workspace's base URLs and variable names.
   \`workspaces_map\` orients in a whole workspace; \`workflows_searchNodes\`
   without \`workflowId\` maps a route (\`query\`) or a \`ref\` to every node
   using it.
2. **Learn the shapes.** \`apiweave://guide/workflow-authoring\` for nodes and
   edges, \`apiweave://guide/placeholders\` for \`{{…}}\` syntax, and
   \`workflows_nodeSchema\` for one node type's config fields.
3. **Write one branch end to end** with \`workflows_create\` or
   \`workflows_patch\`, then copy it. Patch by id with \`expectedRevision\` from
   the rev you read; a conflict means re-read and recompute. Insert a node and
   rewire it in one patch: new node, old edge removals, replacement edges.
4. **Read the write's \`diagnosis\`.** Fix every \`error\` first
   (\`apiweave://guide/diagnostics\`); \`status: "unavailable"\` means saved but
   unchecked, never clean. A validation error's path names the node's index.
5. **Only then \`runs_create\`.** It sends real HTTP; everything above is free.
   A wait timeout returns the runId for \`runs_wait\` and never cancels the run.
   A run using stored secrets waits for the user's approval;
   \`deniedByUser: true\` means they refused — say so, do not retry.
   A load run is not an agent tool: ask the user for Run options → Load
   run… in the app, or the CLI \`apiweave run <path> --workflow <name>
   --concurrency 20 --iteration-count 200 --threshold "p95<500"\`.
   Before writing a browser step, read the page with \`browser_inspect\`.
6. **Debug** with \`workflows_debugContext\` (one bounded call: failed nodes,
   diagnosis, configs, placeholders, error previews), then
   \`runs_getNodeResult\` for evidence slices; \`screenshot: true\` adds the
   screenshot.
7. **Assertions.** After a run, \`assertion_suggest\` derives rules with
   verified paths from a real response; \`assertion_apply\` writes them.

If the repository has a \`graphify-out/\` folder, use
\`graphify query "<route or handler>"\` for the code under test instead of
grepping (graphify for the code, the tools above for the workflows).

## Minimal working graph

\`\`\`json
{
  "name": "Fetch a pet",
  "nodes": [
    { "nodeId": "start", "type": "start" },
    { "nodeId": "get_pet", "type": "http-request", "config": {
      "method": "GET", "url": "{{env.BASE_URL}}/pets/{{variables.petId}}",
      "headers": [{ "key": "Accept", "value": "application/json" }],
      "extractors": { "petName": "response.body.name" } } },
    { "nodeId": "check", "type": "assertion", "config": { "assertions": [
      { "source": "status", "path": "", "operator": "equals", "expectedValue": 200 },
      { "source": "prev", "path": "response.body.id", "operator": "exists" } ] } },
    { "nodeId": "done", "type": "end" }
  ],
  "edges": [
    { "edgeId": "e1", "source": "start", "target": "get_pet" },
    { "edgeId": "e2", "source": "get_pet", "target": "check" },
    { "edgeId": "e3", "source": "check", "target": "done", "sourceHandle": "pass" }
  ],
  "variables": { "petId": "1" }
}
\`\`\`

- Edges leaving an assertion set \`sourceHandle\` \`pass\` or \`fail\`; without
  it the branch stops silently. Leaving \`fail\` unwired is normal.
- Paths start at the response: \`response.body.id\`, \`[0]\` for arrays.
- Exactly one \`start\`, at least one \`end\`.
- \`<SECRET>\` in a read is a placeholder: omit the field, or send the real value
  or \`{{secrets.NAME}}\` — never write it back.

Also: \`apiweave://guide/assertions\`, \`apiweave://guide/redaction\`.
`

const WORKFLOW_AUTHORING = `# Nodes and edges

## Node types

Every node is \`{ nodeId, type, config?, label?, position? }\`. \`position\` is
canvas layout only — execution order comes from the edges, never from position
or array order. The write tools advertise \`config\` as an open object:
\`workflows_nodeSchema\` returns one type's config fields as JSON Schema, and a
rejected config names its node's list index and field in the error path.

| type | what it does | handles |
| --- | --- | --- |
| \`start\` | entry point; the run begins here | output only, exactly one per workflow |
| \`end\` | terminal point | input only, one or more per workflow |
| \`http-request\` | sends one request, optionally extracts variables | 1 in, 1 out |
| \`sse\` | starts a bounded SSE listener and captures its final events | 1 in, **2 out: \`ready\` and \`complete\`** |
| \`websocket\` | opens a bounded WebSocket, sends its messages, captures what comes back | 1 in, **2 out: \`ready\` and \`complete\`** |
| \`grpc\` | calls a gRPC method, unary or server-streaming | 1 in, 1 out; a server-streaming call has **2 out: \`ready\` and \`complete\`** |
| \`browser\` | one step in a web page, in a real Chrome or Edge | 1 in, 1 out; all browser steps share one ordered chain |
| \`assertion\` | checks the upstream response and branches | 1 in, **2 out: \`pass\` and \`fail\`** |
| \`delay\` | waits a fixed number of milliseconds | 1 in, 1 out |
| \`merge\` | joins parallel branches | many in, 1 out |
| \`workflow\` | runs another workflow in this workspace inline | 1 in, 1 out |

### http-request

\`\`\`json
{
  "nodeId": "login",
  "type": "http-request",
  "config": {
    "method": "POST",
    "url": "{{env.BASE_URL}}/login",
    "headers": [{ "key": "Content-Type", "value": "application/json" }],
    "body": "{\\"user\\": \\"{{env.USER}}\\", \\"pass\\": \\"{{secrets.PASSWORD}}\\"}",
    "bodyType": "json",
    "extractors": { "token": "response.body.access_token" }
  }
}
\`\`\`

- \`headers\`, \`queryParams\`, \`cookies\` are **arrays of \`{key, value}\`**, not maps.
- \`body\` is a **string**, not an object. A JSON body is its serialized text.
- GraphQL: \`"bodyType": "graphql"\` with \`"graphql": {"query": "...", "variables": "<JSON text>"}\`
  instead of \`body\`. A GraphQL error answers 200: assert \`response.body.errors\` notExists.
- JSON-RPC 2.0: \`"bodyType": "jsonrpc"\` with \`"jsonrpc": {"method": "...", "params": "<JSON text>", "notification": false}\`
  instead of \`body\`, POSTed as \`{"jsonrpc":"2.0","method","params","id"}\`. A response carrying an
  \`error\` member fails the node; set \`"allowRpcError": true\` to opt out and assert
  \`response.body.error.code\` / \`response.body.error.message\`.
- SOAP: \`"bodyType": "soap"\` with \`"soap": {"version": "1.1" | "1.2", "action": "...",
  "envelope": "<SOAP-ENV:Envelope>…as XML text…"}\` instead of \`body\`. Version 1.1
  (the default) sends \`text/xml\` with a \`SOAPAction\` header; 1.2 sends
  \`application/soap+xml\` with the action in the Content-Type. A SOAP Fault in the
  response fails the node unless the status is its \`expectedStatus\`; the fault
  reads at \`response.fault.code\` / \`response.fault.reason\`, and other fields are
  read with XPath: \`xpath://*[local-name()="Total"]/text()\`, prefixes declared
  inline as \`xpath[s=uri]:…\`.
- \`extractors\` is a map of variable name to response path. After this node runs,
  later nodes read \`{{variables.token}}\`. Paths start at the response object:
  \`response.body.*\`, \`response.headers.*\`, \`response.statusCode\` — or a \`$\`
  JSONPath over the whole node result
  (\`$.response.body.items[?@.id==3].name\`), or, for an XML body, XPath
  (\`xpath://*[local-name()="Total"]/text()\`).
- \`continueOnFail: true\` lets the run continue past a failed request.
- \`expectedStatus\` — the status code(s) this request is expected to return (a number
  or an array of numbers, 100-599). The node passes when the response matches and
  **fails when it does not, including when it returns 2xx**. Omit for the default,
  where any 2xx passes. Use this for negative tests: a request that is supposed to
  be rejected, e.g. \`"expectedStatus": 409\` for a state-transition guard. It is
  orthogonal to \`continueOnFail\`: \`expectedStatus\` decides whether the node
  failed, \`continueOnFail\` decides whether a failure stops the branch.
- \`retry\` — send the request again; this is how to poll an async API, since a
  workflow has no loops (a back-edge is refused). \`{"maxAttempts": 10,
  "intervalMs": 2000, "until": [{"source": "status", "path": "", "operator":
  "equals", "expectedValue": 200}, {"source": "prev", "path":
  "response.body.status", "operator": "equals", "expectedValue": "done"}]}\`
  repeats the request until every \`until\` rule passes against this node's own
  response (same rule shape as an assertion). Without \`until\` it repeats only on
  network errors, timeouts and 5xx. \`backoff: "exponential"\` doubles the wait,
  capped by \`maxIntervalMs\`. The node's result is the last attempt plus an
  \`attempts\` list; it fails with "Condition not met after N attempts" when the
  condition never holds.
- \`scripts\` — \`{"preRequest": "...", "postResponse": "...", "timeoutMs": 1000}\`:
  synchronous JavaScript in a sandbox (no network, files or timers). Pre-request
  sees the resolved request as mutable \`aw.request\` {method, url, headers, body} —
  sign it with \`aw.crypto.hmacSha256(key, text)\`. Post-response reads
  \`aw.response\` (status, headers, body, json(), text()), sets
  \`aw.variables.set(name, value)\`, and checks with \`aw.test(name, () =>
  aw.expect(x).toBe(y))\`; a failed test or a thrown error fails the node.
  Secrets only as \`aw.secrets.get("NAME")\` with a literal name. Prefer
  extractors and assertion nodes when they can express it.
- \`responseSchemas\` — JSON Schemas keyed by status (\`"200"\`, \`"2XX"\`,
  \`"default"\`); OpenAPI import fills it from the spec. Whether a mismatch
  fails the node is set by \`contract\` (\`"off"\`, \`"warn"\`, \`"fail"\`),
  which defaults to \`"fail"\` for an imported endpoint and \`"off"\`
  otherwise. With the check on, the body must match the most specific schema
  for the actual status, and a status the schemas do not declare is itself a
  violation; violations land in the node result's \`assertions\`. Under
  \`warn\` the node still passes, so its violations sit on a PASSED node that
  failure-focused reads (\`workflows_debugContext\`, \`runs_get\`) never
  surface: read them with \`runs_getNodeResult\` \`sections: ["assertions"]\`
  on that node.

### sse

An SSE node is a **bounded test listener**, never a permanent subscription. It sends
\`GET\` with \`Accept: text/event-stream\`. Its \`ready\` handle is traversed only
after the handshake succeeds; use it to trigger the action that should emit an event.
Its \`complete\` handle is traversed once the final result is available. Without
\`finishConditions\`, it closes at \`maxEvents\` (default 1). With finish rules, all
rules must match one event; paths address \`event\`, \`id\`, raw \`data\`, or parsed
JSON \`data.*\`. Set \`timeout: 0\` only with finish rules to wait until the state is
observed. The connection still closes on cancellation, workflow failure, or its 1 MiB
raw capture cap.

The captured result body has \`events\`, \`eventCount\`, and \`termination\`.
Each event has \`event\`, optional \`id\`, and its exact string \`data\`, so an
assertion or extractor can target \`response.body.events[0].data\`.

### websocket

A WebSocket node is a **bounded test probe** with the same lifecycle as \`sse\`:
\`ready\` runs once the handshake succeeded and its \`messages\` (\`{data, type:
"text"|"binary" (base64), delayMs}\`) were sent; \`complete\` runs when it closes
at \`maxMessages\` (default 1), on a matching \`finishConditions\` rule
(all rules must match one message; paths address \`type\`, raw \`data\` or parsed
JSON \`data.*\`, or JSONPath such as \`$.data.status\`), or at \`timeout\`
(\`0\` only with finish rules). \`url\` is \`ws://\` or \`wss://\`; \`headers\`, \`auth\`
(bearer, basic, API key, JWT, OAuth 2.0) and \`subprotocols\` go in the handshake.
The body has \`messages\`, \`messageCount\`, \`termination\`, \`closeCode\` and
\`closeReason\`: assert on \`response.body.messages[0].data\`.

### grpc

A gRPC call, unary by default. With \`callType: "server-streaming"\` it opens a stream instead: the
\`ready\` output fires once the call is accepted, and \`complete\` — with every message collected in
\`response.body.messages\` — when the server ends the stream or a \`finishConditions\` rule or
\`maxMessages\` closes it. \`target\` is \`host:port\` (literal when you rely on reflection discovery), \`service\` and
\`method\` name the RPC, and \`message\` is the request as **JSON text** with field names as written in the
.proto. The schema comes from \`schemaSource: "reflection"\` (the server must expose it; call
\`grpc_discover\` to list its services, methods and request skeletons) or \`"proto"\` with the files inline in
\`protoFiles\` (path to content, imports resolve inside the map). \`metadata\` is \`{key, value}\` pairs; bearer
and API-key \`auth\` become metadata. The result has \`response.body\` (int64 as strings, enums as names,
bytes as base64), \`response.status\` (code name), \`response.statusCode\`, \`response.statusMessage\`,
\`response.headers\` and \`response.trailers\`. Any non-OK status fails the node unless it equals
\`expectedStatus\` (a code name such as \`"NOT_FOUND"\`): that is how to write a negative test.

### browser

One action per \`browser\` node — \`navigate\`, \`click\`, \`fill\`, \`press\`,
\`check\`/\`uncheck\`, \`select\`, \`hover\`, \`expect-visible\`, \`expect-text\`,
\`expect-value\`, \`expect-url\` or \`extract\`; \`workflows_nodeSchema\` lists each
one's fields. Every step that acts on an element takes \`locator\`.

All browser steps of a workflow share one page and must form **one ordered
chain**: start it with a \`navigate\` and never put two steps on parallel
branches (\`browser_parallel_branches\` is an error; the two sides of one
assertion are fine). A Call Workflow child shares the page.

\`locator\` is structured, never a selector string:
\`{"kind": "role", "role": "button", "name": "Sign in"}\` first, then \`label\`,
then \`testId\`, then \`placeholder\`/\`text\`/\`alt\`/\`title\`; \`css\` last, and
never \`kind: "selector"\` (recorder output; it raises an analyzer notice).
Narrow with \`hasText\`, \`nth\`, \`within\` and \`frame\`.

\`{{secrets.NAME}}\` is allowed **only in a fill's value**, and a password is
always that reference, never a literal; \`{{env.*}}\` for the URL and the test
account. An unresolved placeholder fails the step.

**Write from the page, not from source.** Write the \`navigate\` step and any
login steps, then call \`browser_inspect\` without \`beforeNodeId\`: it runs the
workflow headless and returns the page it ends on — URL, title and the masked
ARIA snapshot — which is where the next step starts. Take that step's locator
from the snapshot, the tree Playwright's own recorder picks locators from:
\`button "Sign in"\` is \`{"kind": "role", "role": "button", "name": "Sign in"}\`,
and \`textbox "Email"\` is role \`textbox\` name \`Email\`, or a \`label\` locator.
Add the step with \`workflows_patch\`, inspect again, and \`runs_create\` once the
flow is written. \`beforeNodeId\` stops the run before an existing step instead,
showing the page that step acts on: the way to check a locator you are
repairing. \`page: null\` means no browser step had run: add a \`navigate\`
first (there is no \`url\` mode). \`browser_inspect\` sends real traffic and
records a run, like \`runs_create\`. Its wait is bounded (\`waitMs\`, default
10000, max 30000): \`terminal: false\` means the run has not finished, possibly
waiting for the user's approval — pass that \`runId\` back to keep waiting, which
starts no new run and asks for no second approval. \`deniedByUser: true\` means
they refused or did not answer — say so, do not retry. A timeout or disconnect
never cancels the run (only \`runs_cancel\` does).

**Repair.** A failed step's evidence is in \`workflows_debugContext\`, or in
\`runs_getNodeResult\` with \`sections: ["browser"]\`: \`expected\` vs \`actual\`,
Playwright's \`detail\`, the page URL and title, and the masked ARIA snapshot at
the failure. Add \`screenshot: true\` with one \`nodeId\` when the tree is not
enough; the image arrives as image content. Patch only that node with
\`workflows_patch\`, then rerun with \`runs_create\` \`resume: { nodeId }\` — a
rerun that reaches a browser step restarts the chain from its first step.

The desktop's **Re-pick element** is yours too: \`browser_inspect\` with
\`beforeNodeId\` shows the page the step acts on, and a locator taken from
that snapshot replaces the step's. A merged patch cannot drop old keys
(\`role\`, \`name\`, \`text\`, …), so a changed locator kind — and the desktop's
**Turn into extract**, the same replace with \`action: "extract"\`, \`from\` and
a \`variable\` — is one patch naming the step in \`removeNodeIds\` and upserting
its complete node, its edges kept:

\`\`\`json
{ "removeNodeIds": ["fill-email"], "upsertNodes": [
  { "nodeId": "fill-email", "type": "browser", "position": { "x": 220, "y": 0 },
    "config": { "action": "fill",
                "locator": { "kind": "label", "value": "Email address" },
                "value": "{{secrets.EMAIL}}" } }] }
\`\`\`

Decide whether the test or the app is wrong before you change an \`expect-*\`
step, and never weaken a check to turn a run green. Runs started over MCP are
always headless.

### assertion

An assertion node checks values from **the nearest response-producing node**
upstream** — in a chain of several, that is the closest one, not the first.
Zero response-producing nodes upstream, or two at the same distance, makes the
source ambiguous and the node fails — \`workflow_diagnose\` reports this as
\`assertion_source_missing\` or \`assertion_source_ambiguous\` before you ever run it.

Rules live at \`config.assertions\`. See \`apiweave://guide/assertions\`.

\`pass\` and \`fail\` are the two output handles. Both are optional wires: an
unwired \`fail\` handle is the normal, expected shape — the run records the
failed assertion and terminates that branch. Wire \`fail\` only when you want a
distinct failure path (a cleanup request, a notification, a compensating call).
Wiring every \`fail\` handle straight to the shared \`end\` node does exactly what
leaving it unconnected already does, just with more edges — \`workflow_diagnose\`
flags that shape as \`assertion_fail_wired_on_all\` (notice, not warning: it is
verbose, not wrong).

Both handles also fan out in parallel: more than one edge leaving \`pass\` (or
\`fail\`) starts all the target branches concurrently — \`workflow_diagnose\` notes
this as \`assertion_branch_duplicate\` (a notice, not a warning; it is verbose,
not wrong). To rejoin parallel branches downstream, route them into a single
\`merge\` node.

### merge

\`config.mergeStrategy\` is \`all\` (wait for every branch), \`any\` (first to finish),
\`first\` (first to start), or \`conditional\`. Downstream of a merge, address a
specific branch by index: \`{{prev[0].response.body.id}}\`.

### workflow (call another workflow)

\`\`\`json
{
  "nodeId": "authenticate",
  "type": "workflow",
  "config": {
    "targetWorkflowId": "wf_login",
    "inputMapping": { "tenant": "{{variables.tenantId}}" },
    "outputMapping": { "authToken": "accessToken" }
  }
}
\`\`\`

Runs inline inside the current run — no separate run history entry. The
sub-workflow shares the environment and secrets, so only \`variables\` need
mapping. \`inputMapping\` maps a target variable name to an expression resolved in
the **caller's** context; \`outputMapping\` maps a caller variable name to a
sub-workflow variable name. A \`{{secrets.NAME}}\` on the right-hand side of an
input mapping is rejected — let the sub-workflow read the secret itself. The
target must live in the same workspace and cannot be the calling workflow.
Recursion is capped at 8 levels.

\`forEach\` runs the target once per element instead of once:

\`\`\`json
"forEach": { "items": "{{variables.ids}}", "itemVariable": "id",
             "indexVariable": "i", "concurrency": 4 }
\`\`\`

\`items\` is one of a single \`{{...}}\` placeholder whose value is an array
(\`{{variables.ids}}\`, \`{{fetchIds.response.body.items}}\`), a JSON array literal
(\`[1, 2]\`), or a \`$\` JSONPath rooted at \`{ variables, env, data, <nodeId> }\`
(\`$.fetch.response.body.items\`); at most 1000 items run and further items are
ignored. The sub-workflow reads the current element as
\`{{variables.<itemVariable>}}\` — required, the node fails without it — and its
zero-based index as \`{{variables.<indexVariable>}}\` when set. \`concurrency\`
(1-16, default 1) runs that many iterations at once; above 1 the node fails at
run time when the target has browser steps, which share one page. The node
passes only when every iteration passes; \`stopOnFailure\` (default true) stops
starting iterations at the first failure. Under \`forEach\`, \`outputMapping\`
variables become arrays in item order — \`null\` where an iteration did not run
or did not produce the variable — and each iteration is its own sub-run of the
target, listed in the node result under \`subWorkflow.forEach\`.

## Edges

\`\`\`json
{ "edgeId": "e3", "source": "check", "target": "ok", "sourceHandle": "pass" }
\`\`\`

**Every edge leaving an \`assertion\` node must set \`sourceHandle\` to exactly
\`"pass"\` or \`"fail"\`.** The assertion routes its result down the matching
branch; an edge without a handle is never followed, so the branch stops silently
mid-run. This is the single most common authoring mistake, and
\`workflow_diagnose\` reports it as \`assertion_branch_handle_invalid\` — an error
you can see before running anything.

That rule constrains which handle an edge that *exists* must use — it does not
require an edge on *every* handle. Leaving \`fail\` unconnected is normal: the run
still records the failed assertion and stops that branch there.

Except for stream nodes — SSE, WebSocket and a server-streaming gRPC call
(\`callType: "server-streaming"\`), whose edges use \`ready\`/\`complete\` — and
visual \`group\`/\`note\` nodes (no handles), all other node types have one output;
leave \`sourceHandle\` unset for them. A handle the source node does not have is
an \`edge_source_handle_ignored\` warning (the canvas hides the edge), and a
stream edge without \`ready\`/\`complete\` is a \`stream_edge_handle_invalid\` error
(the run never follows it).

## Changing a graph

Change an existing workflow with \`workflows_patch\`, which upserts and removes
by id and leaves everything you do not name as stored — including name,
description and tags:

\`\`\`json
{
  "workspaceId": "...",
  "workflowId": "...",
  "expectedRevision": 7,
  "upsertEdges": [
    { "edgeId": "e3", "source": "check", "target": "ok", "sourceHandle": "pass" }
  ]
}
\`\`\`

\`expectedRevision\` (the workflow's current \`rev\`) makes the write a
compare-and-swap: if someone edited the workflow meanwhile you get a conflict
instead of silently clobbering their change. Removing a node also removes the
edges attached to it.

### Insert a node and rewire in one patch

The keys are \`upsertNodes\` and \`upsertEdges\`. To insert \`check\` into an
existing \`request → end\` connection named \`request-end\`, send the new node,
the old edge removal, and both replacement edges in **one** \`workflows_patch\`
call. Splitting these across calls can leave a saved branch disconnected.
Use the actual node/edge ids and current \`rev\` from \`workflows_get\`:

\`\`\`json
{
  "workspaceId": "...",
  "workflowId": "...",
  "expectedRevision": 7,
  "upsertNodes": [
    {
      "nodeId": "check",
      "type": "assertion",
      "position": { "x": 0, "y": 0 },
      "config": {
        "assertions": [
          { "source": "status", "path": "", "operator": "equals", "expectedValue": 200 }
        ]
      }
    }
  ],
  "removeEdgeIds": ["request-end"],
  "upsertEdges": [
    { "edgeId": "request-check", "source": "request", "target": "check" },
    { "edgeId": "check-end", "source": "check", "target": "end", "sourceHandle": "pass" }
  ]
}
\`\`\`

Read the returned \`diagnosis\` and confirm \`touchedNodeIds\` / \`touchedEdgeIds\`
include the intended edits before running. A successful write means the edit
was saved, not that the graph is runnable; diagnosis is reported after saving.
On a revision conflict, read the workflow again and recompute the complete patch.

## From an OpenAPI or WSDL file

To build a workflow from a spec file, read the file yourself and call
\`workflows_importOpenapi\` (spec text) or \`workflows_importWsdl\` (WSDL text).
Both parse only — nothing is saved — and return node templates ready to pass
back: the \`nodes\` and \`edges\` go to \`workflows_create\` for a new workflow,
or \`upsertNodes\`/\`upsertEdges\` on \`workflows_patch\` to add them to an existing
one. OpenAPI templates carry \`openapiMeta\` and \`responseSchemas\`, so each
endpoint's response-body contract check defaults to \`fail\`; WSDL templates
carry a generated SOAP envelope. The returned node ids are fresh import ids —
rename them if you care about the names.
`

const PLACEHOLDERS = `# Placeholders

Every string field in a request — URL, method, query params, headers, cookies,
body, timeout — is interpolated before the request goes out. The syntax is
always \`{{namespace.name}}\`.

| namespace | example | source |
| --- | --- | --- |
| \`env.*\` | \`{{env.BASE_URL}}\` | the environment selected for the run |
| \`variables.*\` | \`{{variables.token}}\` | workflow variable: seeded manually or written by an extractor |
| \`prev.*\` | \`{{prev.response.body.id}}\` | the previous node's result |
| \`secrets.*\` | \`{{secrets.API_KEY}}\` | the local secret scope chain (environment, then workspace) |
 | functions | \`{{uuid()}}\` | dynamic helpers listed below |

## variables (note the plural)

\`{{variables.token}}\`, never \`{{variable.token}}\` — the singular form is not a
namespace and is left in the request as literal text. A variable comes from
either the workflow's \`variables\` map or an upstream node's \`extractors\`:

\`\`\`json
"extractors": { "token": "response.body.access_token" }
\`\`\`

then downstream: \`{ "key": "Authorization", "value": "Bearer {{variables.token}}" }\`.

\`workflow_diagnose\` reports a \`{{variables.x}}\` with no producer as
\`variable_source_missing\`, and a producer that is not actually upstream of its
consumer as \`variable_producer_not_upstream\`.

## Dynamic functions

Every available function is listed here. Function names are case-sensitive; an
unknown function is left as literal text at run time and is reported before then
by \`workflow_diagnose\` as \`unknown_function\`.

| function | result |
| --- | --- |
${DYNAMIC_FUNCTIONS.map(({ signature, description }) => `| \`${signature}\` | ${description} |`).join("\n")}

## prev

\`prev\` addresses the previous node's result object. Paths use dot notation with
\`[n]\` for array indexes:

\`\`\`text
{{prev.response.body.id}}
{{prev.response.body.items[0].name}}
{{prev.response.headers.content-type}}
{{prev.response.statusCode}}
\`\`\`

After a \`merge\` node, index the branch: \`{{prev[0].response.body.id}}\`.
Branch indexes start at 0 in canvas order.

## secrets

\`{{secrets.NAME}}\` resolves from the environment first, then the workspace
store. The value must already exist in a scope before the run — there is no
runtime prompt, and secrets cannot be created over MCP (\`secrets_list\` and
\`secrets_resolve\` are metadata-only). Use \`secrets_list\` to see which names
are available.

Never inline a real credential into a workflow. Write \`{{secrets.API_KEY}}\` and
the reference survives reads and exports intact; a literal does not.

## When a placeholder does not resolve

It is left in the request as literal text rather than failing. If a request goes
out with \`{{env.BASE_URL}}\` in the URL, the environment is not selected or the
key does not exist — check \`workflows_get\` for \`selectedEnvironmentId\` and
\`environments_get\` for the key.

Every run-relevant node result carries an \`unresolvedPlaceholders\` list naming
the references that stayed literal (e.g. \`["env.EMAIL", "variables.token"]\`);
\`runs_get\` and \`runs_getNodeResult\` surface it per node. A failed run whose
node lists placeholders means the request went out with literal text — fix the
missing value, not the target. A 401 from an auth endpoint with
\`unresolvedPlaceholders\` present is a misconfiguration, not bad credentials.
`

const ASSERTIONS = `# Assertions

A rule is \`{ source, path, operator, expectedValue? }\`. Rules live at
\`config.assertions\` on an \`assertion\` node, and every rule must pass for the
node to take its \`pass\` branch.

## source decides what path means

| source | what it reads | path |
| --- | --- | --- |
| \`status\` | the response status code | **must be \`""\`** |
| \`prev\` | the upstream response object | dot, \`$\` JSONPath or \`xpath:\` — the three forms below |
| \`headers\` | one response header | the header name, e.g. \`content-type\` |
| \`cookies\` | one response cookie | the cookie name, e.g. \`session\` |
| \`variables\` | one workflow variable | the variable name, e.g. \`token\` |

A \`prev\` path has three forms, the same grammar as extractors and evidence
paths. A **dot path** starts at the response object: \`response.body.<field>\`
with \`[0]\` for array indexes (\`response.body.items[0].id\`),
\`response.headers.<name>\`, \`response.fault.code\` (a SOAP fault),
\`response.statusCode\`, \`response.duration\`. A **\`$\` path** is RFC 9535 JSONPath
rooted at the whole node result: \`$.response.body.items[?@.id==3].name\`, with
the response time at \`$.duration\`. An **\`xpath:\` path** is XPath 1.0 over the
XML body: \`xpath://*[local-name()="Total"]/text()\`, prefixes declared inline as
\`xpath[s=uri]:…\`. A **bare field name is not a path**:
\`{"source": "prev", "path": "id"}\` does not address anything; the value lives
at \`response.body.id\`. \`assertion_validate\`
canonicalizes a path that is merely missing its prefix (\`body.id\` becomes
\`response.body.id\`) and rejects anything that cannot address a value, with a
message naming the accepted shapes.

For \`headers\`, \`cookies\` and \`variables\` the path is just the name — no
\`response.\` prefix.

## operators

\`equals\`, \`notEquals\`, \`contains\`, \`notContains\`, \`gt\`, \`gte\`, \`lt\`,
\`lte\`, \`count\`, \`exists\`, \`notExists\`, \`matches\`, \`notMatches\`,
\`type\`, \`matchesSchema\`, \`matchesSnapshot\`.

- \`exists\`, \`notExists\` and \`matchesSnapshot\` take no \`expectedValue\`;
  every other operator requires one.
- \`matchesSnapshot\` compares the value at \`path\` with the baseline the
  rule's first run recorded, and fails with a diff when it changes.
  \`ignorePaths\` lists JSONPath expressions to leave out of the comparison
  (\`["$..updatedAt"]\`). A changed snapshot is the user's call: ask them to
  click **Accept snapshot** on the failed rule in the run inspector, or to
  rerun the CLI with \`--update-snapshots\` — never replace or delete the
  rule to turn a run green.
- \`count\` compares the length of an array or string and needs a non-negative
  integer.
- \`matches\` / \`notMatches\` take a regular expression: bare (\`"^ord_"\`) or a
  literal with flags (\`"/^ok$/i"\`). Values over 100,000 characters and matches
  running past 100 ms fail the rule.
- \`type\` takes \`string\`, \`number\`, \`integer\`, \`boolean\`, \`object\`,
  \`array\` or \`null\`.
- \`matchesSchema\` takes a JSON Schema object (draft 2020-12 unless \`$schema\`
  says draft-07, 2019-09 or draft-04); a failed rule lists its first 10
  violations as \`schemaErrors\` ({path, message}).
- \`status\` accepts only \`equals\`, \`notEquals\`, \`gt\`, \`gte\`, \`lt\`, \`lte\`.

## Worked examples

\`\`\`json
{ "source": "status", "path": "", "operator": "equals", "expectedValue": 200 }
{ "source": "prev", "path": "response.body.id", "operator": "exists" }
{ "source": "prev", "path": "response.body.items", "operator": "count", "expectedValue": 3 }
{ "source": "prev", "path": "response.duration", "operator": "lte", "expectedValue": 500 }
{ "source": "headers", "path": "content-type", "operator": "contains", "expectedValue": "application/json" }
{ "source": "variables", "path": "token", "operator": "exists" }
{ "source": "prev", "path": "response.body.id", "operator": "matches", "expectedValue": "^ord_[0-9a-f]{8}$" }
{ "source": "prev", "path": "response.body.total", "operator": "type", "expectedValue": "integer" }
{ "source": "prev", "path": "response.body", "operator": "matchesSchema", "expectedValue": { "type": "object", "required": ["id"] } }
\`\`\`

## Authoring flow

1. \`assertion_suggest\` with a \`runId\` and the source HTTP \`sourceNodeId\`.
   It reads a response that actually happened and returns rules whose paths are
   already verified against it. Use this whenever a run exists — it is faster and
   more reliable than writing paths by hand. It needs a completed result for that
   node; before any run exists, write rules from the table above instead.
2. Use \`assertion_validate\` when you need a preview, evidence check, or explicit
   user approval. Its returned \`rules\` are canonicalized — pass those on, not
   your originals. \`valid: false\` means at least one error-severity issue.
3. \`assertion_apply\` with \`assertionNodeId\`, \`mode\` (\`"append"\` or
   \`"replace"\`), the rules, and \`expectedRevision\` taken from the workflow's
   \`rev\`. Apply validates rules itself; validation is not a required duplicate
   call when no preview is needed. A conflict means the workflow changed
   underneath you: re-read, recompute, retry.

\`assertion_apply\` targets an existing assertion node — it does not create one.
Add the node with \`workflows_create\`/\`workflows_patch\` first, remembering the
\`pass\`/\`fail\` edges.

## Never inline a credential

A secret-looking \`expectedValue\` is rejected with \`unsafe_literal\`. Compare
against \`{{secrets.NAME}}\` instead.
`

const DIAGNOSTICS = `# Diagnostics

\`workflow_diagnose\` statically analyses a stored graph and, given a \`runId\`,
correlates a past run. It sends no HTTP and changes nothing, so run it freely.
The write tools (\`workflows_create\`, \`workflows_patch\`)
return the same report as \`diagnosis\` in their own response — read it there
first.

Each diagnostic carries \`code\`, \`severity\` (\`error\` | \`warning\` | \`notice\`),
\`category\`, \`nodeIds\`, \`message\`, \`evidence\` and a \`remediation\` hint.
Clear every \`error\` before running.

## Topology

| code | meaning |
| --- | --- |
| \`missing_start_node\` / \`duplicate_start_node\` | a workflow needs exactly one \`start\` |
| \`missing_end_node\` | a workflow needs at least one \`end\`; separate terminal paths may use separate end nodes |
| \`duplicate_node_id\` / \`duplicate_edge_id\` | ids must be unique |
| \`dangling_edge\` | an edge references a nodeId that does not exist |
| \`edge_source_handle_ignored\` | an edge from a single-output node sets a \`sourceHandle\`; the canvas does not draw it (a run still follows it) — warning |
| \`stream_edge_handle_invalid\` | an edge from an SSE, WebSocket or server-streaming gRPC node does not use \`ready\` or \`complete\`. The run never follows it, so the branch never runs. |
| \`unreachable_nodes\` | no path from \`start\` reaches these — they never run |
| \`cycle_detected\` | the graph loops |

## Assertions and branching

| code | meaning |
| --- | --- |
| \`assertion_branch_handle_invalid\` | an edge leaving an assertion has no \`sourceHandle\`, or one that is not \`pass\`/\`fail\`. The branch stops silently at run time. |
| \`assertion_branch_duplicate\` | more than one edge leaves one assertion handle — the branches run in parallel (notice, not warning) |
| \`assertion_fail_wired_on_all\` | a \`fail\` handle is wired straight to \`end\`, which does what leaving it unconnected already does — an unwired \`fail\` is the normal expected shape (notice) |
| \`assertion_source_missing\` / \`assertion_source_ambiguous\` | zero, or more than one, response-producing (\`http-request\` or \`sse\`) node reachable upstream |
| \`assertion_source_path_invalid\` | the path cannot address a value for that source — see \`apiweave://guide/assertions\` |
| \`assertion_source_unknown\` / \`assertion_operator_unknown\` | not a member of the enum |
| \`assertion_expected_missing\` | the operator needs an \`expectedValue\` (present, not truthy; \`false\`, \`0\` and \`""\` are valid) |
| \`assertion_expected_invalid\` | the \`expectedValue\` has the wrong shape for its operator: an unknown \`type\` name, a regular expression that does not compile, a \`matchesSchema\` value that is not a schema object |
| \`assertion_rules_missing\` | the node has no rules and always passes |
| \`continue_on_fail_status_check_migratable\` | a \`continueOnFail\` request with a downstream assertion pinning a non-2xx status — \`expectedStatus\` says the same thing and lets the run go green (notice) |

## Dataflow

| code | meaning |
| --- | --- |
| \`extractor_path_invalid\` | an extractor path is not rooted at the response object (response.…) or is an invalid \`$\` JSONPath expression |
| \`variable_source_missing\` | \`{{variables.x}}\` is read but nothing produces it |
| \`variable_producer_duplicate\` | two nodes write the same variable |
| \`variable_producer_not_upstream\` | the producer is not upstream of the consumer, so the value is not set yet |

## Run-correlated (pass a \`runId\`)

| code | meaning |
| --- | --- |
| \`http_request_failed\` | a request failed, and \`evidence.cause\` says why: \`transport\` (no response arrived), \`status\` (>= 400), \`expected_status\` (not one of the node's \`expectedStatus\`), \`rpc_error\` (a JSON-RPC \`error\` member), \`soap_fault\` (a SOAP Fault) or \`post_response\` (a failed post-response script, or a retry whose \`until\` condition never held). \`evidence.statusCode\` is present when a response arrived; \`evidence.blockedNodeIds\` lists what it stopped |
| \`contract_violation\` | with the \`responseSchemas\` check failing the node, the body did not match the schema for its status, or the status is not declared at all; read the violations in the node result's \`assertions\` → \`schemaErrors\`, via \`runs_getNodeResult\` with \`sections: ["assertions"]\` |
| \`grpc_call_failed\` | a gRPC call ended with a status other than the expected one; \`evidence.statusCode\` is the gRPC code number |
| \`workflow_call_failed\` | a Call Workflow node failed inside the workflow it calls; \`evidence.childRunIds\` names the failed child run(s) — read one with \`runs_getNodeResult\` to see which step inside the callee failed |
| \`assertion_failed\` | a rule compared false |
| \`assertion_source_mismatch\` | the run resolved a different source node than static analysis expects |
| \`extractor_path_missing\` / \`extractor_type_mismatch\` | the path did not match the real response shape |
| \`extractor_producer_not_executed\` | the producing node never ran |
| \`response_body_truncated\` / \`response_body_unavailable\` | the body was not fully captured, so path checks are inconclusive |
| \`secret_reference_unresolved\` | \`{{secrets.NAME}}\` had no value in any scope |
| \`nodes_not_executed\` | nodes the run never reached |

## Not covered

\`workflow\` (call-workflow) node targets are validated on save, not by the
analyzer. \`{{env.*}}\` references are not checked against the selected
environment. Both still fail at run time if wrong.
`

const REDACTION = `# What MCP reads withhold

Every read crossing this bridge is redacted. The rule: **an agent may see the
shape of anything, and the value of nothing that could be a credential.**

## Workflow and preset reads

Structure is preserved. A header whose name suggests a credential comes back as
an entry with its value replaced:

\`\`\`json
{ "key": "Authorization", "value": "<SECRET>" }
\`\`\`

The entry is still there, so you can tell "stored, value withheld" from "never
saved". Request bodies are redacted leaf by leaf: a plain JSON body comes back
as written, and only the fields that name or look like credentials are replaced.
Cookie values are always withheld. URLs keep their shape, losing only embedded
userinfo, a fragment, and secret-named query parameters.

\`{{secrets.NAME}}\` references survive verbatim everywhere — a reference is not a
secret, and seeing it is how you know which credential a request uses.

## Never write \`<SECRET>\` back

\`<SECRET>\` is what a read substituted for a value; it is not a value. Writing it
back replaces a working credential with a literal that gets sent upstream on the
next run, so \`workflows_create\`, \`workflows_patch\` and the preset tools reject it and name the offending paths.

When editing something you read: send the real value, send a
\`{{secrets.NAME}}\` reference, or omit the field. With \`workflows_patch\` you can
usually omit it — patch only touches the nodes you name.

## Run reads

Runs are metadata only: status, timing, aggregate counts and failed-node
detail with the *type* and *state* of actual values but never the values
themselves. No response bodies, headers, cookies, URLs or variable values
cross this bridge on any run tool except one: \`runs_getNodeResult\` returns
bounded evidence for up to 50 nodes of a run — selected sections, an
extractor-grammar path into the response record (body, headers, fault,
trailers), and capped text previews
with explicit truncation accounting — after the same secret-redaction pass
every other read gets. Bodies travel as previews, never whole. A browser
step's URL, title, expected and actual values and masked ARIA snapshot are
evidence of the same kind; \`screenshot: true\` also returns that step's JPEG,
with password fields and every masked value painted over. \`browser_inspect\`
returns the page its run left open under the same masking. Everything
else about runs stays metadata-only; to see other payloads, open the run in
the desktop app.

This is why \`assertion_suggest\` exists: it reads the stored response
server-side and returns *rules*, so you get verified paths without the payload.

## Secrets

\`secrets_list\` and \`secrets_resolve\` return names, scopes and which scope a
name binds to — never a value, plaintext or encrypted. Secrets cannot be created,
changed or deleted over MCP; that is a desktop action.
`

/**
 * What the server says about itself in `initialize`, before a single tool has
 * been called.
 *
 * This is the one piece of documentation an MCP client is handed rather than
 * having to ask for, which makes it the only orientation that reaches an agent
 * whose CLI has no flag for standing instructions — most of the roster. It says
 * what APIWeave is, where the session's own ids are, and which guide to read; it
 * does not restate the guides, because it is paid for on every connection.
 *
 * Kept next to the guides so the two are edited together. A pointer here to a
 * slug that no longer exists is worse than no pointer at all.
 */
export const MCP_INSTRUCTIONS = `APIWeave is a desktop app for building and running API test workflows. A
workflow is a graph of nodes — HTTP, gRPC, WebSocket and SSE calls, browser
steps, assertions, delays — that runs against a real service. Workflows live in
APIWeave's database, not in files — these tools are the only way to reach one.

Scope: if launched from APIWeave, APIWEAVE_WORKSPACE_ID plus APIWEAVE_WORKFLOW_ID
or APIWEAVE_PROJECT_ID name what the user was looking at. Start there.

Rules for every edit: change a workflow with \`workflows_patch\` (by id); send
the \`rev\` you last read as \`expectedRevision\` and re-read on a conflict;
read the one \`diagnosis\` graph writes return (\`unavailable\` means
saved-but-unchecked, never clean).
\`runs_create\` sends real HTTP; everything else is free. Reads withhold secret
values — reference them as {{secrets.NAME}}, never write an observed credential.

Focused context, cheapest first: \`workflows_search\` (summaries, never graphs;
\`workspaces_map\` to orient in a whole workspace) -> \`workflows_get\` outline
then nodes -> \`workflows_debugContext\` for a failure (one bounded call) ->
\`runs_getNodeResult\` for evidence slices; \`browser_inspect\` returns the page
a browser step left open, before you write the next step.
Read ${GUIDE_URI_PREFIX}start-here before building or editing;
\`server_info\` lists the other guides.`

export const MCP_GUIDES: readonly McpGuide[] = [
  {
    slug: "start-here",
    title: "Start here: building and editing an APIWeave workflow",
    description:
      "The find, write, diagnose, run, debug loop that finds mistakes statically instead of with live HTTP requests, and a minimal working graph.",
    text: START_HERE,
  },
  {
    slug: "workflow-authoring",
    title: "Nodes and edges",
    description:
      "Every node type with its config shape, the pass/fail edge handles an assertion requires, and how to change a graph without resending it.",
    text: WORKFLOW_AUTHORING,
  },
  {
    slug: "placeholders",
    title: "Placeholders and variable interpolation",
    description:
      "The {{env.x}}, {{variables.x}}, {{prev.x}} and {{secrets.x}} namespaces, extractor paths, and what happens when one does not resolve.",
    text: PLACEHOLDERS,
  },
  {
    slug: "assertions",
    title: "Assertion rules",
    description:
      "What path means for each assertion source, the operator rules, worked examples, and the suggest/validate/apply flow.",
    text: ASSERTIONS,
  },
  {
    slug: "diagnostics",
    title: "Diagnostic codes",
    description: "What every workflow_diagnose code means and how to fix it.",
    text: DIAGNOSTICS,
  },
  {
    slug: "redaction",
    title: "What MCP reads withhold",
    description:
      "Which values are redacted from reads, why the structure is still intact, and why <SECRET> must never be written back.",
    text: REDACTION,
  },
]
