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
4. Connect nodes by dragging from the output handle of one node to the input handle of the next.
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

APIWeave ships seven node types. Each does one job. Two of them (Start, End) mark flow boundaries; the rest do work.

### Start

**Purpose:** Marks the entry point of the workflow; the runner begins here on every run.

| Config | What it does |
| --- | --- |
| `label` | Optional display name shown on the canvas |
| `metadata` | Optional key/value pairs for your own use |

**Handles:** output only. One workflow should have exactly one Start node.

### End

**Purpose:** Marks the terminal point of a path. A workflow has exactly one End node — converge success and cleanup paths on it rather than adding a second, which `workflow_diagnose` reports as `duplicate_end_node`.

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
| `auth` | Optional auth scheme: bearer token, basic credentials, or API key. Supports placeholders |
| `body` | Body type: none, JSON, raw, form-data (with optional file uploads), x-www-form-urlencoded, or binary. Supports placeholders in any field |
| `timeout` | Request timeout in seconds |
| `follow redirects` | Whether redirect responses are followed (on by default) |
| `verify SSL` | Whether the TLS certificate is verified (on by default) |
| `expected status` | Optional expected status code or comma-separated list (see below) |
| `continue on fail` | Per-node override of the workflow's `continueOnFail` setting |
| `extractors` | List of `{name, path}` pairs that pull values from the response into workflow variables (see [Variables and Extractors](variables-and-extractors.md)) |

**Handles:** one input, one output.

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

**Purpose:** Pauses execution for a fixed time before continuing, useful for polling or pacing rate-limited calls.

| Field | What it does |
| --- | --- |
| `duration` | How long to wait, in milliseconds (default 1000) |
| `jitter` | Optional randomized window: the runner waits `duration` plus a random amount between `minMs` and `maxMs` |
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
- **A failed sub-workflow fails the calling node**, which then follows the workflow's `continueOnFail` setting like any other failure.

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
| **Run** | Executes the full workflow from the Start node. Picks the environment selected in the toolbar. Click **Cancel** while a run is in flight to stop it. |
| **JSON editor** | Opens the workflow's `nodes`, `edges`, and `variables` in a raw JSON view for targeted edits. |
| **Import** | Opens the import panel (OpenAPI/Swagger, HAR, cURL) to add nodes to the current workflow. |
| **Refresh** | Re-fetches Swagger or OpenAPI templates from the active environment's base URL. |

Resume-after-failure (run from failed node, rerun failed branches) is planned but not available in this release: **Run** always executes the full workflow from the Start node.

`continueOnFail` is a per-workflow setting in the workflow settings panel. With `continueOnFail = false` (default), the runner stops at the first error. With `continueOnFail = true`, the runner logs the error and keeps going. Individual HTTP Request and Assertion nodes can override the workflow setting.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New workflow |
| `Ctrl+S` | Flush to disk now (auto-save still runs in the background every 700ms) |
| `Ctrl+R` or `F5` | Run the active workflow |
| `Ctrl+J` | Open the JSON editor |
| `Ctrl+C` | Copy the selected node (canvas context only) |
| `Ctrl+V` | Paste a copied node (canvas context only) |
| `Ctrl+D` | Duplicate the selected node |

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
- **If a `{{secrets.X}}` placeholder shows up as plain text in the request**, the key is not declared in the selected environment or the workspace scope. Open **Secrets**, add the key through the Libsodium write flow, and re-run.
- **If paste drops a node on top of the source**, copy and paste are canvas-only; click on the canvas first so the focus is not in a text field.
- **If a Call Workflow node fails with "no target workflow configured"**, the node was dropped but never pointed at a workflow. Open it and pick a target from the picker.
- **If a Call Workflow node fails with "recursion depth exceeded"**, the call graph loops (A calls B, B calls A) or nests deeper than 8 levels. Open the target chain and break the loop.
- **If a variable the sub-workflow produced is missing in the caller**, it was not in the output mapping, or the name on the right-hand side does not match the variable the sub-workflow actually ends with. Run the sub-workflow on its own and check its final variables.

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Node Presets](node-presets.md)
- [Projects](projects.md)
- [Environments and Secrets](environments-and-secrets.md)
