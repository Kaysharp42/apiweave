# Workflows and Nodes Guide

Use this guide to build, edit, and run APIWeave workflows on the canvas.

## Workflow Basics

A workflow is a graph of connected nodes.

- Each node does one job (request, assertion, delay, merge, and so on).
- Edges define execution order.
- You can run the full graph and inspect results per node.

## Create a Workflow

1. Open APIWeave.
2. Create a new workflow from the empty state or the Workflows panel.
3. APIWeave starts with a Start node.
4. Open the Add Nodes panel (plus button at bottom-right).
5. Drag nodes onto the canvas.
6. Connect nodes by dragging from one handle to another.

Tip: Save often from the top toolbar (`Save`) or use `Ctrl+S`.

## Canvas Actions

- `Run`: executes the active workflow.
- `History`: opens previous runs.
- `JSON`: opens the JSON editor.
- `Import`: opens import-to-nodes panel.
- `Refresh`: refreshes Swagger/OpenAPI templates from the selected environment.

Useful shortcuts:

- `Ctrl+N`: new workflow
- `Ctrl+S`: save
- `Ctrl+R` or `F5`: run
- `Ctrl+J`: JSON editor

## Node Types

### Start

- Entry point for execution.
- Has an output handle only.
- Usually one Start node per workflow.

### End

- Terminal node to stop a path.
- Has an input handle only.
- Use one or more End nodes for clear completion paths.

### HTTP Request

Main workhorse node for API calls.

Configure directly in the node body or double-click the node for the modal editor.

Common fields:

- Method: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- URL
- Query parameters (`key=value`, one per line)
- Headers (`key=value`, one per line)
- Cookies (`key=value`, one per line)
- Body (usually JSON text)
- Timeout (seconds)

You can use variable placeholders in all request fields.

### Assertion

Use assertions to validate previous results and branch logic.

- Supports checks on status, response body fields, headers, cookies, or workflow variables.
- Has two output handles:
  - `pass`: all assertions passed
  - `fail`: at least one assertion failed

Typical pattern:

`HTTP Request -> Assertion -> pass path / fail path`

### Delay

Adds a wait in milliseconds before continuing.

Use cases:

- polling intervals
- pacing calls to rate-limited APIs
- waiting for eventual consistency

### Merge

Combines parallel branches into one path.

Available strategies:

- `all`: wait for all branches
- `any`: continue when any branch completes
- `first`: continue with first completed branch
- `conditional`: continue based on merge conditions

Use merge when one node fans out into multiple branches and you need a single downstream step.

## Recommended Build Pattern

1. Start with the happy path.
2. Add assertion checks after critical HTTP calls.
3. Add fail branches for recovery or logging calls.
4. Add delay/merge only when needed.
5. Run and inspect node-level results before adding more complexity.

## Execution Tips

- Use clear node labels so run history is easy to read.
- Keep one responsibility per node.
- Validate each new branch quickly with a short test run.
- If a node fails, inspect its response panel before changing downstream logic.
