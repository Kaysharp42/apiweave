# APIWeave

Visual API Test Story Builder. Build, run, and inspect API test workflows on a canvas.

## What Is APIWeave 2.0?

APIWeave is a self-hostable, open-source workspace for visual API testing. You assemble test workflows on a ReactFlow canvas from drag-and-drop nodes (HTTP request, assertion, delay, merge, start, end), chain requests with extracted variables and dynamic functions, run them against a scoped environment, and inspect results node by node. Projects group workflows into ordered runs. Scoped environments and scoped secrets live at user, organization, workspace, or environment scopes, and `{{secrets.NAME}}` resolves through a GitHub-like override chain. Scoped service tokens drive webhooks and the MCP server.

APIWeave 2.0 is the first release tracked as a stable public surface. The 2.0 install requires a clean database; see the [Installation](docs/getting-started/installation.md#destructive-database-reset) guide for the destructive reset that the unreleased app expects.

## Quick Start

Prerequisites: Python 3.13+, Node.js 20+, MongoDB 7+.

Windows:

```bash
setup.bat
start-dev.bat
```

macOS / Linux:

```bash
./setup.sh
./start-dev.sh
```

Open `http://localhost:3000` in a browser. The frontend is on port 3000, the backend API on port 8000, the OpenAPI docs on `/docs`, and MongoDB on 27017. Sign in through your configured SSO provider; the first sign-in becomes the per-instance owner and lands you in your personal workspace. Run `stop-dev.bat` or `./stop-dev.sh` to shut everything down.

### Self-hosting without SSO

For local evaluation and single-operator self-hosting, set `DEPLOYMENT_MODE=single_user` in `backend/.env`. The backend creates a synthetic owner on the first request and serves the canvas with no login screen, no OAuth configuration, and no session secrets. See the [Authentication guide](docs/operations/authentication.md#deployment-mode) for the full contract.

## Features

The feature guides are the deep reference for everything you can do in APIWeave. Each is a self-contained tutorial with worked examples and a troubleshooting section.

- [Workflows and Nodes](docs/features/workflows-and-nodes.md): canvas, the six node types, toolbar actions, resume after a failed run, and the workspace context every workflow lives in.
- [Variables and Extractors](docs/features/variables-and-extractors.md): the four placeholder namespaces, the secret override chain, and how to pull values from responses.
- [Projects](docs/features/projects.md): workspace-scoped ordered groups of workflows, project runs, and `.awecollection` v2 export and import (references only).
- [Environments and Secrets](docs/features/environments-and-secrets.md): scoped environments, the Libsodium write-only secret model, the metadata-only display, the override chain, and the fact that runtime secret input is removed.
- [Webhooks](docs/features/webhooks.md): workspace-scoped webhooks, token and HMAC auth, idempotency, rate limiting, and CI/CD integration.
- [MCP Integration](docs/features/mcp-integration.md): scoped service tokens, both transports, and the rebuilt scoped tool surface.
- [Swagger and OpenAPI Import](docs/features/swagger-import.md): turn a spec into reusable request templates inside a workspace.

## Documentation

The [Documentation Hub](docs/README.md) is the entry point for every user-facing guide. It routes you through three paths (use it, build with it, fix something) and links to the operations, reference, and feature indexes. Start there for install paths, the destructive database reset, the first-workflow tutorial, and the central FAQ.

## Operations

The operations guides cover production posture: authentication, security, encryption, deployment, environment protection, audit, and the central FAQ.

- [Authentication](docs/operations/authentication.md): SSO model, per-instance owner bootstrap, organization and workspace context, session policy.
- [Security](docs/operations/security.md): production security model, scoped trust boundaries, CSRF and CORS, secret masking, and the pre-launch checklist.
- [Encryption](docs/operations/encryption.md): per-scope Libsodium keypairs, write-only sealed-box ingress, master KEK, and keyring rotation.
- [Deployment](docs/operations/deployment.md): self-hosting, the destructive database reset on upgrade, the four runtime components, pre-production checklist.
- [Environment Protection](docs/operations/environment-protection.md): required reviewers, self-approval, and the trusted-token bypass.
- [Audit Log](docs/operations/audit.md): the append-only event log, filters, and the JSON export.

## Tech Stack

- Frontend: React 18, ReactFlow 11, Vite 5, Tailwind CSS 3, Zustand 5.
- Backend: Python 3.13, FastAPI, Beanie ODM on MongoDB 7 (via Motor).
- Secrets: per-scope Libsodium sealed-box ingress plus AES-256-GCM envelope at rest, write-only through every layer.
- Execution: an in-process `WorkflowExecutor` plus an optional separate worker for horizontal scale.
- Reporting: JUnit XML and HTML run artifacts.

## Project Layout

```text
apiweave/
  backend/   FastAPI API, Beanie models, repositories, worker, MCP server
  frontend/  React app, ReactFlow canvas, contexts, components
  docs/      User-facing documentation (the hub and all guides)
  progress/  Internal implementation notes and history
```

## License

MIT. See [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branching, commit style, and the pull-request flow.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the post-2.0 plan. For historical releases, see [CHANGELOG.md](CHANGELOG.md).
