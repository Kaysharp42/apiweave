# Workflows and Nodes

*How to build, edit, and run a workflow on the APIWeave canvas. Covers every node type, the canvas actions in the toolbar, the keyboard shortcuts worth memorizing, and the local-first context every workflow lives in.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the basic vocabulary (workflow, node, edge, run, variable, extractor, environment).
- [Installation](../getting-started/installation.md) so the app is running.
- The app does not require a login. Workflows and environments live on your local machine.

## Table of Contents

- [Where Workflows Live](#where-workflows-live)
- [Building a Workflow](#building-a-workflow)
- [Node Types](#node-types)
  - [Start](#start)
  - [End](#end)
   - [HTTP Request](#http-request)
   - [SSE Stream](#sse-stream)
  - [Assertion](#assertion)
  - [Delay](#delay)
  - [Merge](#merge)
  - [Call Workflow](#call-workflow)
- [Reusing a Node Configuration](#reusing-a-node-configuration)
- [Canvas Actions](#canvas-actions)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Recommended Build Pattern](#recommended-build-pattern)

## Where Workflows Live

Every workflow can live inside a project on your local machine. A workflow belongs to at most one project at a time, or can be left outside any project. The sidebar lists every project and every workflow in the project. Workflows open as tabs, so you can switch between several open workflows on the canvas with `Ctrl+Tab`.

Workflows are members of a project. A workflow can be inside one project at a time, and the project list records the order you intend to run them in. See [Projects](projects.md) for the grouping flow and the `.awecollection` export.

## Building a Workflow

1. Open the workflows list from the sidebar.
2. Click **New Workflow**. A Start node is placed for you.
3. Open the **Add Nodes** panel (the plus button at the bottom-right of the canvas) and drag nodes onto the canvas.
4. Connect nodes by dragging from the output handle of one node to the input handle of the next. A connection that leads back to an earlier node is refused: workflows have no loops.
5. Double-click any node to open its editor, or use the inline body for quick edits. Changes auto-save after 700ms.
6. Pick the environment for the run from the canvas toolbar.
7. Click **Run** to execute the full graph.

A simple login flow looks like this on the canvas:

```text
[ Start ] -> [ HTTP Request: POST /login ] -> [ Assertion ] -> [ End ]
                                                          |
                                                          +-> [ HTTP Request: cleanup ] (fail path)
```

## Node Types

APIWeave ships several node types. Each does one job. Start and End mark flow boundaries; the rest do work.

### Start

**Purpose:** Marks the entry point of the workflow; the runner begins here on every run.

| Config | What it does |
| --- | --- |
| `label` | Optional display name shown on the canvas |
| `metadata` | Optional key/value pairs for your own use |

**Handles:** output only. One workflow should have exactly one Start node.

### End

**Purpose:** Marks the terminal point of a path. A workflow needs at least one End node and may have several. Converging your success and cleanup paths on a single End keeps a large graph easier to read, so prefer it when the paths mean the same thing; use separate End nodes when the outcomes are genuinely distinct and you want them distinguishable on the canvas. Either shape runs the same way — the runner marks each End it reaches as passed, on its own.

| Config | What it does |
| --- | --- |
| `label` | Optional display name shown on the canvas |
| `metadata` | Optional key/value pairs for your own use |

**Handles:** input only. When a run reaches an End node, that path is considered complete.

### HTTP Request

**Purpose:** Sends an HTTP call to an upstream service and optionally extracts values from the response into workflow variables.

| Field | What it does |
| --- | --- |
| `method` | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, or `OPTIONS` |
| `url` | Full request URL. Supports placeholders like `{{env.BASE_URL}}/users`; `{{secrets.*}}` is refused in the URL |
| `query params` | Structured key/value rows, each with an active toggle |
| `path variables` | Named segments of the URL path (`/users/:id`) with their values |
| `headers` | Structured key/value rows, each with an active toggle |
| `cookies` | Structured key/value rows, each with an active toggle |
| `auth` | Optional auth scheme: bearer token, basic credentials, API key, or OAuth 2.0 (see [OAuth 2.0](#oauth-20)). Supports placeholders |
| `body` | Body type: none, JSON, raw, form-data (with optional file uploads), x-www-form-urlencoded, or binary. Supports placeholders in any field. A non-empty JSON body is sent with `Content-Type: application/json` unless you set a `Content-Type` header yourself |
| `timeout` | Request timeout in seconds (default 30). It is the request's only deadline: a timed-out node fails with "Request timed out after Ns" |
| `follow redirects` | Whether redirect responses are followed (on by default, at most 5 hops). Redirects behave like a browser's: a 303, or a 301/302 answering a POST, is followed with a bodiless GET; a 307/308 resends the method and body; `Authorization`, `Cookie` and `Proxy-Authorization` are dropped when the redirect leaves the original origin; a redirect from HTTPS to HTTP is refused |
| `verify SSL` | Whether the TLS certificate is verified (on by default) |
| `expected status` | Optional expected status code or comma-separated list (see below) |
| `continue on fail` | Whether a failed request lets the run continue down the outgoing edge |
| `retry` | Optional: send the request again until a condition holds, or after a network error or 5xx (see [Retry and polling](#retry-and-polling)) |
| `extractors` | List of `{name, path}` pairs that pull values from the response into workflow variables (see [Variables and Extractors](variables-and-extractors.md)) |

A request that never gets a response fails with its network cause, such as "Network error: could not resolve host api.example.com (ENOTFOUND)", "connection refused", or a TLS failure naming the certificate problem. The response body is kept up to 1 MiB: a larger body is cut there and marked truncated, with its full size when the server declared one. A body that is not UTF-8 text (an image, a PDF) is stored base64-encoded.

**Handles:** one input, one output.

### SSE Stream

**Purpose:** Starts a bounded Server-Sent Events listener for contract testing. It signals **Ready** only after the SSE handshake succeeds, so a downstream trigger can run without racing the subscription. It closes deliberately on an event cap, a matching finish trigger, timeout, cancellation, or workflow failure.

| Field | What it does |
| --- | --- |
| `url` | SSE endpoint URL. Supports environment, variable, and secret placeholders. |
| `query params` / `headers` | Optional structured request values. The node always sends `Accept: text/event-stream`; use headers for authenticated streams. |
| `event type` | Optional exact filter for the SSE `event:` field. Other events do not count toward the target. |
| `events to collect` | Maximum matching events retained (default 1; maximum 100). With no finish trigger, reaching this cap closes the connection. |
| `finish trigger` | Assertion-like rules evaluated against each matching event. All rules must match one event to close it. Paths support `event`, `id`, raw `data`, and JSON `data.*` fields. |
| `timeout` | Maximum time to wait, in seconds. Set to `0` only with a finish trigger to wait until that state arrives. |
| `follow redirects` / `verify TLS` | HTTP transport controls, both enabled by default. |
| `continue on fail` | Whether a failed stream test lets the run continue. |

The output body has `events`, `eventCount`, and `termination`. Each event records its `event` type, optional `id`, and exact `data` string, including multi-line data. A downstream Assertion can validate a frontend-facing payload directly, for example `response.body.events[0].data` or `response.body.eventCount`.

**Handles:** one input, two outputs. **Ready** runs after the handshake; **Complete** runs only after the final bounded result exists. Use the Complete path for a regular Assertion node that checks `response.body.events`.

#### OAuth 2.0

Choose **OAuth 2.0** on the node's **Auth** tab and the run fetches an access token before the request and sends it as `Authorization: Bearer <token>`. Two grant types:

- **Client credentials** is headless and works in the app and in the [CLI](../guides/ci.md). Set the token URL, the client ID, the client secret, and optionally a scope and an audience.
- **Authorization code (PKCE)** is for APIs that act on behalf of a user. Set the authorization URL as well, and name the secret the token is stored in. **Get token** opens your system browser to sign in. APIWeave receives the redirect on a one-time listener on `127.0.0.1` (an ephemeral port, closed after one callback or five minutes), checks the `state`, exchanges the code with the PKCE verifier, and seals the access and refresh token into that secret. The Auth tab then shows who the token was issued to (when the server sends an OpenID `id_token`) and when it expires; **Clear token** deletes it. Register `http://127.0.0.1/callback` as a redirect URI with your provider; RFC 8252 servers accept any port on the loopback address.

**Client authentication** sends the client ID and secret as an HTTP Basic header (the default) or as `client_id`/`client_secret` form fields.

The client secret and the token secret are secret *names*, stored in the workflow as `{{secrets.NAME}}`. A literal value is refused, so neither ever reaches the workflow file or an export. The token URL, client ID, scope and audience accept placeholders; **Get token** fills only `{{env.*}}` and `{{secrets.*}}`, since it runs outside a workflow run. Get token stores the token in the environment selected for the workflow, or in the workspace when none is.

During a run:

- A client-credentials token is reused across nodes and runs until 30 seconds before it expires (`expires_in`), for as long as the app is open. Tokens are never written to disk.
- An authorization-code token that has expired is refreshed with the refresh token, and the new token (and a rotated refresh token) is written back to the same secret.
- If the API answers `401`, the node fetches a fresh token and sends the request once more.
- Every token is masked as `<SECRET>` in run history, events and reports, like a secret.
- A run never opens a browser. When no token has been fetched, or it expired with no refresh token, the node fails with a message saying to use **Get token**. This also applies to runs an agent starts over MCP.

Token endpoint failures fail the node with the status and the OAuth error code, for example "OAuth 2.0 token request failed: HTTP 401 (invalid_client)". The token endpoint is listed among the destinations when an agent-started run asks to use your secrets.

#### Retry and polling

Workflows have no loops, so a request that has to be sent more than once says so itself, under **Settings → Retry**. This is how you test an async API: a `POST` that answers `202 Accepted`, then a `GET` on its status URL repeated until the job reports done.

| Retry field | What it does |
| --- | --- |
| `max attempts` | Total requests, the first included (1 to 100) |
| `interval` | Milliseconds to wait between attempts |
| `backoff` | `fixed` (default) waits the interval every time; `exponential` doubles it after each attempt |
| `max interval` | With exponential backoff, the longest a single wait may grow to |
| `until` | Assertion rules, the same rules an Assertion node takes, checked against **this request's own response**: `status`, `prev` (`response.body.status`), `headers`, `cookies`, or `variables` (extractors run on every attempt first). The request stops repeating once every rule passes |

With `until` rules, a response that does not satisfy them, a network error and a timeout are all retried. With no rules, only a network error, a timeout or a 5xx response is retried; a 4xx is final. A request that could not be sent at all (a URL that is not http(s), a body that would not build) is never retried.

Each attempt is a full request: placeholders are filled and extractors run again. The node's result is the last attempt's response, plus the list of attempts (status code or error, and duration); the output panel shows the attempt count, and the canvas node a ↻ chip once it took more than one. Whether the final response passes is still decided by the usual rule (any 2xx, or **Expected status**): `until` decides when to stop, not whether the node passed. When the rules never hold the node fails with "Condition not met after N attempts", and without rules with "Failed after N attempts: HTTP 503" or the network error. Cancelling the run stops a retry mid-wait. Run reports and `apiweave run` list a retried node's attempts.

A polling request for `{"status": "pending"}` → `{"status": "done"}`:

```json
"retry": {
  "maxAttempts": 20,
  "intervalMs": 2000,
  "until": [
    { "source": "status", "path": "", "operator": "equals", "expectedValue": 200 },
    { "source": "prev", "path": "response.body.status", "operator": "equals", "expectedValue": "done" }
  ]
}
```

**Expected status (negative tests).** By default a node passes on any 2xx status and fails on everything else. Set **Expected status** — for example `409` or `409, 422` — and that rule is fully replaced: the node passes only when the actual status matches one of the expected values, and fails otherwise, *even for a 2xx response*. This is how you assert a negative test ("the API must reject this with 409") on the request itself. A matched status renders as a green node showing the status text (for example `409 Conflict`). Use it instead of a `continueOnFail` flag plus a downstream assertion that pins a non-2xx status; `workflow_diagnose` suggests exactly that migration when it sees that pattern.

### Assertion

**Purpose:** Validates values from a previous node and branches the flow based on the result.

| Field | What it does |
| --- | --- |
| `assertions` | The list of assertion rules. Each rule has `source`, `path`, `operator`, and `expectedValue` — see below. All rules must pass for the node to pass |
| `failure mode` | `first` (report only the first failed rule) or `all` (report every failed rule) |
| `continue on fail` | Whether a failed assertion lets the run continue |

Each assertion rule:

| Rule field | What it does |
| --- | --- |
| `source` | Where the value comes from: `prev` (the upstream response object), `status`, `headers`, `cookies`, or `variables` |
| `path` | What it means depends on `source` — see the table below |
| `operator` | Comparison: `equals`, `notEquals`, `contains`, `notContains`, `gt`, `gte`, `lt`, `lte`, `count`, `exists`, `notExists` |
| `expectedValue` | Value to compare against (omitted for `exists` and `notExists`) |

| `source` | `path` |
| --- | --- |
| `status` | must be empty — compare the code with `expectedValue` |
| `prev` | a path into the response object: `response.body.<field>` (dot notation, `[0]` for array indexes), `response.headers.<name>`, `response.statusCode`, `response.duration` |
| `headers` / `cookies` / `variables` | just the name (`content-type`, `session`, `token`) — no `response.` prefix |

A bare field name is not a path: the value at the top of a JSON body is
`response.body.id`, not `id`. `count` takes a non-negative integer and compares
the length of an array or string; `status` accepts only the numeric comparison
operators.

**Handles:** one input, two outputs. `pass` fires when every rule passes; `fail` fires when at least one rule fails.

### Delay

**Purpose:** Pauses execution for a fixed time before continuing, useful for pacing rate-limited calls or giving a system time to settle. To poll until something is ready, use the HTTP request's [Retry](#retry-and-polling) instead: a Delay runs once, and a workflow cannot loop back through it.

| Field | What it does |
| --- | --- |
| `duration` | How long to wait, in milliseconds (default 1000) |
| `jitter` | Optional randomized window: when set, the runner waits a random time between `minMs` and `maxMs` instead of `duration` |
| `label` | Optional display name |

**Handles:** one input, one output.

### Merge

**Purpose:** Combines multiple parallel branches into a single downstream path using a strategy you choose.

| Field | What it does |
| --- | --- |
| `mergeStrategy` | `all` (wait for every branch), `any` (continue on the first completion), `first` (continue with the first branch that started), or `conditional` (continue based on per-branch conditions you configure) |
| `conditions` | Per-branch expressions, used only when `mergeStrategy = conditional`. Each is `{branchIndex, field, operator, value}` checked against that branch's result |
| `conditionLogic` | `AND` (every configured condition must hold) or `OR` (at least one must hold) |
| `label` | Optional display name |

**Handles:** many inputs (one per upstream branch), one output.

### Call Workflow

**Purpose:** Runs another workflow in the same workspace as a single step, so a flow you wrote once (a login, a tenant setup, a cleanup) is reused instead of duplicated.

| Field | What it does |
| --- | --- |
| `target workflow` | The workflow to run. The picker lists workflows in the current workspace and excludes the current one |
| `input mapping` | `target variable = caller expression`. Each entry names a variable the sub-workflow will read as `{{variables.NAME}}`, set from an expression resolved in the *caller's* context |
| `output mapping` | `caller variable = sub-workflow variable`. Each entry copies one of the sub-workflow's final variables back into the caller's scope |

**Handles:** one input, one output.

How the call behaves:

- **It runs inline, inside the current run.** There is no second entry in run history. The calling node's result carries a summary: the target, its status, how many nodes it had, how many failed, and which output variables were mapped back. Open the node to see it.
- **The sub-workflow shares the run's environment and secrets.** It resolves `{{env.*}}` and `{{secrets.*}}` on its own, so those need no mapping. Only workflow variables (`{{variables.*}}`) have to be passed, because each execution keeps its own variable map.
- **Secrets cannot be passed through an input mapping.** A `{{secrets.NAME}}` on the right-hand side fails the node rather than copying a secret value into a plain child variable. Let the sub-workflow read the secret directly.
- **The caller's variables only change where you asked.** An output mapping entry is applied when the sub-workflow actually produced that variable; anything you did not map stays inside the sub-workflow.
- **A failed sub-workflow fails the calling node**, which then follows its own **Continue on failure** setting like any other failure.

A login flow reused by a checkout flow:

```text
[ Start ] -> [ Call Workflow: Authenticate ] -> [ HTTP Request: POST /cart ] -> [ End ]
                       |
                       +-- input mapping:  tenant = {{variables.tenantId}}
                       +-- output mapping: authToken = accessToken
```

The checkout flow then uses `{{variables.authToken}}` in its own request headers.

**Cycle guards.** Saving a node whose target is in another workspace, or whose target is the calling workflow itself, is rejected. An indirect cycle (A calls B, B calls A) is *not* rejected at save time — you can create one by editing B after saving A, which no save-time check could catch. Instead the runner caps nesting at 8 levels and fails the node with "Call Workflow recursion depth exceeded", so a cycle ends the run cleanly instead of hanging it.

## Reusing a Node Configuration

Two ways to avoid rebuilding the same node:

- **Copy/paste** (`Ctrl+C` / `Ctrl+V`) duplicates a node inside the session you are working in. It does not survive a restart.
- **Presets** save a node's configuration under a name, in the workspace, permanently. Use the `⋯` menu on any configured node, choose **Save as preset**, and it appears in the **Saved Presets** section of the Add Nodes panel, ready to drag into any workflow in that workspace. See [Node Presets](node-presets.md) for the full flow, including rename, delete, and what a preset does and does not carry.

## Canvas Actions

The top toolbar exposes the actions that operate on the whole workflow.

| Action | What it does |
| --- | --- |
| **Save** | Flushes the workflow to disk immediately, bypassing the 700ms auto-save debounce (`Ctrl+S`). |
| **History** | Opens run history for the workflow, with per-run timeline and detail views. |
| **Run** | Executes the full workflow from the Start node. Picks the environment selected in the toolbar. Click **Cancel** while a run is in flight to stop it: the run is recorded as `cancelled`, the node it interrupted (a request, a delay, a merge still waiting) shows as skipped, and nothing after it runs. |
| **JSON editor** | Opens the workflow's `nodes`, `edges`, and `variables` in a raw JSON view for targeted edits. **Apply** (`Ctrl+S`) applies and saves them. Closing with unapplied changes (Escape, a click outside, or the close button) asks **Apply**, **Discard** or **Keep editing**; invalid JSON stays open with the error shown. |
| **Import** | Opens the import panel (OpenAPI/Swagger, HAR, cURL) to add nodes to the current workflow. |
| **Refresh** | Re-fetches Swagger or OpenAPI templates from the active environment's base URL. |

### Unsaved changes

A pending auto-save is never dropped: switching or closing a tab, and quitting the app, send it immediately. If the workflow still has unsaved changes after that — auto-save is turned off, or the save failed — switching to another tab keeps them as a draft on the tab, marked with the unsaved dot, and they are back on the canvas when you return. Closing a tab with unsaved changes, quitting, and linking or disconnecting the cloud account (which closes every tab) ask whether to **Save**, **Discard**, or **Cancel**, once per such tab; **Cancel** stops the close, the quit, the link, or the disconnect. A tab closed because its workflow was deleted closes without asking: there is nothing left to save to.

Every save is checked against the revision the canvas loaded. If the workflow changed elsewhere in the meantime — an agent over MCP, cloud sync, another window — the save is refused instead of overwriting that change, your edits stay on the canvas unsaved, and a notice offers **Load latest** (discard your edits and show the newer version) or **Overwrite** (save yours over it).

The node editor holds its edits until they are applied to the node. **Save**, the close button, Escape, a click outside the editor, and **Previous**/**Next** all apply them; only **Cancel** discards them. `Ctrl+S` inside the editor, including in its text fields, applies the edits and saves the workflow, leaving the editor open.

Resume-after-failure (run from failed node, rerun failed branches) is planned but not available in this release: **Run** always executes the full workflow from the Start node.

Failure handling is per node. By default a failed node stops the run along its path; other parallel branches still finish, and the run is marked failed. Turn on a node's **Continue on failure** (in its Settings tab) to let the run carry on past that node; the run is still marked failed.

## Keyboard Shortcuts

On macOS every `Ctrl` shortcut below uses `⌘` instead, except `Ctrl+Tab` and `Ctrl+Shift+Tab`, which stay on Control because `⌘Tab` switches apps. Press `?` on the canvas for the same list, with the keys your platform uses.

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New workflow |
| `Ctrl+S` | Flush to disk now (auto-save still runs in the background every 700ms). Inside the node editor, applies its edits first |
| `Ctrl+R` or `F5` | Run the active workflow |
| `Ctrl+K` | Open the command palette |
| `?` | Show the keyboard shortcuts |
| `Ctrl+W` | Close the active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+B` | Toggle the sidebar |
| `Ctrl+J` | Open the JSON editor |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Ctrl+C` | Copy the selected nodes and the edges between them (canvas context only). Copying a frame copies what it holds |
| `Ctrl+V` | Paste the copied nodes and edges, offset from the originals and selected (canvas context only) |
| `Ctrl+D` | Duplicate the selected nodes and the edges between them |
| `Delete` or `Backspace` | Delete the selected nodes |
| `Ctrl+G` | Group the selected nodes in a frame |
| `Ctrl+Shift+G` | Ungroup the selected frame |
| `Ctrl+Shift+Arrow` | Select the nearest node in that direction |

The copy and paste shortcuts are context-aware. When the cursor is inside a text editor (request body, response view, or any field in a node modal), normal text copy and paste take precedence.

## Recommended Build Pattern

1. Start with the happy path: Start, HTTP Request, End.
2. Add an Assertion after each critical call to lock in the contract.
3. Add a fail branch from each Assertion to a recovery or logging call, if you have one.
4. Add Delay and Merge nodes only when the flow actually needs them.
5. Pick the right environment from the toolbar.
6. Run and inspect node-level results before adding more complexity.

## Troubleshooting

- **If a node never runs**, the canvas has no edge from an upstream node into its input handle. Drag a connection from the previous node's output handle to this node's input handle.
- **If a run fails with "Workflow contains a cycle: A → B → A"**, the graph loops back on itself, usually from an edit in the JSON editor or by an agent. Remove one of the edges it names.
- **If a `{{secrets.X}}` placeholder shows up as plain text in the request**, the key is not declared in the selected environment or the workspace scope. Open **Secrets**, add the key through the Libsodium write flow, and re-run.
- **If paste drops a node on top of the source**, copy and paste are canvas-only; click on the canvas first so the focus is not in a text field.
- **If a Call Workflow node fails with "no target workflow configured"**, the node was dropped but never pointed at a workflow. Open it and pick a target from the picker.
- **If a Call Workflow node fails with "Called workflow … not found"**, its target workflow was deleted. Open the node and pick another target.
- **If a Call Workflow node fails with "recursion depth exceeded"**, the call graph loops (A calls B, B calls A) or nests deeper than 8 levels. Open the target chain and break the loop.
- **If a variable the sub-workflow produced is missing in the caller**, it was not in the output mapping, or the name on the right-hand side does not match the variable the sub-workflow actually ends with. Run the sub-workflow on its own and check its final variables.

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Node Presets](node-presets.md)
- [Projects](projects.md)
- [Environments and Secrets](environments-and-secrets.md)
