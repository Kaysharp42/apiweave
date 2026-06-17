# API Reference

*A short tour of APIWeave 2.0's HTTP endpoints. This is a map of the surface area, not a full reference: the Swagger UI at `/docs` lists every operation, parameter, and schema.*

## Prerequisites

None. This is a reference doc for users who need to find an endpoint quickly.

## Where to Find the Full Reference

The running backend publishes an OpenAPI 3 document and a Swagger UI:

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>
- OpenAPI JSON: <http://localhost:8000/openapi.json>

The Swagger UI is the source of truth for request and response schemas. It is generated from the Pydantic models in the backend, so it stays in sync with the code.

## Scoped API Shape

APIWeave 2.0 uses a GitHub-style slug-based path shape. The flat `/api/environments`, `/api/collections`, `/api/workflows`, `/api/webhooks`, and `/api/runs` paths from 1.0 are removed. Every endpoint now lives under a scope.

| Prefix | What it covers |
|--------|----------------|
| `/api/users/me/...` | Current user and the personal workspace. |
| `/api/orgs/{orgSlug}/...` | Organization-scoped resources (members, teams, invites, organization environments, organization secrets, organization service tokens). |
| `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/...` | Organization-owned workspaces (workflows, projects, workspace environments, workspace secrets, service tokens, audit, webhooks). |
| `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/environments/{environmentId}/secrets` | Environment-scoped secrets. |
| `/mcp` | AI-agent tool surface (Claude, Cursor, opencode) using scoped service tokens. |

The new shape is the only supported surface. Clients that depended on the flat paths must move to the scoped equivalents.

## Endpoint Groups

| Group | Path shape | What it covers |
|-------|-----------|----------------|
| Organizations | `/api/orgs` | Create, list, update, and audit organizations. |
| Teams | `/api/orgs/{orgSlug}/teams` | Team CRUD, membership, and permission grants. |
| Org Members | `/api/orgs/{orgSlug}/members` | Member roles, last-owner protection, invites. |
| Outside Collaborators | `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/collaborators` | Workspace-scoped collaborators. |
| Workspaces | `/api/orgs/{orgSlug}/workspaces` and `/api/users/me/personal/workspace` | Workspace CRUD, slug URLs. |
| Workflows | `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/workflows` | CRUD, validation, run trigger. |
| Projects | `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/projects` | Project CRUD, ordered run, `.awecollection` v2 export and import. |
| Runs | `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/runs` | Status polling, results, artifacts. |
| Environments | `/api/orgs/{orgSlug}/workspaces/{workspaceSlug}/environments` | Workspace-scoped environments. |
| Org Environments | `/api/orgs/{orgSlug}/environments` | Organization environments with `allowedWorkspaceIds`. |
| Personal Environments | `/api/users/me/environments` | User-scoped environments for the personal workspace. |
| Secrets | per-scope `/secrets` | Libsodium write-only secret ingress, metadata-only list and get. |
| Service Tokens | per-scope `/tokens` | Scoped service token CRUD, rotate, narrow, revoke. |
| Webhooks | per-workspace `/webhooks` | Scoped webhook CRUD and execution. |
| Environment Protection | per-environment `/protection` | Required reviewers, self-approval, bypass. |
| Pending Approvals | per-environment `/approvals` | Approve or deny protected-environment runs. |
| Audit | per-scope `/audit` | Append-only event log and JSON export. |
| MCP | `/mcp` | AI-agent tool surface, scoped service tokens. |

## Common Patterns

**Authentication.** Browser callers send the SSO session cookie plus the CSRF token on state-changing requests. Machine callers send `Authorization: Bearer <scoped-service-token>` for MCP and scoped webhooks. Webhooks also require an `X-Webhook-Signature` and an `X-Webhook-Timestamp` for replay protection.

**Pagination.** List endpoints return a paginated envelope. Pass `?page=1&page_size=50` to walk through results. The envelope includes the total count so the client can render a "page N of M" control.

**Error format.** All errors share a JSON shape: `{"error": {"code": "string", "message": "string", "details": {...}}}`. HTTP status codes follow REST conventions (400 for bad input, 401 for unauthenticated, 403 for forbidden, 404 for missing, 409 for conflicts like deleting a project that still has workflows, 422 for validation failures, 429 for rate limits, 500 for server errors).

**Write-only secrets.** Secret write endpoints accept a Libsodium sealed-box payload encrypted against the scope's public key. The plaintext value never crosses the network. Secret read endpoints return metadata only. There is no API to read a stored secret value back.

## Rate Limits

Most groups are unmetered in single-user deployments. Scoped webhooks are an exception: 100 requests per hour per webhook, with a 24-hour idempotency window. The full limit table and the multi-worker caveat live in [Webhooks](../features/webhooks.md#rate-limiting).

## Versioning

The current API is unversioned. The path prefix is `/api/*` with no version segment. Breaking changes are documented in the project changelog and announced in release notes before the next tag is cut. Clients should pin to a specific backend version when stability matters.

The 2.0 release is itself a hard cut: the 1.0 flat paths are removed and the 2.0 scoped paths are the only supported surface.

## Related

- [Documentation Hub](../README.md)
- [Architecture Reference](architecture.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Projects](../features/projects.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [Webhooks](../features/webhooks.md)
- [MCP Integration](../features/mcp-integration.md)
- [Audit Log](../operations/audit.md)
