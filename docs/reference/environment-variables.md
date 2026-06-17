# Environment Variables

*Canonical reference for every environment variable read by the APIWeave 2.0 backend and frontend. Use this page to find a variable's name, default, and what it controls. All secret values shown here are placeholders. Never commit real keys to a repository or a `.env` file in version control.*

## Prerequisites

None. This is a reference doc. If you are setting up APIWeave for the first time, read the [Documentation Hub](../README.md) first.

## Reading Order

Variables are grouped by feature. Within each group, the table lists every variable name, whether it is required, the default if you do not set it, and what it controls. Variables that the backend reads from `backend/.env` are case-sensitive and use UPPER_SNAKE_CASE. Frontend variables must start with `VITE_` because Vite only exposes that prefix to the browser bundle.

### Categories at a Glance

1. App
2. Database
3. CORS and Trusted Hosts
4. Security
5. Authentication and OAuth
6. Sessions and CSRF
7. Approved Domains
8. Webhooks
9. Storage and Artifacts
10. Network Safety
11. Rate Limiter
12. MCP
13. Secrets and Keyring
14. Worker
15. Frontend

## App

Core application settings read by FastAPI at startup.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DEBUG` | No | `false` | Enables verbose logging and stack traces. Set to `true` only for local development. Never enable in production. |
| `APP_ENV` | Yes | `development` | Deployment environment marker. Valid values: `development`, `production`, `prod`. Drives cookie security, allowed origin checks, and other production guards. |
| `BASE_URL` | Yes | none | Internal backend base URL used by the app. In development: `http://localhost:8000`. In production: the HTTPS URL behind your reverse proxy. |
| `FRONTEND_URL` | No | `None` | Browser URL the user returns to after OAuth login. Must match an entry in `ALLOWED_ORIGINS`. |

## Database

MongoDB connection settings.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MONGODB_URL` | Yes | none | Full MongoDB connection string. Local default: `mongodb://localhost:27017`. Use a credentials URL for Atlas or a replica set. |
| `MONGODB_DB_NAME` | Yes | `apiweave` | Database name inside the MongoDB instance. The 2.0 install requires a clean database; the destructive reset is documented in [Installation](../getting-started/installation.md#destructive-database-reset). |

## CORS and Trusted Hosts

Browser origin allowlist and accepted hostnames. CORS is credentialed because the browser sends session cookies, so wildcards are not safe.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `ALLOWED_ORIGINS` | Yes | none | Comma-separated list of exact frontend origins that may call the API. Production must list HTTPS origins only. Do not set to `*` in production. |
| `TRUSTED_HOSTS` | No | `localhost,127.0.0.1` | Comma-separated hostnames the app accepts in the `Host` header. Restrict this in production to the public API hostname. |
| `PUBLIC_BASE_URL` | No | `http://localhost:8000` | Public HTTPS URL used to build OAuth callback URLs. Configure this in production to your real backend URL so provider consoles accept the callback. |

## Security

Long-lived signing keys for cookies, sessions, and other cryptographic operations.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SECRET_KEY` | Yes | none | Primary application secret. Generate with `openssl rand -hex 32` and store in a secret manager. |
| `SESSION_SECRET_KEY` | Yes (production) | empty | Separate key used to sign browser session cookies. Required when `APP_ENV` is `production` or `prod`. Generate with `openssl rand -hex 32`. |

## Authentication and OAuth

Client credentials for the supported OAuth providers. Leave unused providers blank. Configure the callback URL in each provider console as `{PUBLIC_BASE_URL}/api/auth/callback/{provider}`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GITHUB_CLIENT_ID` | No | empty | GitHub OAuth app client ID. |
| `GITHUB_CLIENT_SECRET` | No | empty | GitHub OAuth app client secret. |
| `GITLAB_CLIENT_ID` | No | empty | GitLab OAuth app client ID. |
| `GITLAB_CLIENT_SECRET` | No | empty | GitLab OAuth app client secret. |
| `MICROSOFT_CLIENT_ID` | No | empty | Microsoft Entra ID application client ID. |
| `MICROSOFT_CLIENT_SECRET` | No | empty | Microsoft Entra ID application client secret. |
| `MICROSOFT_TENANT` | No | `common` | Tenant for Microsoft login. Use `common` for multi-tenant, or a tenant ID for single-tenant. |
| `GOOGLE_CLIENT_ID` | No | empty | Google OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | No | empty | Google OAuth client secret. |

The first sign-in on a clean database becomes the per-instance owner. The 1.0 `SETUP_MODE_ENABLED` first-admin bootstrap is gone in 2.0.

## Sessions and CSRF

Browser session lifetime and CSRF protection. The defaults match the recommended production posture.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SESSION_MAX_IDLE_MINUTES` | No | `720` | Idle window before the session expires. 720 minutes equals 12 hours. |
| `SESSION_MAX_ABSOLUTE_MINUTES` | No | `10080` | Hard lifetime regardless of activity. 10080 minutes equals 7 days. |
| `SESSION_COOKIE_SECURE` | No | `true` | Sends the session cookie over HTTPS only. Forced to `false` automatically when `APP_ENV=development` for local HTTP testing. |
| `SESSION_COOKIE_SAMESITE` | No | `lax` | SameSite cookie attribute. Valid values: `lax`, `strict`, `none`. |
| `CSRF_ENABLED` | No | `true` | Enables CSRF token validation on state-changing requests. Keep enabled. |

## Approved Domains

Restrict signup to a list of email domains. Useful for single-tenant deployments.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `APPROVED_DOMAINS_ENABLED` | No | `false` | Enables the approved-domain gate. When `true`, signup is restricted to the domains listed in `APPROVED_DOMAINS`. |
| `APPROVED_DOMAINS` | No | empty | Comma-separated email domains allowed to sign up. Example: `example.com,example.org`. |

## Webhooks

Scoped webhook execution and payload limits. Webhook authentication now uses a scoped service token bound to a workspace.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WEBHOOK_REQUIRE_HMAC` | No | `true` | Requires HMAC-SHA256 signed requests for webhook execution. Keep `true` in production. Token-only execution is rejected when this is on. |
| `MAX_WEBHOOK_BODY_SIZE` | No | `65536` | Maximum webhook body size in bytes. Production must keep this at or below `1048576` (1 MB). Larger values fail startup. |

## Storage and Artifacts

Local filesystem paths for uploads and run artifacts.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `UPLOADS_BASE_DIR` | No | `uploads` | Base directory where uploaded files are sandboxed. Path is relative to the backend working directory. |
| `ARTIFACTS_PATH` | No | `./artifacts` | Directory where JUnit XML and HTML reports are written after each run. |

## Network Safety

SSRF and request routing controls.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BLOCK_PRIVATE_NETWORKS` | No | `true` | Blocks HTTP nodes from reaching `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and other reserved ranges. SSRF protection. Must be `true` in production. |

## Rate Limiter

Backend used by the token bucket rate limiter. Choose based on whether you run one process or many.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `RATE_LIMITER_BACKEND` | No | `memory` | Valid values: `memory`, `mongodb`. Use `mongodb` when you run multiple backend processes and want a shared counter. |

## MCP

Settings for the Model Context Protocol server, used by AI agents for machine-to-machine access. HTTP MCP is separate from human browser sessions. 2.0 uses scoped service tokens for MCP; the 1.0 global `MCP_API_KEY` flow is gone.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MCP_ENABLED` | No | `false` | Enables the MCP server. Set to `true` to expose MCP tools to AI agents. |
| `MCP_HTTP_ENABLED` | No | `false` | Enables the HTTP transport for MCP. Stdio MCP is always available locally. |
| `MCP_ALLOWED_ORIGINS` | No | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated origins allowed to call the MCP HTTP endpoint. Replace with your agent host in production. |

The bearer token for MCP is now a scoped service token. Create one in the workspace or organization settings and pass it as `Authorization: Bearer <token>` on every HTTP MCP request.

## Secrets and Keyring

Per-scope Libsodium keypairs and the master KEK. The full model is in the [Encryption Guide](../operations/encryption.md).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SECRET_ENCRYPTION_KEY` | No | empty | Master KEK for envelope encryption of stored secret ciphertext. 32 bytes, base64-encoded. Set this in production so secrets survive restart. Leave empty in development for an ephemeral key. |
| `SECRET_KEYRING_BACKEND` | No | `mongodb` | Valid values: `mongodb`, `memory`. The keyring stores old per-scope Libsodium keypairs so rotation never strands existing ciphertexts. |

## Worker

Settings for the optional background worker process that polls and executes runs.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `WORKER_POLL_INTERVAL` | No | `5` | Seconds the worker waits between polling the database for new runs. |
| `WORKER_MAX_RETRIES` | No | `3` | Maximum retry attempts for a failing run before the worker marks it failed. |

## Frontend

Variables Vite injects into the browser bundle. They are baked in at build time, so changing them requires rebuilding the frontend. The `VITE_` prefix is required; Vite refuses to expose any other variable name to the client.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VITE_API_URL` | No | `http://localhost:8000` | Base URL the browser uses to reach the backend REST API. Override in production to your HTTPS backend URL. |
| `VITE_API_WEAVE_URL` | No | `http://localhost:8000` | Base URL the browser uses for the workflow execution and run status endpoints. Override in production to match `VITE_API_URL` unless you front the API with a different hostname. |

### Example frontend `.env`

```env
VITE_API_URL=https://api.example.com
VITE_API_WEAVE_URL=https://api.example.com
```

## Production Required

The backend refuses to start in production mode unless these are set correctly. Set every variable in this list before you bring the service up.

Required in `production` or `prod` (`APP_ENV`):

- `SECRET_KEY` set to a strong random value, never the development placeholder.
- `SESSION_SECRET_KEY` set to a strong random value.
- `SESSION_COOKIE_SECURE=true`. The startup check rejects `false` outside development.
- `WEBHOOK_REQUIRE_HMAC=true`.
- `BLOCK_PRIVATE_NETWORKS=true`.
- `ALLOWED_ORIGINS` set to a comma-separated list of exact HTTPS frontend origins. The startup check rejects `*` in production.
- `MAX_WEBHOOK_BODY_SIZE` at or below `1048576` (1 MB). Larger values fail startup.
- `MONGODB_URL` and `MONGODB_DB_NAME` pointing at the production database (clean, post-2.0 reset).
- `BASE_URL` and `PUBLIC_BASE_URL` set to the public HTTPS backend URL.
- `TRUSTED_HOSTS` set to the public API hostname(s) only.
- `SECRET_ENCRYPTION_KEY` set to a 32-byte base64 value so stored secrets survive restart.

Required when MCP HTTP is exposed:

- A scoped service token with the right permissions. Create it in the workspace or organization settings; there is no global `MCP_API_KEY` in 2.0.
- `MCP_ALLOWED_ORIGINS` set to the trusted agent host origin(s).

Required for each OAuth provider you actually enable:

- Both `*_CLIENT_ID` and `*_CLIENT_SECRET` for that provider. A client ID with an empty secret fails startup.

Generate strong secrets with:

```bash
openssl rand -hex 32
```

## Common Mistakes

A short list of foot-guns we have seen in deployments. Each one has tripped up a real user.

### Mistake 1: ALLOWED_ORIGINS set to `*` in production

The startup check rejects this, but if you bypass the check or run a pre-production build you will get credentialed CORS errors that look like browser bugs. Use a comma-separated list of exact HTTPS origins instead.

```env
# Wrong
ALLOWED_ORIGINS=*

# Right
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

### Mistake 2: SESSION_SECRET_KEY left empty

The development default is empty so you can iterate without ceremony. Production startup fails when this is empty, which is the desired behavior. Always generate a fresh value and store it in a secret manager.

```env
# Wrong (works in dev, fails in prod)
SESSION_SECRET_KEY=

# Right
SESSION_SECRET_KEY=<output of openssl rand -hex 32>
```

### Mistake 3: Pasting a plaintext secret value into a write endpoint

The 2.0 secret write flow is Libsodium sealed-box only. The backend rejects plaintext on the wire and the UI does not offer a paste field. If you are trying to add a secret through curl, fetch the scope's public key first, encrypt the value with a sealed box, and submit the ciphertext.

### Mistake 4: Changing VITE_API_URL after the frontend has built

Vite injects these values at build time, then the browser bundle no longer reads `.env`. If you change the value in `frontend/.env` and forget to rebuild, the running app keeps the old URL. The fix is always `npm run build` after editing `frontend/.env`.

```bash
cd frontend
# Edit .env, then rebuild
npm run build
```

## Troubleshooting

- **If the backend fails to start with a first-owner error**, the database still has 1.0 collections or a previous 2.0 install already created the owner. Run the destructive reset in [Installation](../getting-started/installation.md#destructive-database-reset) and restart.
- **If CORS errors appear in the browser console after switching to HTTPS**, the most common cause is `ALLOWED_ORIGINS` still listing the old `http://` origin. Update the list to your new HTTPS origin and restart the backend.
- **If webhooks return 401 with `HMAC signature required`**, `WEBHOOK_REQUIRE_HMAC` is on and the caller did not send the `X-Webhook-Signature` and `X-Webhook-Timestamp` headers. Confirm both headers are set, then check that the signed payload uses `printf '%s%s'` (timestamp then body) rather than `echo` (which adds a trailing newline).
- **If MCP HTTP requests return 401**, confirm the bearer token is a current scoped service token. The 1.0 `MCP_API_KEY` is no longer accepted.
- **If sessions log the user out immediately after login in production**, `SESSION_COOKIE_SECURE` is almost certainly `false` and the browser is dropping the cookie because the connection is HTTPS. Set it to `true`.

## Related

- [Architecture](../reference/architecture.md)
- [Security and Deployment Checklist](../operations/security.md)
- [MCP Integration Guide](../features/mcp-integration.md)
- [Webhook Quick Start](../features/webhooks.md)
- [Authentication Setup](../operations/authentication.md)
- [Encryption Guide](../operations/encryption.md)
