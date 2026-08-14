# Changelog

A record of notable changes to APIWeave. The current product is the local-first
Electron desktop app; the earlier self-hostable web application was retired and
its stack removed. Entries below describe the current desktop surface. A
separate **Retired surface** note at the end lists what was removed, for anyone
coming from an earlier build.

The format follows [Keep a Changelog](https://keepachangelog.com/) and this
project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.8] — 2026-08-14

### Added

- **Run camera.** While a run executes, the canvas camera follows the active
  branch with a physics-based tracker (attention focus plus damped spring) that
  tracks one run front at a time. Any manual zoom, pan, or fit-view suspends the
  follow immediately; a **Follow run** pill on the canvas hands control back.
  The minimap freezes while the camera is in motion and unfreezes the moment you
  take over.
- **Expected status on HTTP Request.** A per-node `expectedStatus` (one code or
  a comma-separated list, e.g. `409` or `409, 422`) fully replaces the default
  2xx-passes rule, turning the request itself into a negative test: a match
  passes (a matched 409 renders green with its status text), anything else —
  even a 2xx — fails. The expected status is echoed on transport errors and
  persisted in run results. The analyzer suggests this control over the
  `continueOnFail`-plus-status-assertion pattern
  (`continue_on_fail_status_check_migratable`), and a new
  `assertion_fail_wired_on_all` notice flags assertion `fail` handles that all
  land on `end` (same behavior as leaving them unconnected).
- **Private networks opt-in.** A new **Settings → Private networks** toggle
  (off by default) lifts the SSRF block on RFC1918/unique-local hosts (`10/8`,
  `172.16/12`, `192.168/16`, `fc00::/7`) for HTTP request nodes and URL imports
  through the one shared `SafeHttp` instance; link-local, metadata, and
  multicast addresses stay blocked either way. The choice is persisted under
  `app_settings` (`http.allow_private_networks`) through new
  `settings.get` / `settings.setPrivateNetworks` handlers, and takes effect
  immediately.
- **Auto-update.** The desktop app checks GitHub Releases for newer versions
  under the policy chosen in **Settings → Updates** (notify by default;
  automatic only where the platform can self-install), with staged rollouts and
  a kill switch for bad releases.
- **Sync failure visibility.** `cloud.listFailedRecords` plus an in-app Failed
  Records dialog surface dead-lettered sync records; rejected IPC dispatches are
  logged to `main.log`; the real server rejection reason reaches save toasts
  instead of a generic failure.

### Fixed

- **Workflow last run disappearing.** Opening a node's editor after a run no
  longer drops the last run's results from the canvas.
- **Sync credential redaction.** Push, pull, and export now share one redaction
  contract: request bodies and headers sync with leaf-level credential
  redaction (secret-shaped leaves blanked, `{{...}}` references preserved),
  cookie values are always withheld, URLs are stripped of credentials, and a
  fail-closed `assertNoSecretValues` pass runs on every outgoing payload.
  `.awecollection` export redacts bundle bodies leaf-by-leaf with the same walk.

### Security

- The renderer CSP now pins `wasm-unsafe-eval`, closing a vector on the
  packaged renderer.

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
- **Seven node types.** HTTP Request, Assertion, Delay, Merge, Call Workflow,
  Start, and End.
- **Call Workflow node.** Runs another workflow in the same workspace inline as
  one step, mapping caller variables in and the sub-workflow's variables back
  out. The sub-workflow shares the run's environment and secrets, so only
  `{{variables.*}}` need mapping, and a `{{secrets.*}}` reference in an input
  mapping is refused rather than copied into a plain child variable. Execution
  is inline: no child run row and no new run-history surface, with the calling
  node's result carrying the sub-workflow summary. A cross-workspace target or a
  direct self-call is rejected on save; nesting is capped at 8 levels so a cycle
  created by editing a target later fails the node cleanly instead of hanging.
- **Node presets.** A workspace-scoped library of saved node configurations
  (`node_presets` table, `nodePresets.*` IPC domain, `nodePresets_*` MCP tools).
  Save any configurable node from its `⋯` menu, then drag it onto any canvas in
  the workspace; rename and delete from the palette. Configs are canonicalised
  and validated against the node type on write. Presets are local-only — there
  is no sync record type for them, so they never leave the machine.
- **Workflow variables and extractors.** JSONPath extractors pull values from a
  response into workflow variables; four placeholder namespaces plus dynamic
  functions resolve values before a request goes out.
- **Projects.** Ordered groups of workflows with a per-workflow `continueOnFail`
  flag and a color tag. Projects export as `.awecollection` bundles that carry
  references only — never secret values, ciphertext, or per-scope private keys.
  A workflow belongs to at most one project at a time, or to none.
- **Environments.** Named bundles of variables that you select for a run. The
  effective environment feeds `{{env.*}}` and is the narrowest scope the runner
  checks for `{{secrets.*}}`. The header's **Default environment** selector is a
  per-machine convenience preference that preselects the environment for new
  workflows; each workflow keeps its own selection.
- **Environment inheritance.** An environment can extend a base environment in
  the same workspace (`baseEnvironmentId`), and the run resolves the chain
  base-first with each descendant overriding the names it redefines. Plain
  variables only — the `environment > workspace` secret scope chain is
  unchanged and secrets are never inherited. Self-reference, cross-workspace
  bases, and cycles are rejected, and chains are bounded at 8 levels. The base
  link is not yet part of the Cloud sync payload, so it stays on this machine.
- **Encrypted secret store.** Libsodium sealed-box write-only ingress against a
  single per-install keypair; the sealed ciphertext is stored verbatim and
  opened at run time with the key derived from the per-install keyfile. The
  `{{secrets.NAME}}` placeholder resolves through a local scope
  chain: the selected environment wins, then the workspace store
  (`environment > workspace`). The metadata-only display shows name, scope, key id,
  and last update time — never the value or ciphertext. There is no read API
  for stored secret values reachable by a user, IPC handler, or MCP tool.
- **In-process runner.** The `RunScheduler` claims pending runs, the
  `WorkflowExecutor` walks the node graph, `safe_http` makes outbound HTTP
  calls with SSRF guards, and `dynamic_functions` evaluates placeholder
  functions. Progress streams to the renderer over IPC; no polling. Large
  response payloads live in a separate blob table. A node that two paths
  converge on is entered once: the second arrival joins the first instead of
  re-sending the request and re-walking the subtree behind it.
- **Resume groundwork.** Run records carry `resumeFromRunId` / `resumeFromNodeIds`
  lineage links and the executor supports starting from chosen node ids, but the
  resume UI is not exposed in this release: **Run** always executes the full
  workflow from Start.
- **Local MCP bridge.** An opt-in loopback HTTP server at `127.0.0.1:<port>`
  exposes the IPC handler registry as a second transport so local AI agents on
  the same machine can drive the app. It uses a static per-install token and is
  off by default. No remote trigger, no webhook, no public port.
- **Import.** OpenAPI 3.x, Swagger 2.0, HAR, and cURL import.
- **Optional APIWeave Cloud sync.** An optional Cloud account enables two-way
  sync of test structure (workflows, environments, projects, and secret
  references) and collaboration in shared Cloud Workspaces (owned by a Cloud
  Team) across machines. The desktop app is fully usable
  without a Cloud account. Cloud never builds or runs tests, never stores run
  history, and rejects `secrets` and `runs` fields on sync and conflict paths.
- **Cloud conflict resolution.** When a local and a Cloud copy diverge, the
  conflict list shows a semantic diff per field, detection time, and the
  author of the Cloud-side change. Resolutions cover keep-local, take-remote,
  and field-level picking; mergeable conflicts auto-merge, and conflicts
  resolved on another machine are reconciled on the next sync.
- **Team-aware workspace switching.** The workspace switcher labels every
  workspace with its source (Personal workspace, Personal Cloud space,
  Team · <Team name>, On this device) so duplicate names stay distinguishable.
  The creation dialog offers Personal or Team ownership, consults the
  server-authoritative `canCreateWorkspaces` capability, and creates Team-owned
  Cloud Workspaces from the desktop.
- **Run event broker.** Run lifecycle events stream through a broker, and MCP
  clients can subscribe to resources over the bridge instead of polling.
- **Rebuilt assertion engine.** Assertions resolve the upstream HTTP result
  through graph predecessors, persist structured value-free evidence for every
  configured rule (including rules skipped by `failureMode: "first"`), support
  header and cookie sources, expected-value templates with secret references,
  and canonical JSON comparison semantics.
- **MCP safety hardening.** Streamable HTTP requests are origin-validated
  against DNS rebinding, every tool carries intent annotations (read-only,
  destructive, idempotent, open-world) plus output schemas and structured
  content, and run projections redact bodies, headers, cookies, URLs, variable
  values, raw errors, and assertion actual values.
- **Run playback on the canvas.** The canvas plays a run back rather than
  mirroring it. Status events queue in the runner's order and release under two
  rules: a node cannot light up until the traversal into it has landed, and a
  node that lights up holds that state for a minimum dwell. Playback trails the
  run and compresses its tempo as the backlog builds, so a workflow of fast
  responses reads as a sequence instead of arriving in one frame. The toolbar
  and the end-of-run hydration wait for playback to settle, and hydration
  ignores a result that a newer run has superseded. The camera now follows the
  active branch during a run (see [0.7.8](#078--2026-08-14)); any manual zoom or
  pan takes over immediately.
- **Node and edge visual language.** All seven node types share one shell that
  carries idle, running, passed, failed, and skipped state. Edges are bezier
  paths that take their state from the node they leave, with a single
  GPU-composited dot travelling an active edge instead of a marching dash across
  the SVG layer; nothing on the canvas animates while no run is executing.
  Connection handles are 8px sockets inside a 20px hit area, and deleting an
  edge is keyboard-reachable. Both themes are held to WCAG contrast floors by
  test: light mode expresses state as a tighter coloured ring plus a body tint
  where dark mode uses luminance.
- **Keyboard shortcuts and dark mode.** `Ctrl+N`, `Ctrl+S` (flush to disk now;
  auto-save still runs), `Ctrl+R`/`F5` (run), `Ctrl+J` (JSON editor), plus
  context-aware copy and paste.

### Fixed

- **Arch (`.pacman`) install.** The pacman package's dependency list carried a
  Debian-only package name (`http-parser`) that has no Arch equivalent,
  which made `pacman -U` refuse the install with an unresolvable-dependency
  error. The pacman target now declares its own `depends` (`gtk3`, `nss`,
  `libxss`, `libxtst`, `at-spi2-core`) instead of inheriting electron-builder's
  Debian-oriented default list.

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
  environment" model is gone, replaced by a per-machine default-environment
  preference (the header selector) plus a per-workflow selection that overrides
  the preference for that run.
- The flat `/api/environments`, `/api/collections`, `/api/workflows`,
  `/api/webhooks`, and `/api/runs` HTTP paths and the
  `/api/orgs/{orgSlug}/...` scoped paths. The desktop renderer talks to the
  main process over a typed IPC channel; it does not call a separate HTTP
  backend.

Migration from the retired web surface to the local-first desktop app is a
clean install. There is no automatic upgrade path from the retired stack. See
[Installation](docs/getting-started/installation.md) and
[Architecture](docs/reference/architecture.md) for the current product.