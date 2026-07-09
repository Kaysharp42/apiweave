# Workflows and Nodes

*How to build, edit, and run a workflow on the APIWeave canvas. Covers every node type, the canvas actions in the toolbar, resume behavior after a failed run, the keyboard shortcuts worth memorizing, and the local-first context every workflow lives in.*

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
- [Canvas Actions](#canvas-actions)
- [Resume Behavior](#resume-behavior)
- [Lineage Hydration on Repeated Resume](#lineage-hydration-on-repeated-resume)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Recommended Build Pattern](#recommended-build-pattern)

## Where Workflows Live

Every workflow in APIWeave belongs to a project on your local machine. The sidebar lists every project and every workflow in the project. The selected workflow is the one shown on the canvas. Use the sidebar to navigate; the canvas does not have multi-tenant routing.

Workflows are members of a project. A workflow can be inside one project at a time, and the project decides the run order. See [Projects](projects.md) for the grouping flow and the `.awecollection` export.

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

APIWeave ships six node types. Each does one job. Two of them (Start, End) mark flow boundaries; the rest do work.

### Start

**Purpose:** Marks the entry point of the workflow; the runner begins here on every run.

| Config | What it does |
| --- | --- |
| `label` | Optional display name shown on the canvas |
| `metadata` | Optional key/value pairs for your own organization |

**Handles:** output only. One workflow should have exactly one Start node.

### End

**Purpose:** Marks the terminal point of a path. A workflow can have more than one End node for different success or cleanup paths.

| Config | What it does |
| --- | --- |
| `label` | Optional display name shown on the canvas |
| `metadata` | Optional key/value pairs for your own organization |

**Handles:** input only. When a run reaches an End node, that path is considered complete.

### HTTP Request

**Purpose:** Sends an HTTP call to an upstream service and optionally extracts values from the response into workflow variables.

| Field | What it does |
| --- | --- |
| `method` | `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, or `OPTIONS` |
| `url` | Full request URL. Supports placeholders like `{{env.BASE_URL}}/users` and `{{secrets.API_KEY}}` |
| `query params` | `key=value`, one per line |
| `headers` | `key=value`, one per line |
| `cookies` | `key=value`, one per line |
| `body` | Usually JSON text; supports placeholders in any field |
| `timeout` | Request timeout in seconds |
| `extractors` | List of `{name, path}` pairs that pull values from the response into workflow variables (see [Variables and Extractors](variables-and-extractors.md)) |

**Handles:** one input, one output.

### Assertion

**Purpose:** Validates values from a previous node and branches the flow based on the result.

| Field | What it does |
| --- | --- |
| `source` | Where the value comes from: `status`, `response.body`, `response.headers`, `response.cookies`, or `variables` |
| `path` | JSONPath inside the source (for example `response.body.user.id` or `response.statusCode`) |
| `operator` | Comparison: `equals`, `not equals`, `contains`, `not contains`, `greater than`, `less than`, `exists`, `not exists`, `matches regex`, `is empty` |
| `expected` | Value to compare against (skipped for `exists`, `not exists`, `is empty`) |
| `rules` | Multiple assertion rules on the same node. All rules must pass for the node to pass |

**Handles:** one input, two outputs. `pass` fires when every rule passes; `fail` fires when at least one rule fails.

### Delay

**Purpose:** Pauses execution for a fixed time before continuing, useful for polling or pacing rate-limited calls.

| Field | What it does |
| --- | --- |
| `duration` | How long to wait, in milliseconds |
| `label` | Optional display name |

**Handles:** one input, one output.

### Merge

**Purpose:** Combines multiple parallel branches into a single downstream path using a strategy you choose.

| Field | What it does |
| --- | --- |
| `strategy` | `all` (wait for every branch), `any` (continue on the first completion), `first` (continue with the first branch that started), or `conditional` (continue based on per-branch conditions you configure) |
| `conditions` | Per-branch expressions, used only when `strategy = conditional` |
| `label` | Optional display name |

**Handles:** many inputs (one per upstream branch), one output.

## Canvas Actions

The top toolbar exposes the actions that operate on the whole workflow.

| Action | What it does |
| --- | --- |
| **Run** | Executes the full workflow from the Start node. Picks the environment selected in the toolbar. |
| **Run from failed** | Resumes the most recent failed run from the first failed node. Only available when the latest run failed. |
| **Run all failed nodes and continue** | Resumes from every failed node in the latest failed run, then continues downstream. |
| **Run from this node** | Resumes from a specific failed node (entry appears per failed node). |
| **JSON editor** | Opens the workflow's `nodes`, `edges`, and `variables` in a raw JSON view for targeted edits. |
| **Import** | Opens the import panel (OpenAPI/Swagger, HAR, cURL) to add nodes to the current workflow. |
| **Refresh** | Re-fetches Swagger or OpenAPI templates from the active environment's base URL. |

The Run dropdown hides resume options when the latest run succeeded. They reappear the next time a run ends in a failed state.

## Resume Behavior

Resume reuses what already worked and only re-executes what is needed.

- **Variables and successful results carry over.** Workflow variables and the results of any node that passed before the failure are kept, so a resumed node can still read them.
- **One failed node or many.** Use *Run from failed* to retry a single failed node, or *Run all failed nodes and continue* to retry every failed branch in parallel and keep going downstream.
- **Lineage-aware retries.** If resume attempt A fails and attempt B fails again, the next resume still hydrates context from the earliest successful upstream attempt. You do not have to start from zero unless you want to.
- **Success locks the options out.** When the latest run succeeds, the resume actions hide until a new failure occurs. If you want a clean re-run, click **Run** instead.

`continueOnFail` is a per-workflow setting in the workflow settings panel. With `continueOnFail = false` (default), the runner stops at the first error. With `continueOnFail = true`, the runner logs the error and keeps going, tracking failed node IDs for the resume actions above.

## Lineage Hydration on Repeated Resume

*Run from failed* targets the latest failed run, and it keeps working when a resumed run fails again. The runner treats the chain of attempts as a single lineage rather than discarding earlier work, so a `run -> fail -> resume -> fail -> resume` cycle never forces you to start from zero.

The current run links back to its source through `resumeFromRunId`. On resume, the executor walks that chain from the most recent attempt back to the original run, then hydrates workflow variables and successful node results in order. Variables from the newest attempt win, but anything the original run produced stays readable, and only the nodes that still fail are re-executed.

The walk is bounded by the `resumeFromRunId` link, so it cannot loop forever. Use *Run* (not resume) when you want a clean execution with no inherited state.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New workflow |
| `Ctrl+S` | Save (auto-save also runs in the background; this is a manual flush) |
| `Ctrl+R` or `F5` | Run the active workflow |
| `Ctrl+J` | Open the JSON editor |
| `Ctrl+C` | Copy the selected node (canvas context only) |
| `Ctrl+V` | Paste a copied node (canvas context only) |

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
- **If the Run dropdown only shows plain Run** and no resume options, the latest run succeeded. Resume actions are hidden on success. Use **Run** for a fresh execution, or introduce a failure to bring them back.
- **If Run from failed replays too much of the workflow**, the failed node sits upstream of nodes whose results you wanted to keep. Re-run the whole flow, or split the workflow so the failing call is isolated.
- **If a `{{secrets.X}}` placeholder shows up as plain text in the request**, the key is not declared in any scope in the chain. Open **Secrets** for the selected environment or your user store, add the key through the Libsodium write flow, and re-run.
- **If paste drops a node on top of the source**, copy and paste are canvas-only; click on the canvas first so the focus is not in a text field.

## Related

- [Concepts](../getting-started/concepts.md)
- [Variables and Extractors](variables-and-extractors.md)
- [Projects](projects.md)
- [Environments and Secrets](environments-and-secrets.md)
