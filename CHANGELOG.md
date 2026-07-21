# Changelog

A record of notable changes to APIWeave. The current product is the local-first
Electron desktop app; the earlier self-hostable web application was retired and
its stack removed. Entries below describe the current desktop surface. A
separate **Retired surface** note at the end lists what was removed, for anyone
coming from an earlier build.

The format follows [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## Current — local-first desktop

APIWeave is a single-process Electron app. The renderer is the ReactFlow canvas;
the Electron main process owns the IPC handler registry, the workflow executor,
the SQLite store, the encrypted secret store, and the local MCP bridge. There is
no separate backend, worker, or database server, and no Docker stack to run.

### Added

- **Local-first single process.** Workflows, projects, environments, runs, and
  secrets live in a single SQLite database file under the OS user data
  directory. No account is required to use the app.
- **Visual workflow canvas.** ReactFlow canvas with drag and drop, 700ms
  debounced auto-save, adaptive polling, copy and paste of nodes, and persistent
  node templates. A **Save** toolbar button and the `Ctrl+S` shortcut flush the
  workflow to disk immediately, bypassing the debounce; auto-save still runs in
  the background.
- **Six node types.** HTTP Request, Assertion, Delay, Merge, Start, and End.
- **Workflow variables and extractors.** JSONPath extractors pull values from a
  response into workflow variables; four placeholder namespaces plus dynamic
  functions resolve values before a request goes out.
- **Projects.** Ordered groups of workflows with a per-workflow `continueOnFail`
  flag and a color tag. Projects export as `.awecollection` bundles that carry
  references only — never secret values, ciphertext, or per-scope private keys.
  A workflow belongs to at most one project at a time, or to none.
- **Environments.** Named bundles of variables that you select for a run. The
  effective environment feeds `{{env.*}}` and is the narrowest scope the runner
  checks for `{{secrets.*}}`. Each workspace has exactly one default environment
  (`isDefault = true`); a run uses the environment you select for that workflow,
  or falls back to the default when you have not selected one.
- **Encrypted secret store.** Per-scope Libsodium sealed-box ingress plus
  envelope encryption at rest. The keyfile is stored under the user's app data
  directory. The `{{secrets.NAME}}` placeholder resolves through a local scope
  chain: the selected environment wins, then the workspace store
  (`environment > workspace`). The metadata-only display shows name, scope, key id,
  and last update time — never the value or ciphertext. There is no read API
  for stored secret values reachable by a user, IPC handler, or MCP tool.
- **In-process runner.** The `RunScheduler` claims pending runs, the
  `WorkflowExecutor` walks the node graph, `safe_http` makes outbound HTTP
  calls with SSRF guards, and `dynamic_functions` evaluates placeholder
  functions. Progress streams to the renderer over IPC; no polling. Large
  response payloads live in a separate blob table.
- **Resume and lineage.** A failed run can be resumed from a node; the resume
  walk is bounded by the `resumeFromRunId` link so it cannot loop forever.
- **Local MCP bridge.** An opt-in loopback HTTP server at `127.0.0.1:<port>`
  exposes the IPC handler registry as a second transport so local AI agents on
  the same machine can drive the app. It uses a static per-install token and is
  off by default. No remote trigger, no webhook, no public port.
- **Import.** OpenAPI 3.x, Swagger 2.0, HAR, and cURL import.
- **Optional APIWeave Cloud sync.** An optional Cloud account enables two-way
  sync of test structure (workflows, environments, projects, and secret
  references) and collaboration in shared Cloud Workspaces across machines. The
  local and Cloud names map: a desktop org corresponds to a Cloud Team, and a
  desktop team corresponds to a Cloud Workspace. The desktop app is fully usable
  without a Cloud account. Cloud never builds or runs tests, never stores run
  history, and rejects `secrets` and `runs` fields on sync and conflict paths.
- **Keyboard shortcuts and dark mode.** `Ctrl+N`, `Ctrl+S` (flush to disk now;
  auto-save still runs), `Ctrl+R`/`F5` (run), `Ctrl+J` (JSON editor), plus
  context-aware copy and paste.

### Security

- Secrets are write-only at every layer. Plaintext secret values are never
  accepted on a write path and can never be read back through any UI, IPC
  handler, or MCP tool.
- The masking layer scrubs every resolved secret value before persistence, so
  run history never holds plaintext.
- The MCP bridge is loopback-only and token-gated; the token is treated like a
  private key.
- Secret values and run history are never synchronized to Cloud.

## Retired surface

The earlier self-hostable web application was retired and its stack removed.
The following, present in earlier builds, are gone and not coming back to the
desktop app:

- The Python backend, FastAPI, Beanie, Motor, and the separate worker.
- MongoDB and GridFS storage.
- The Docker Compose self-hosting stack.
- Webhooks, HMAC webhook execution, and remote triggers.
- The multi-tenant organization/workspace/member model, outside collaborators,
  invites, and the append-only audit log.
- Scoped service tokens, environment protection with required reviewers, and
  the trusted-token bypass.
- OAuth/OIDC and SSO login on the desktop side (Cloud login is a separate,
  optional Cloud account, not part of the desktop process).
- The `SECRET_ENCRYPTION_KEY` server env var, per-instance DEK/KEK envelope
  model, and the `environment > workspace > organization` secret scope chain.
  The desktop uses a per-install keyfile and the `environment > workspace` local
  scope chain.
- `runtime_secrets` ad-hoc run-time secret input. Every secret must exist in the
  local store at the right scope before a run starts.
- The global `Environment.isActive` flag. The single global "one active
  environment" model is gone, replaced by a per-workspace default (`isDefault`)
  plus a per-workflow selection that overrides the default for that run.
- The flat `/api/environments`, `/api/collections`, `/api/workflows`,
  `/api/webhooks`, and `/api/runs` HTTP paths and the
  `/api/orgs/{orgSlug}/...` scoped paths. The desktop renderer talks to the
  main process over a typed IPC channel; it does not call a separate HTTP
  backend.

Migration from the retired web surface to the local-first desktop app is a
clean install. There is no automatic upgrade path from the retired stack. See
[Installation](docs/getting-started/installation.md) and
[Architecture](docs/reference/architecture.md) for the current product.