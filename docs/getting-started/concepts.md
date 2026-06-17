# Concepts

*Short definitions of every term you will see in the APIWeave 2.0 docs. Read this once before any feature guide, then come back to it as a glossary.*

## Prerequisites

- [Installation](installation.md) if you have not set up APIWeave yet.

## Table of Contents

- [Organization](#organization)
- [Team](#team)
- [Workspace](#workspace)
- [Project](#project)
- [Workflow](#workflow)
- [Node](#node)
- [Edge](#edge)
- [Environment](#environment)
- [Secret](#secret)
- [Service Token](#service-token)
- [Environment Protection](#environment-protection)
- [Approval](#approval)
- [Audit Event](#audit-event)
- [Run](#run)
- [Variable](#variable)
- [Extractor](#extractor)

## Organization

An organization is a multi-tenant owner of workspaces. A user can belong to one or more organizations with a role of `owner`, `member`, `billing`, or `security`. Organizations have a slug, used in every URL that touches their resources, and they own the workspaces, environments, projects, and service tokens that fall under their scope.

```text
Organization: "Acme"  slug: "acme"
  workspaces: 3
  members:    12
  teams:      4
```

## Team

A team is a named group inside an organization. Teams receive permission grants for workspaces, environments, secrets, and approval reviews. Outside collaborators can join a single workspace without becoming an organization member.

```text
Org: "Acme"
  Team: "Checkout"
    members: [alice, bob, carol]
    grants:
      workspace "checkout-api" -> write
      environment "production"  -> approve
```

## Workspace

A workspace is a container for workflows, projects, environments, secrets, and service tokens. Every user gets a personal workspace on first sign-in (`/personal/...`). An organization can own any number of additional workspaces. Each workspace has a slug, a name, and an owner type of `user` or `organization`. Workspace transfer is out of scope in 2.0.

```text
Workspace: "checkout-api"  slug: "checkout-api"  owner: org/acme
Workspace: "personal"      slug: "personal"      owner: user/alice
```

The URL pattern is always `/:orgSlug/:workspaceSlug/...` for organization-owned workspaces and `/personal/...` for the current user's personal workspace.

## Project

A project is a workspace-scoped, ordered group of workflows that run together. Projects replace the 1.0 collection concept. Each project carries a `workflowOrder`, a per-row `continueOnFail` flag, and a color tag for the sidebar. Projects export as `.awecollection` v2 bundles, which carry references only (no secret values, no per-scope private keys).

```text
Project: "Checkout API"  workspace: checkout-api
  1. Auth        (workflow)  continueOnFail: false
  2. Add to cart (workflow)  continueOnFail: false
  3. Pay         (workflow)  continueOnFail: true
```

## Workflow

A workflow is a graph of connected nodes that you build on the canvas. Every workflow belongs to exactly one workspace, and every workflow sits inside one of that workspace's projects. Workflows start with a Start node, run through the nodes you added, and end at one or more End nodes. A run selects exactly one environment; that environment must be visible to the workflow's workspace.

```text
[ Start ] -> [ HTTP Request ] -> [ Assertion ] -> [ End ]
```

## Node

A node is a single-purpose step inside a workflow. Each node type does one job: call an API, assert a value, wait, merge parallel branches, or mark a flow boundary. You drag nodes from the palette onto the canvas and configure them in their own panel or modal.

APIWeave ships six node types: **HTTP Request**, **Assertion**, **Delay**, **Merge**, **Start**, and **End**.

## Edge

An edge is the connection between two nodes that defines the order of execution. Edges go from an output handle of one node to an input handle of another. Without edges, the runner does not know which node comes next. Nodes with two output handles (such as Assertion, with `pass` and `fail`) use different edges to split the path.

## Environment

An environment is a named bundle of variables and a scope. Environments live at one of three scopes: `user`, `organization`, or `workspace`. A run selects exactly one environment explicitly, and the runner uses the variables and secrets visible to that environment. Organization environments restrict which workspaces can see them through an `allowedWorkspaceIds` allowlist. Each workspace has exactly one default environment.

```text
Environment: "Staging"  scope: workspace  default: true
  variables:
    BASE_URL    = https://api.staging.example.com
    API_VERSION = v1
```

## Secret

A secret is a sensitive value (API key, client secret, signing token) that you do not want stored in plain workflow configuration. Secrets live at one of four scopes: `user`, `organization`, `workspace`, or `environment`. The metadata-only display shows name, scope, key id, and last update time, never the value or ciphertext. The `{{secrets.NAME}}` placeholder resolves through a scope override chain: the selected environment wins, then the workspace, then the organization. User personal secrets participate only through an explicit binding record on a workspace or environment.

New secret values are submitted through a Libsodium sealed box encrypted against the scope's public key. The backend never accepts a plaintext secret value on a write path, and no UI, API, or MCP tool can read a stored value back. There is no runtime secret prompt in 2.0; the value must exist in the scope before the run starts.

```text
{{secrets.API_KEY}}       # resolved from the selected env, then workspace, then org
{{secrets.CLIENT_SECRET}} # same override chain, no plaintext on the wire
```

## Service Token

A service token is a scoped machine credential that replaces the 1.0 global `MCP_API_KEY` and the per-webhook credential pair. A token is bound to a workspace or organization scope, carries an explicit permission set, expires on a chosen date, and can be revoked, rotated, or narrowed without reissuing unrelated tokens. The raw token value is shown once at creation time and never again.

```text
Service token: "ci-runner"  scope: workspace/checkout-api
  permissions: workflows.read workflows.run runs.read
  expires: 2026-09-01
```

## Environment Protection

Environment protection is a policy attached to a workspace environment. It controls who must approve a run, whether the run initiator can self-approve, and whether a trusted service token can bypass the gate. A protected environment queues a run behind a `pending` approval record; the run executes once every required reviewer approves.

```text
Environment: "production"  scope: workspace  protected: true
  requiredReviewers: [alice, bob]
  allowSelfApproval: false
  bypassPolicy:      trusted_token_only
  bypassAllowlist:   [token/ci-release]
```

## Approval

An approval is the act of a required reviewer accepting or denying a pending run against a protected environment. The run queues until every required reviewer has approved. Self-approval is opt-in per environment. A run can be denied by any single required reviewer, and a denial writes to the audit log with the reviewer's identity.

## Audit Event

An audit event is an append-only record of a meaningful action: secret resolution, environment activation, protection decision, member change, service-token creation, webhook delivery, and more. The audit log is immutable, supports filters by actor, action, scope, resource type, and time range, and exports to JSON for offline retention.

```text
AuditEvent: actor=alice action=env.activate scope=workspace/3
  resource: environment/22  createdAt: 2026-06-17T11:02:14Z
```

## Run

A run is a single execution of a workflow or a project. A workflow run selects exactly one environment explicitly. A project run executes the project's workflows in order, each against its selected environment. The run captures the status of every node, the variables and responses produced, the timing, and any errors. The runner writes the run to the database and the UI polls its status.

```text
Run  run_4f9c  workflow "Login flow"  env: workspace/Staging
  nodes: 5 / 5  passed
  duration: 1.2s
```

## Variable

A variable is a named value you can drop into any field of a request, header, body, or assertion path. APIWeave resolves variables before the request goes out, using four namespaces plus dynamic functions.

| Namespace     | Example                       | Source                                                       |
| ------------- | ----------------------------- | ------------------------------------------------------------ |
| `variables.*` | `{{variables.token}}`         | workflow variable (manual or extracted)                      |
| `env.*`       | `{{env.BASE_URL}}`            | the selected environment                                    |
| `prev.*`      | `{{prev.response.body.id}}`   | previous node result (`prev[0]` after a merge)               |
| `secrets.*`   | `{{secrets.API_KEY}}`         | scope override chain (env > workspace > org)                 |

Dynamic functions are also available: `{{uuid()}}`, `{{randomString(12)}}`, `{{timestamp()}}`, and similar helpers.

## Extractor

An extractor is a rule on an HTTP Request node that pulls a value out of the response and stores it in a workflow variable. You give it a name and a JSONPath; after the node runs, the value is available as `{{variables.name}}` in any later node. Extractors are how you chain requests, pass tokens between steps, and feed data into assertions.

## Troubleshooting

- **If a placeholder like `{{env.BASE_URL}}` comes back as plain text in the response**, the selected environment does not define that key. Open Environments for the workspace, add the variable, and re-run.
- **If `{{secrets.NAME}}` resolves to empty**, no scope in the override chain declared that key, or the stored ciphertext cannot be decrypted. Open Secrets for the workspace, confirm the key exists on the right scope, and see the [Encryption Guide](../operations/encryption.md) for the at-rest key model.
- **If a workflow is missing from the canvas**, you are not in the workspace that owns it. Use the workspace switcher in the header to navigate to the right `org/workspace` pair.
- **If a project run is stuck in `pending approval`**, the environment is protected. Open the environment, see the [Environment Protection Guide](../operations/environment-protection.md), and either collect approvals or use a service token on the bypass allowlist.
- **If a node never runs**, the canvas has no edge from an upstream node into it. Drag a connection from the previous node's output handle to this node's input handle.

## Related

- [Installation](installation.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Projects](../features/projects.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [Placeholders Reference](../reference/placeholders.md)
