# Changelog

All notable changes to APIWeave are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-06-17

The 2.0 release replaces the flat global resource model with a GitHub-style multi-tenant design. Every user gets a personal workspace, organizations own workspaces, projects replace collections, environments and secrets are scoped, and secret values are write-only.

APIWeave 2.0 is the first release tracked in this changelog as a stable public surface. The 1.0 line stays below as a record of the flat model that 2.0 replaces.

### Added

- **Personal and organization workspaces.** Every user gets a default personal workspace on first sign-in. Organizations own any number of workspaces, and every workspace has a slug used in URLs (`/<orgSlug>/<workspaceSlug>/...`). Workspace transfer is out of scope in 2.0.
- **Organizations with teams and members.** Organizations carry the `owner`, `member`, `billing`, and `security` roles. Teams receive workspace, environment, secret, and approval grants. Outside collaborators join a single workspace without becoming an org member. Invites are sent by email and expire.
- **Projects (formerly collections).** Projects are the new workspace-scoped grouping for ordered workflow execution. A project carries a `workflowOrder`, a per-row `continueOnFail`, and belongs to exactly one workspace.
- **Scoped environments.** Environments live at user, organization, or workspace scope. Organization environments restrict which workspaces can see them through `allowedWorkspaceIds`. Each workspace has exactly one default environment.
- **Scoped secrets with override chain.** Secret scopes cover user, organization, workspace, and environment. `{{secrets.NAME}}` resolves with the GitHub-like order: environment > workspace > organization. User personal secrets participate only through explicit binding records. The metadata-only display shows name, scope, key id, and last update time, never the value or ciphertext.
- **Libsodium write-only secret ingress.** New secret values are encrypted in the browser or agent against the scope's public key before the request leaves. The backend never accepts a plaintext secret value on a write path. Old secret values cannot be read back through any UI, API, or MCP tool.
- **Per-scope keypairs and keyring rotation.** Every scope carries its own Libsodium keypair for sealed-box submission. Old keys remain in an encrypted keyring so rotation never strands existing ciphertexts.
- **Environment protection.** Workspace environments carry a protection policy: required reviewers, `allowSelfApproval`, a `bypassPolicy` (`none` or `trusted_token_only`), and a service-token bypass allowlist. Runs against a protected environment create a pending approval record; the run queues until every required reviewer approves.
- **Scoped service tokens.** Service tokens replace the flat `MCP_ALLOW_SECRET_WRITES` flag and the 1.0 webhook credential shape. A token is bound to a workspace or organization scope, carries an explicit permission set, expires, and can be revoked, rotated, or narrowed without reissuing.
- **Rebuilt scoped MCP tool inventory.** Every MCP tool now operates against an explicit scope (org, workspace, or environment). Tools that previously accepted runtime secrets are gone. Read and export tools redact persisted secrets at the response layer.
- **Append-only audit log.** Every secret resolution, environment activation, protection decision, member change, service-token creation, and webhook delivery writes an immutable event. The audit page supports filters by actor, action, scope, resource type, and time range, and the JSON export produces a portable snapshot.
- **Bootstrap path with destructive reset.** The first user to sign in becomes the workspace owner. The bootstrap document explicitly calls out that database wipe is part of the pre-release upgrade path, and the install guide documents the exact destructive commands.
- **Slug-based URLs and scoped API surface.** REST and MCP endpoints follow a GitHub-like shape: `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/...` for workspace resources, `/api/orgs/{orgSlug}/...` for org-level resources, and `/api/users/me/...` for personal resources. The old flat routes are removed.

### Changed

- All workflows, projects, environments, and secrets are now scoped. The `Environment` model lost its global `isActive` flag; a run selects exactly one environment explicitly.
- The placeholder namespace model is unchanged on the surface (`{{variables.x}}`, `{{env.x}}`, `{{prev.x}}`, `{{secrets.x}}`, dynamic functions) but secret resolution now follows the override chain rather than a single active environment.
- Webhook and MCP credentials moved from the flat `MCP_API_KEY` and per-webhook pair to scoped service tokens. Existing credentials stop working on upgrade; create new tokens in the workspace settings.
- The `OAuth/OIDC` and `SSO` flows now bootstrap an org owner, a personal workspace, or both depending on the invite. The setup-mode admin is replaced by a per-instance owner.
- The `/api/environments`, `/api/collections`, `/api/workflows`, `/api/webhooks`, and `/api/runs` flat paths are gone. The new scoped paths under `/api/orgs/{orgSlug}/...` and `/api/users/me/...` are the only supported surface.

### Deprecated

N/A.

### Removed

- **Runtime and ad-hoc secret input.** The 1.0 flow that asked for a secret value at run time, accepted `runtime_secrets` in the run API, or stored a value in the request body has been removed. Every secret must exist in the scope before the run starts.
- **Global `Environment.isActive`.** The "one active environment" model is gone. A run selects one environment explicitly, and the same environment can be active for one run and inactive for another.
- **Flat `/api/environments`, `/api/collections`, `/api/workflows`, `/api/webhooks`, and `/api/runs` routes.** All of these endpoints were removed. Clients must use the scoped paths.
- **Plaintext secret write path.** The 1.0 path that accepted raw secret values on environment create or update is gone. Only Libsodium sealed-box ciphertext is accepted.
- **MCP `environment_set_secret` and `environment_delete_secret` tools.** Replaced by scoped secret write and revoke tools that require a sealed-box payload.
- **OAuth `SETUP_MODE_ENABLED` first-admin bootstrap.** Replaced by the per-instance owner flow that runs on first sign-in.

### Fixed

- Audit log integrity is now end-to-end. Every secret read, every webhook delivery, and every member change writes a tamper-evident record with a monotonic event id.
- Slug reuse after soft delete is blocked. Once a slug is retired, no future resource can claim it.

### Security

- Secrets are write-only at every layer. The secret service has no read API for stored values; resolution happens in a tightly scoped runtime path that the masking layer scrubs before persistence.
- The MCP `MCP_ALLOW_SECRET_WRITES` flag is gone. Secret writes require an explicit secret-write permission on a scoped service token.
- Audit events carry actor, scope, resource, and context without the value. The audit page itself runs the same value-aware masking as the run history.

### Migration Notes

APIWeave 2.0 is a breaking release against the 1.0 surface. Because the project has not yet shipped a stable public release, the migration path is destructive reset followed by a clean install. There is no automatic 1.0 to 2.0 upgrade.

- **Destructive database reset is the supported upgrade path.** The application is unreleased, so there is no production data to preserve. Drop the MongoDB database, recreate the schema, and re-onboard from the install guide. The destructive commands are documented in [Installation](docs/getting-started/installation.md#destructive-database-reset).
- **First sign-in creates the personal workspace.** The first user to sign in becomes the per-instance owner, and the backend auto-creates a default personal workspace at `personal` for that user. The first user can also create the first organization.
- **No backward compatibility.** The flat `/api/environments`, `/api/collections`, `/api/workflows`, `/api/webhooks`, and `/api/runs` paths, the `Environment.isActive` flag, the runtime secret flow, the 1.0 webhook credential shape, and the global `MCP_API_KEY` flow are all gone. Clients that depend on any of them must move to the scoped surface.
- **`.awecollection` schema v2 references only.** `.awecollection` files no longer carry secret values, ciphertext, or per-scope private keys. They carry workflow definitions, project metadata, and environment references. A consumer of the bundle is expected to re-create secrets on the destination instance using the sealed-box write flow. The schema bump is a hard cut; v1 bundles do not import.
- **Scoped service tokens replace flat MCP and webhook credentials.** Reissue any previously-issued MCP API key and any previously-issued webhook token as scoped service tokens in the workspace or organization settings. Old credentials stop validating the moment the upgrade lands.
- **Audit retention is per-instance.** The default audit retention is set in `backend/app/config.py`. The `audit.events.export` JSON download is the canonical way to take an offline snapshot before any destructive operation.

## [1.0.0] - 2026-06-14

First stable release of APIWeave, a self-hostable visual API test workflow builder.

### Added

- Visual workflow canvas (ReactFlow) with drag and drop, auto-save, and adaptive polling.
- Six node types: HTTP Request, Assertion, Delay, Merge, Start, End.
- Workflow variables with JSONPath extractors and four placeholder namespaces.
- Assertion node with ten operators and per-source path resolution.
- Environment management with variables, secret keys, and active-environment switching.
- Collections for grouping workflows with ordered execution and `.awecollection` export and import.
- Webhook management with token and HMAC authentication.
- MCP (Model Context Protocol) integration for AI agent access over stdio and HTTP.
- Import from OpenAPI 3.x, Swagger 2.0, HAR, and cURL.
- Dynamic functions callable inside placeholders (uuid, timestamp, randomString, and others).
- GridFS storage for large response bodies, with continued on-fail execution semantics.
- Persistent node templates that survive page refresh, plus copy and paste of nodes.
- Docker Compose stack for self-hosting (MongoDB, backend, worker, frontend).
- Dark mode and keyboard shortcuts.

#### Gap-closure re-tag (2026-06-14)

- Webhook execution end-to-end: `POST /api/webhooks/{id}/execute` now creates real workflow and collection runs, with HMAC auth, idempotency, rate limiting, and async queue.
- Secrets runtime resolution: `{{secrets.NAME}}` placeholders now resolve to encrypted-at-rest values from the active environment, with masking extended to all surfaces (header, body, log).
- OAuth/OIDC multi-user login: GitHub, GitLab, Google, Microsoft providers are now available behind the `OAUTH_LOGIN_ENABLED` flag (default `false`), with an invite flow that sends email, and approved-domains enforcement via env vars.

### Changed

N/A.

### Deprecated

N/A.

### Removed

N/A.

### Fixed

N/A.

### Security

- CSRF protection on state-changing requests.
- Session-based authentication with secure cookie policy.
- HMAC signature verification for webhook execution requests.
- Repository pattern in the backend prevents raw query injection.
- Secrets are stripped from `.awecollection` exports; secret keys survive.

#### Gap-closure security notes

- Secret values use hybrid protection: client-side Libsodium sealed-box submission plus `SECRET_ENCRYPTION_KEY`-backed AES-256-GCM envelope encryption at rest. Key IDs and scoped key metadata are ready for future profiles and workspaces.
- OAuth state validation enforces a fail-closed CSRF posture (F4).
- Webhook-triggered runs honor the same secret-masking pipeline as manual runs (F5 extension).

### Migration Notes

- **`{{secrets.X}}` resolution is now active**: workflows that previously had these placeholders unresolved will now resolve to whatever is in the active environment's `secrets` map. If the key is unset, the placeholder becomes an empty string. Operators should audit workflows for `{{secrets.*}}` references before upgrading.
- **`OAUTH_LOGIN_ENABLED` defaults to `false`**: existing 1.0 deployments will see no change in login behavior. To enable OAuth, set the env var to `true` and configure provider client IDs and secrets.
- **Approved domains**: `APPROVED_DOMAINS_ENABLED` and `APPROVED_DOMAINS` env vars are read by the backend. If `OAUTH_LOGIN_ENABLED=true` and `APPROVED_DOMAINS_ENABLED=true`, only matching email domains can sign up.
- **Secret encryption model**: new secret writes fetch an environment public key and submit Libsodium sealed-box ciphertext, so normal API requests do not carry raw secret values. The backend opens the sealed box only inside the trusted secret service, immediately re-encrypts with AES-256-GCM envelope encryption (a per-instance DEK wrapped by a master KEK from `SECRET_ENCRYPTION_KEY`), and stores only the envelope blob. Existing plaintext or AES-only secrets are upgraded lazily on trusted runtime read or update. Operators should set `SECRET_ENCRYPTION_KEY` to a 32-byte base64 value in their deployment env:

  ```bash
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```

  This design is intentionally future-proofed for profiles and workspaces: adding workspace-scoped keypairs and workspace-scoped KEKs is a `scope_id` or `kek_id` routing change without changing `{{secrets.X}}` workflow syntax. See `docs/features/environments-and-secrets.md` for the current local-encrypted-store model.

## Pre-1.0 (alpha and beta)

The project shipped as a private alpha and a closed beta through 2025, with continuous iteration on the canvas, executor, and report formats before the 1.0 feature cut.
