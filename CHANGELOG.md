# Changelog

All notable changes to APIWeave are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet. Post-1.0 work tracks deferred features (secrets runtime resolution, webhook execution, OAuth, CLI tool) in `ROADMAP.md`.

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

  This design is intentionally future-proofed for profiles and workspaces: adding workspace-scoped keypairs and workspace-scoped KEKs is a `scope_id` or `kek_id` routing change without changing `{{secrets.X}}` workflow syntax. See `docs/operations/encryption.md` for the full model and migration path.

## Pre-1.0 (alpha and beta)

The project shipped as a private alpha and a closed beta through 2025, with continuous iteration on the canvas, executor, and report formats before the 1.0 feature cut.
