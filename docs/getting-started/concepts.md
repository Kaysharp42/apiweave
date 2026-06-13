# Concepts

*Short definitions of every term you will see in the APIWeave docs. Read this once before any feature guide, then come back to it as a glossary.*

## Prerequisites

- [Installation](installation.md) if you have not set up APIWeave yet.

## Table of Contents

- [Workflow](#workflow)
- [Node](#node)
- [Edge](#edge)
- [Environment](#environment)
- [Collection](#collection)
- [Run](#run)
- [Variable](#variable)
- [Extractor](#extractor)
- [Secret](#secret)

## Workflow

A workflow is a graph of connected nodes that you build on the canvas. It starts with a Start node, runs through the nodes you added, and ends at one or more End nodes. Workflows are what you save, open, and run; the canvas always shows one workflow at a time.

```text
[ Start ] -> [ HTTP Request ] -> [ Assertion ] -> [ End ]
```

## Node

A node is a single-purpose step inside a workflow. Each node type does one job: call an API, assert a value, wait, merge parallel branches, or mark a flow boundary. You drag nodes from the palette onto the canvas and configure them in their own panel or modal.

APIWeave ships six node types: **HTTP Request**, **Assertion**, **Delay**, **Merge**, **Start**, and **End**.

```text
[ HTTP Request ]  method = POST  url = {{env.BASE_URL}}/login
```

## Edge

An edge is the connection between two nodes that defines the order of execution. Edges go from an output handle of one node to an input handle of another. Without edges, the runner does not know which node comes next. Nodes with two output handles (such as Assertion, with `pass` and `fail`) use different edges to split the path.

```text
[ Assertion ] -- pass --> [ HTTP Request (next call) ]
[ Assertion ] -- fail --> [ HTTP Request (cleanup)   ]
```

## Environment

An environment is a named bundle of variables and secret keys that you attach to a workflow before running it. The same workflow can point at different environments to run against staging, production, or a local server without changing the canvas. Environments also let you pin a Swagger or OpenAPI URL for quick import.

```text
Environment: "Staging"
  variables:
    BASE_URL   = https://api.staging.example.com
    API_VERSION = v1
```

## Collection

A collection is an ordered group of workflows that run together, usually because they cover the same feature, service, or release. You set the run order once, decide whether to keep going or stop on the first failure, and then trigger the whole collection as a single unit.

```text
Collection: "Checkout API"
  1. Auth        (workflow)
  2. Add to cart (workflow)
  3. Pay         (workflow)
  stop on first failure: true
```

## Run

A run is a single execution of a workflow or a collection. It captures the status of every node, the variables and responses produced, the timing, and any errors. The runner writes the run to the database and the UI polls its status so you can see progress and inspect node-level results after it finishes.

```text
Run  run_4f9c  workflow "Login flow"  status = success
  nodes: 5 / 5  passed
  duration: 1.2s
```

## Variable

A variable is a named value you can drop into any field of a request, header, body, or assertion path. APIWeave resolves variables before the request goes out, using four namespaces plus dynamic functions. Namespaces are tried in this order: workflow variables, environment variables, then the previous node result. Secrets are handled separately; see the Secret section.

| Namespace     | Example                       | Source                                                       |
| ------------- | ----------------------------- | ------------------------------------------------------------ |
| `variables.*` | `{{variables.token}}`         | workflow variable (manual or extracted)                      |
| `env.*`       | `{{env.BASE_URL}}`            | active environment                                           |
| `prev.*`      | `{{prev.response.body.id}}`   | previous node result (`prev[0]` after a merge)               |
| `secrets.*`   | `{{secrets.API_KEY}}`         | runtime-entered value (not yet supported in 1.0)             |

Dynamic functions are also available: `{{uuid()}}`, `{{randomString(12)}}`, `{{timestamp()}}`, and similar helpers.

## Extractor

An extractor is a rule on an HTTP Request node that pulls a value out of the response and stores it in a workflow variable. You give it a name and a JSONPath; after the node runs, the value is available as `{{variables.name}}` in any later node. Extractors are how you chain requests, pass tokens between steps, and feed data into assertions.

```text
HTTP Request: POST /login  ->  200 OK { "access_token": "abc123" }

Extractor:
  name = token
  path = response.body.access_token

Later node:
  Authorization: Bearer {{variables.token}}
```

## Secret

A secret is a sensitive value, such as an API key or client secret, that you do not want stored in plain workflow configuration. The data model for secrets exists today, and you can declare secret keys inside an environment, but the runtime prompt and resolution of `{{secrets.NAME}}` placeholders are **not yet implemented in APIWeave 1.0**. Treat the secret namespace as a known gap until the runtime flow ships.

```text
{{secrets.API_KEY}}       # declared in env, not yet resolved at run time
{{secrets.CLIENT_SECRET}} # declared in env, not yet resolved at run time
```

## Troubleshooting

- **If a placeholder like `{{env.BASE_URL}}` comes back as plain text in the response**, the active environment does not define that key. Open the Environment Manager, add the variable, and re-run.
- **If `{{variables.token}}` is empty even though the request succeeded**, the extractor name and the placeholder name do not match, or the extractor path does not point at the real response field. Open the Variables panel to inspect what was stored.
- **If `{{secrets.X}}` does not resolve**, runtime secret resolution is not yet supported in 1.0. Use an environment variable for now and follow the release notes for the secret flow.
- **If a node never runs**, the canvas has no edge from an upstream node into it. Drag a connection from the previous node's output handle to this node's input handle.

## Related

- [Installation](installation.md)
- [Workflows and Nodes](features/workflows-and-nodes.md)
- [Placeholders Reference](reference/placeholders.md)
