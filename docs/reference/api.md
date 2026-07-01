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

APIWeave 2.0 is scope-bound, but the current backend API is ID-based rather than the GitHub-style slug-only shape described in early design docs. The browser still uses human-readable routes like `/personal/...` and `/:orgSlug/:workspaceSlug/...`; API callers should use the generated Swagger UI for exact operation paths.

| Prefix | What it covers |
|--------|----------------|
| `/api/orgs` | Organizations, members, teams, invites, and team grants. |
| `/api/workspaces` | Workspace CRUD plus workspace-owned projects, workflows, runs, imports, and exports by workspace id. |
| `/api/users/{userId}/environments` | User-scoped environments. |
| `/api/orgs/{orgId}/environments` | Organization-scoped environments and allowed-workspace policy. |
| `/api/workspaces/{workspaceId}/environments` | Workspace-scoped environments, defaults, protection, and approvals. |
| `/api/scopes/{scopeType}/{scopeId}/secrets` | Metadata-only scoped secrets. |
| `/api/scopes/{scopeType}/{scopeId}/tokens` | Scoped service tokens. |
| `/api/webhooks` | Scope-bound webhook management and execution helpers. |
| `/api/runs` | Strictly scope-bound run helpers; list calls require a workflow filter. |
| `/mcp` | AI-agent tool surface (Claude, Cursor, opencode) using scoped service tokens. |

The old unscoped collection, environment, and workflow routers are disabled. Some flat helper routers (`/api/webhooks`, `/api/runs`) remain live, but they now resolve the target workspace and enforce scoped permissions instead of acting globally.

## Endpoint Groups

| Group | Path shape | What it covers |
|-------|-----------|----------------|
| Organizations | `/api/orgs` | Create, list, update, and audit organizations. |
| Teams | `/api/orgs/{orgSlug}/teams` | Team CRUD, membership, and permission grants. |
| Org Members | `/api/orgs/{orgSlug}/members` | Member roles, last-owner protection, invites. |
| Outside Collaborators | `/api/workspaces/{workspaceId}/collaborators` | Workspace-scoped collaborators. |
| Workspaces | `/api/workspaces` | Workspace CRUD; ownership is body-discriminated for personal vs organization workspaces. |
| Workflows | `/api/workspaces/{workspaceId}/workflows` | CRUD, validation, run trigger. |
| Projects | `/api/workspaces/{workspaceId}/projects` | Project CRUD, ordered run, `.awecollection` v2 export and import. |
| Runs | `/api/workspaces/{workspaceId}/runs` and scoped `/api/runs` helpers | Status polling, results, artifacts. |
| Environments | `/api/workspaces/{workspaceId}/environments` | Workspace-scoped environments. |
| Org Environments | `/api/orgs/{orgId}/environments` | Organization environments with `allowedWorkspaceIds`. |
| Personal Environments | `/api/users/{userId}/environments` | User-scoped environments for the personal workspace. |
| Secrets | `/api/scopes/{scopeType}/{scopeId}/secrets` | Libsodium write-only secret ingress, metadata-only list and get. |
| Service Tokens | `/api/scopes/{scopeType}/{scopeId}/tokens` | Scoped service token CRUD, rotate, narrow, revoke. |
| Webhooks | `/api/webhooks` | Scoped webhook CRUD and execution helpers. |
| Environment Protection | `/api/workspaces/{workspaceId}/environments/{environmentId}/protection` | Required reviewers, self-approval, bypass. |
| Pending Approvals | `/api/workspaces/{workspaceId}/environments/{environmentId}/approvals` | Approve or reject protected-environment runs. |
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

The 2.0 release is itself a hard cut: the old unscoped 1.0 collection, environment, and workflow routers are disabled, and every live tenant-owned surface is permission-checked against its scope.

## Related

- [Documentation Hub](../README.md)
- [Architecture Reference](architecture.md)
- [Workflows and Nodes](../features/workflows-and-nodes.md)
- [Projects](../features/projects.md)
- [Environments and Secrets](../features/environments-and-secrets.md)
- [Webhooks](../features/webhooks.md)
- [MCP Integration](../features/mcp-integration.md)
- [Audit Log](../operations/audit.md)
