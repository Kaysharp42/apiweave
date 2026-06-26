# Deployment

*Short guide for self-hosters. Covers the runtime components (Frontend, Backend, Worker, MongoDB) and the production concerns that come up first: env vars, the destructive database reset on upgrade, reverse proxy, scaling, backups, and a pre-production checklist. For deep security or auth setup, follow the links in Prerequisites.*

## Prerequisites

- Read [Security Guide](security.md) and [Authentication Guide](authentication.md) before exposing APIWeave to the network.
- A host (VM, bare metal, or K8s node) with Docker Engine 24+ and Docker Compose v2.
- A MongoDB 7+ instance, DNS records, TLS certificates from a trusted CA, and a secret manager for `SESSION_SECRET_KEY`, `SECRET_ENCRYPTION_KEY`, OAuth client secrets, webhook tokens, and HMAC secrets. Scoped service tokens for MCP and webhooks are issued by the running backend; there is no `MCP_API_KEY` to manage in 2.0.

## Destructive Database Reset

> **Read this before any other step in this guide.** APIWeave 2.0 has not yet shipped a stable public release. The 2.0 model (personal and organization workspaces, scoped environments, scoped secrets, projects, scoped service tokens) is a hard cut from the 1.0 line, and the supported upgrade path is to wipe the database and start over.

Before bringing the 2.0 backend up against an existing database, drop the database. The full reasoning and the exact commands are in [Installation](../getting-started/installation.md#destructive-database-reset). The short version: the 2.0 install requires a clean database with no 1.0 collections, no `Environment.isActive`, no `runtime_secrets`, and no flat `/api/*` paths.

Before the reset, take a JSON export of the audit log. The destructive reset wipes the audit log with the rest of the database. The export is the only way to preserve history across an upgrade. See the [Audit Log guide](audit.md) for the export flow.

## Deployment Options

Pick the option that matches your operational experience:

- **Local Docker Compose**: fastest path. All four components run on one host from `docker-compose.yml`. Good for evaluation and small teams.
- **Self-hosted VM**: same Compose file, but fronted by a reverse proxy (Caddy, Nginx, or Traefik) that terminates TLS. Recommended for most self-hosters.
- **Self-hosted Kubernetes**: split the four services into Deployments, mount a managed or in-cluster MongoDB, and put an Ingress in front. Pick this when you already run K8s or need horizontal scale.

APIWeave also supports two operating models selected by `DEPLOYMENT_MODE` in `backend/.env`:

- **`single_user`** (recommended for self-hosting and local evaluation): the backend auto-creates one synthetic owner on first request, and every API call is authenticated as that owner. No OAuth configuration, no session secrets, no logins. Set `DEPLOYMENT_MODE=single_user` and you are done with auth.
- **`multi_tenant`** (required for hosted SaaS and any install that needs invites, organizations, or teams): full OAuth SSO, server-side sessions, double-submit CSRF, invites, approved domains. This is the historical 2.0 behavior and the default.

See the [Authentication guide](authentication.md#deployment-mode) for the full per-mode contract, the configuration matrix, and the switching procedure.

## Docker Compose

The repo ships a `docker-compose.yml` at the project root with four services: `mongodb`, `backend`, `worker`, `frontend`, plus an `mcp-stdio` helper.

The first time you bring the stack up after the 2.0 upgrade, run the destructive reset:

```bash
docker compose down -v
docker compose up -d --build
docker compose ps
docker compose logs -f backend worker
```

The first `down -v` removes the named MongoDB volume so the 2.0 model can take effect. Subsequent restarts do not need the `-v` flag. Mount a host directory for `backend/artifacts` so run reports and GridFS blobs survive container recreation. See the `volumes:` blocks in the compose file for the exact paths.

## Environment Variables

The backend reads from `backend/.env` and the frontend builds with `VITE_*` values. Full reference: [Environment Variables](../reference/environment-variables.md).

Minimum for a working dev start:

```env
MONGODB_URL=mongodb://mongodb:27017
MONGODB_DATABASE=apiweave
APP_ENV=development
```

Production must add at minimum `APP_ENV=production`, `BASE_URL`, `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `TRUSTED_HOSTS`, `SESSION_SECRET_KEY`, `SESSION_COOKIE_SECURE=true`, `CSRF_ENABLED=true`, `WEBHOOK_REQUIRE_HMAC=true`, `SECRET_ENCRYPTION_KEY`, and the OAuth client credentials for any provider you enable. Treat the [Security Guide](security.md) checklist as the source of truth.

The 1.0 `MCP_API_KEY` and `MCP_REQUIRE_API_KEY` variables are gone. The bearer token for HTTP MCP is a scoped service token created in the workspace or organization settings. `SETUP_MODE_ENABLED` (default `true`) still gates the first-admin bootstrap: the first verified sign-in becomes the per-instance owner, after which setup mode auto-disables — set it `false` in production (startup checks reject `true`).

### Single-User Self-Host

For local evaluation and self-hosting by a single operator, set `DEPLOYMENT_MODE=single_user` and skip the entire OAuth and session block. The minimum `.env` becomes:

```env
MONGODB_URL=mongodb://mongodb:27017
MONGODB_DATABASE=apiweave
APP_ENV=production
BASE_URL=https://api.example.com
PUBLIC_BASE_URL=https://api.example.com
ALLOWED_ORIGINS=https://app.example.com
TRUSTED_HOSTS=api.example.com
SECRET_ENCRYPTION_KEY=<output of: python -c "import secrets; print(secrets.token_urlsafe(32))">
DEPLOYMENT_MODE=single_user
```

No `SESSION_SECRET_KEY`, no `OAUTH_LOGIN_ENABLED`, no `*_CLIENT_ID`, no `*_CLIENT_SECRET`, no `APPROVED_DOMAINS`. The backend creates a synthetic owner (`owner@localhost`, `admin` role) on the first request, auto-creates the `personal` workspace, and serves the canvas immediately. The frontend hides the login, setup, and admin screens.

This is the recommended path for anyone who is not running a hosted SaaS or a team install with invites. The full [Authentication guide](authentication.md#deployment-mode) explains the per-mode contract and the switching procedure.

## MongoDB

## MongoDB

MongoDB is the system of record. The worker reads `runs` documents directly, so anyone with write access to that collection can trigger arbitrary workflow execution against any workspace.

- Bind MongoDB to a private network. Never expose port 27017 to the public internet.
- Use authentication (`--auth` or managed equivalent) and a strong password.
- Prefer a replica set so single-node loss does not stop runs.
- Do not share the cluster with tenants outside your trust boundary.
- The 2.0 install requires a clean database. Run the destructive reset in [Installation](../getting-started/installation.md#destructive-database-reset) before the first 2.0 sign-in.

## Reverse Proxy

Terminate TLS at a reverse proxy in front of the backend and frontend. Required behaviors:

- HTTPS-only with a modern TLS profile (TLS 1.2+, modern ciphers).
- HTTP to HTTPS redirect on the public listener.
- Forward `X-Forwarded-Proto` and `X-Forwarded-Host` so the backend's `TRUSTED_HOSTS` and cookie security checks work.
- Set `Strict-Transport-Security`, `X-Content-Type-Options`, and `Referrer-Policy` headers.
- Restrict management ports (MongoDB, admin UIs) to localhost or the private network.
- Set client body size to match `MAX_WEBHOOK_BODY_SIZE` (default 64 KB).

## Scaling

- The worker polls MongoDB and runs nodes through the shared executor. Run one or more workers as separate processes; they coordinate through the `runs` collection.
- The backend API can run behind a load balancer. The in-memory rate limiter is per-process, so a multi-instance API gets an effective limit of `max_requests * instance_count`. Plan accordingly or wait for the shared-store backend.
- The frontend is a static bundle served by Nginx. Scale by replicas behind a CDN or load balancer.
- MongoDB scaling is MongoDB's problem: add replica set members, then shards when a single primary saturates.

## Backups

APIWeave stores organizations, teams, workspaces, members, projects, workflows, runs, environments, scoped secrets, service tokens, protection policies, and the append-only audit log in MongoDB. Use the standard MongoDB backup tooling:

- **Self-hosted**: `mongodump` for logical backups, filesystem snapshots (LVM/ZFS) for physical backups, or MongoDB's own ops manager / cloud backup for managed setups.
- **MongoDB Atlas**: enable continuous cloud backup and periodic restore drills.
- Test a restore at least once per quarter. An untested backup is not a backup.
- Store backup files encrypted and on separate infrastructure from the database host.
- Take a JSON export of the audit log before any destructive operation. The audit log is part of the database, so the destructive reset wipes it with everything else. See the [Audit Log guide](audit.md) for the export flow.

## Observability

- **Logs**: backend and worker print to stdout; mirror to your log stack. Per-run traces live at `backend/logs/run_{runId}.log`.
- **Health**: `GET /api/health` returns liveness. Hit it from your proxy or uptime monitor.
- **Run state**: the frontend polls the workspace run endpoint (fast 100 ms for 2 s, then 1 s) and shows live status on the canvas.
- **Audit**: the append-only audit log is queryable through the audit page. Use the JSON export to take offline snapshots and pipe to your log stack. See the [Audit Log guide](audit.md).

## Pre-Production Checklist

- [ ] `APP_ENV=production`; `DEBUG=false`.
- [ ] Database wiped with the destructive reset in [Installation](../getting-started/installation.md#destructive-database-reset) before the first sign-in.
- [ ] Audit log exported to a separate host before the destructive reset.
- [ ] HTTPS-only with HSTS; HTTP redirects to HTTPS.
- [ ] `BASE_URL` and `PUBLIC_BASE_URL` set to the real HTTPS backend URL.
- [ ] `ALLOWED_ORIGINS` lists the exact HTTPS frontend origin; no wildcard.
- [ ] `TRUSTED_HOSTS` lists the public hostnames only.
- [ ] `SESSION_SECRET_KEY` is a strong random value from a secret manager.
- [ ] `SECRET_ENCRYPTION_KEY` is a 32-byte base64 value from a secret manager.
- [ ] `SESSION_COOKIE_SECURE=true`, `CSRF_ENABLED=true`.
- [ ] OAuth callback URLs in the provider console match `PUBLIC_BASE_URL`.
- [ ] `WEBHOOK_REQUIRE_HMAC=true`; webhook tokens and HMAC secrets stored in CI secret store.
- [ ] Scoped service tokens created with the narrowest permission set the consumer needs. The 1.0 `MCP_API_KEY` is not used.
- [ ] MongoDB bound to the private network, auth enabled, backups verified.
- [ ] `BLOCK_PRIVATE_NETWORKS=true` so the executor cannot reach internal services.
- [ ] First owner created via SSO through a verified email; org and team membership reviewed.

Full source: [Security Guide](security.md) and [Authentication Guide](authentication.md).

## Doc-Truth Check

The CI pipeline includes a lightweight doc-truth check that runs on every pull request touching the documentation. It greps the docs for references to features that are no longer in the new model, including the global active-environment flag, runtime secret input, flat unscoped API paths, the global `MCP_API_KEY`, and the 1.0 first-admin setup flow. The check is advisory and does not block the build; it surfaces drift between the shipped feature set and the documentation.

## Troubleshooting

- **Backend cannot reach MongoDB.** Check `MONGODB_URL`, container DNS (`mongodb` resolves inside Compose), and that port 27017 is open on the private network. Inspect with `docker compose logs mongodb`.
- **OAuth callback fails with state or redirect mismatch.** Confirm `PUBLIC_BASE_URL` and `BASE_URL` match the callback URL registered in the provider console, and that the reverse proxy forwards the original scheme and host.
- **CORS error in the browser.** Add the exact frontend origin (with scheme) to `ALLOWED_ORIGINS`. Wildcards are rejected when credentials are sent.
- **Webhook returns 401.** Token mismatch, expired after regeneration, or production requiring HMAC. Re-copy the token from the Webhooks UI and add `X-Webhook-Signature` plus `X-Webhook-Timestamp` headers.
- **Runs stay `pending`.** Worker is not running or cannot reach MongoDB. Check `docker compose ps worker` and the worker logs.
- **Large response payloads fail to load.** Confirm GridFS is reachable (same MongoDB) and `backend/artifacts` is writable.

## Related

- [Architecture](../reference/architecture.md)
- [Environment Variables](../reference/environment-variables.md)
- [Security Guide](security.md)
- [Authentication Guide](authentication.md)
- [Encryption Guide](encryption.md)
- [Audit Log](audit.md)
- [Environment Protection](environment-protection.md)
- [Installation](../getting-started/installation.md#destructive-database-reset)
