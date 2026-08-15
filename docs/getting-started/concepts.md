# Concepts

*Short definitions of every term you will see in the APIWeave docs. Read this once before any feature guide, then come back to it as a glossary.*

## Prerequisites

- [Installation](installation.md) if you have not set up APIWeave yet.

## Table of Contents

- [Workflow](#workflow)
- [Node](#node)
- [Edge](#edge)
- [Project](#project)
- [Workspace](#workspace)
- [Cloud Team and Cloud Workspace](#cloud-team-and-cloud-workspace)
- [Environment](#environment)
- [Secret](#secret)
- [Run](#run)
- [Variable](#variable)
- [Extractor](#extractor)

## Workflow

A workflow is a graph of connected nodes that you build on the canvas. Workflows start with a Start node, run through the nodes you added, and end at one or more End nodes. A run selects exactly one environment; that environment is the source of the variables and the scope of the secret lookup.

```text
[ Start ] -> [ HTTP Request ] -> [ Assertion ] -> [ End ]
```

## Node

A node is a single-purpose step inside a workflow. Each node type does one job: call an API, assert a value, wait, merge parallel branches, run another workflow, or mark a flow boundary. You drag nodes from the palette onto the canvas and configure them in their own panel or modal.

APIWeave ships seven node types: **HTTP Request**, **Assertion**, **Delay**, **Merge**, **Call Workflow**, **Start**, and **End**.

## Node Preset

A node preset is a node's configuration saved under a name and reusable across every workflow in the workspace — a standard auth header block, a house assertion set. Presets live in the local database, so they survive a restart, unlike copy/paste (session-only) and Swagger-imported palette groups (window-only). See [Node Presets](../features/node-presets.md).

## Base Environment

An environment can extend a **base environment** in the same workspace, inheriting its plain variables and overriding only the ones that differ (`base → staging → staging-eu`). Secrets are never inherited; they keep resolving through the fixed `environment > workspace` scope chain. See [Environment Inheritance](../features/environments-and-secrets.md#environment-inheritance).

## Edge

An edge is the connection between two nodes that defines the order of execution. Edges go from an output handle of one node to an input handle of another. Without edges, the runner does not know which node comes next. Nodes with two output handles (such as Assertion, with `pass` and `fail`) use different edges to split the path.

## Project

A project is a named, ordered list of workflows plus a per-workflow `continueOnFail` flag. Projects replace the older collection concept. Each project carries a `workflowOrder`, a per-row `continueOnFail` flag, and a color tag for the sidebar. Projects export as `.awecollection` bundles, which carry references only (no secret values, no private keys). One-click ordered project runs are on the roadmap; today you run each workflow on its own from the canvas.

```text
Project: "Checkout API"
  1. Auth        (workflow)  continueOnFail: true
  2. Add to cart (workflow)  continueOnFail: true
  3. Pay         (workflow)  continueOnFail: false
```

## Workspace

A workspace is the container for your workflows, environments, projects, and node presets on this machine. A personal workspace is created for you automatically, and you can create more. Workspaces are local structures — no account is required to use them.

## Cloud Team and Cloud Workspace

Optional APIWeave Cloud sync turns on when you sign in with a Cloud account. Cloud syncs test structure (workflows, environments, projects, and secret references) across machines and lets people collaborate in shared **Cloud Workspaces**, which belong to a **Cloud Team** from the Cloud account. Cloud never builds or runs tests, and it never holds run history or secret values. Signing in is optional: the desktop app is fully usable without a Cloud account, and each machine keeps its own secret values and run history either way.

## Environment

An environment is a named bundle of variables that you select before a run. The selected environment feeds `{{env.*}}` placeholders and is the narrowest scope the runner checks for `{{secrets.*}}`. Each environment can optionally pin a Swagger or OpenAPI document URL for the importer. The header's **Default environment** selector is a per-machine convenience preference for which environment is preselected.

```text
Environment: "Staging"
  variables:
    BASE_URL    = https://api.staging.example.com
    API_VERSION = v1
```

## Secret

A secret is a sensitive value (API key, client secret, signing token) that you do not want stored in plain workflow configuration. Secrets live at one of two scopes: **workspace** or **environment**. The metadata-only display shows name, scope, key id, and last update time — never the value or ciphertext. The `{{secrets.NAME}}` placeholder resolves through a scope chain: the selected environment wins, then the workspace secret store. Secret values are never synced, even when workflow structure is.

New secret values are submitted through a Libsodium sealed box encrypted against the install's public key. The main process never accepts a plaintext secret value on a write path, and no UI, IPC handler, or MCP tool can read a stored value back.

```text
{{secrets.API_KEY}}       # resolved from the selected env, then the workspace store
{{secrets.CLIENT_SECRET}} # same scope chain, no plaintext on the wire
```

## Run

A run is a single execution of a workflow. A workflow run uses exactly one environment: the one you select for that workflow. One-click ordered project runs are planned but not yet available. The run captures the status of every node, the variables and responses produced, the timing, and any errors. The runner writes the run to the database and the UI subscribes to a progress event stream over IPC.

```text
Run  run_4f9c  workflow "Login flow"  env: Staging
  nodes: 5 / 5  passed
  duration: 1.2s
```

## Variable

A variable is a named value you can drop into any field of a request, header, or body. APIWeave resolves variables before the request goes out, using four namespaces plus dynamic functions.

| Namespace     | Example                       | Source                                                       |
| ------------- | ----------------------------- | ------------------------------------------------------------ |
| `variables.*` | `{{variables.token}}`         | workflow variable (manual or extracted)                      |
| `env.*`       | `{{env.BASE_URL}}`            | the selected environment                                     |
| `prev.*`      | `{{prev.response.body.field}}`| previous node result (`prev[0]` after a merge)               |
| `secrets.*`   | `{{secrets.API_KEY}}`         | the scope chain (env > workspace)                             |

Dynamic functions are also available: `{{uuid()}}`, `{{randomString(12)}}`, `{{timestamp()}}`, and similar helpers.

## Extractor

An extractor is a rule on an HTTP Request node that pulls a value out of the response and stores it in a workflow variable. You give it a name and a JSONPath; after the node runs, the value is available as `{{variables.name}}` in any later node. Extractors are how you chain requests, pass tokens between steps, and feed data into assertions.

## Troubleshooting

- **If a placeholder like `{{env.BASE_URL}}` comes back as plain text in the response**, the selected environment does not define that key. Open **Environments**, add the variable, and re-run.
- **If `{{secrets.NAME}}` is not substituted**, no scope in the chain declared that key, or the stored ciphertext cannot be decrypted. Open **Secrets** and confirm the key exists on the right scope.
- **If a workflow is missing from the canvas**, it was deleted or lives in a different project. Use the sidebar to navigate to the right project.
- **If a node never runs**, the canvas has no edge from an upstream node into it. Drag a connection from the previous node's output handle to this node's input handle.

## Related

- [Installation](installation.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Projects](../features/projects.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [Placeholders Reference](../reference/placeholders.md)
