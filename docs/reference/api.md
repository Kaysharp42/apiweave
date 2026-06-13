# API Reference

*A short tour of APIWeave's HTTP endpoints. This is a map of the surface area, not a full reference: the Swagger UI at `/docs` lists every operation, parameter, and schema.*

## Prerequisites

None. This is a reference doc for users who need to find an endpoint quickly.

## Where to Find the Full Reference

The running backend publishes an OpenAPI 3 document and a Swagger UI:

- Swagger UI: <http://localhost:8000/docs>
- ReDoc: <http://localhost:8000/redoc>
- OpenAPI JSON: <http://localhost:8000/openapi.json>

The Swagger UI is the source of truth for request and response schemas. It is generated from the Pydantic models in the backend, so it stays in sync with the code.

## Endpoint Groups

| Group | Prefix | What it covers |
|-------|--------|---------------|
| Workflows | `/api/workflows` | CRUD, validation, `POST /{id}/run` |
| Runs | `/api/runs` | Status polling, results, artifacts |
| Environments | `/api/environments` | CRUD, activate, secret management |
| Collections | `/api/collections` | CRUD, export, import, dry-run validation |
| Webhooks | `/api/webhooks` | CRUD, `POST /{id}/execute`, logs |
| MCP | `/mcp` | AI-agent tool surface (Claude, Cursor, opencode) |

The first five groups are REST under `/api/*`. The MCP group uses a different transport (JSON-RPC over HTTP) and a different auth path (bearer API key).

## Common Patterns

**Authentication.** Browser callers send the SSO session cookie. Machine callers send `Authorization: Bearer <api-key>` for MCP, or `X-Webhook-Token` plus `X-Webhook-Signature` for webhooks. Webhooks also require an `X-Webhook-Timestamp` for replay protection.

**Pagination.** List endpoints return a paginated envelope. Pass `?page=1&page_size=50` to walk through results. The envelope includes the total count so the client can render a "page N of M" control.

**Error format.** All errors share a JSON shape: `{"error": {"code": "string", "message": "string", "details": {...}}}`. HTTP status codes follow REST conventions (400 for bad input, 401 for unauthenticated, 403 for forbidden, 404 for missing, 409 for conflicts like deleting an environment that is still referenced, 422 for validation failures, 429 for rate limits, 500 for server errors).

## Rate Limits

Most groups are unmetered in single-user deployments. Webhooks are an exception: 100 requests per hour per webhook, with a 24-hour idempotency window. The full limit table and the multi-worker caveat live in [Webhooks](../features/webhooks.md#rate-limiting).

## Versioning

The current API is unversioned. The path prefix is `/api/*` with no version segment. Breaking changes are documented in the project changelog and announced in release notes before the next tag is cut. Clients should pin to a specific backend version when stability matters.

## Related

- [Documentation Hub](../README.md)
- [Architecture Reference](architecture.md)
- [Webhooks](../features/webhooks.md)
- [MCP Integration](../features/mcp-integration.md)
