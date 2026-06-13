# Changelog

All notable changes to APIWeave are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet. Post-1.0 work tracks deferred features (secrets runtime resolution, webhook execution, OAuth, CLI tool) in `ROADMAP.md`.

## [1.0.0] - 2026-06-13

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

## Pre-1.0 (alpha and beta)

The project shipped as a private alpha and a closed beta through 2025, with continuous iteration on the canvas, executor, and report formats before the 1.0 feature cut.
