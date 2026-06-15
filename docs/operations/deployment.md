# Deployment

*Short guide for self-hosters. Covers the four runtime components (Frontend, Backend, Worker, MongoDB) and the production concerns that come up first: env vars, reverse proxy, scaling, backups, and a pre-production checklist. For deep security or auth setup, follow the links in Prerequisites.*

## Prerequisites

- Read [Security Guide](security.md) and [Authentication Guide](authentication.md) before exposing APIWeave to the network.
- A host (VM, bare metal, or K8s node) with Docker Engine 24+ and Docker Compose v2.
- A MongoDB 7+ instance, DNS records, TLS certificates from a trusted CA, and a secret manager for `SESSION_SECRET_KEY`, OAuth client secrets, webhook tokens, HMAC secrets, and `MCP_API_KEY`.

## Deployment Options

Pick the option that matches your operational experience:

- **Local Docker Compose**: fastest path. All four components run on one host from `docker-compose.yml`. Good for evaluation and small teams.
- **Self-hosted VM**: same Compose file, but fronted by a reverse proxy (Caddy, Nginx, or Traefik) that terminates TLS. Recommended for most self-hosters.
- **Self-hosted Kubernetes**: split the four services into Deployments, mount a managed or in-cluster MongoDB, and put an Ingress in front. Pick this when you already run K8s or need horizontal scale.

## Docker Compose

The repo ships a `docker-compose.yml` at the project root with four services: `mongodb`, `backend`, `worker`, `frontend`, plus an `mcp-stdio` helper.

```bash
docker compose up -d
docker compose ps
docker compose logs -f backend worker
```

Mount a host directory for `backend/artifacts` so run reports and GridFS blobs survive container recreation. See the `volumes:` blocks in the compose file for the exact paths.

## Environment Variables

The backend reads from `backend/.env` and the frontend builds with `VITE_*` values. Full reference: [Environment Variables](../reference/environment-variables.md).

Minimum for a working dev start:

```env
MONGODB_URL=mongodb://mongodb:27017
MONGODB_DB_NAME=apiweave
APP_ENV=development
```

Production must add at minimum `APP_ENV=production`, `BASE_URL`, `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `TRUSTED_HOSTS`, `SESSION_SECRET_KEY`, `SESSION_COOKIE_SECURE=true`, `CSRF_ENABLED=true`, `WEBHOOK_REQUIRE_HMAC=true`, and `MCP_REQUIRE_API_KEY=true`. Treat the [Security Guide](security.md) checklist as the source of truth.

## MongoDB

MongoDB is the system of record. The worker reads `runs` documents directly, so anyone with write access to that collection can trigger arbitrary workflow execution.

- Bind MongoDB to a private network. Never expose port 27017 to the public internet.
- Use authentication (`--auth` or managed equivalent) and a strong password.
- Prefer a replica set so single-node loss does not stop runs.
- Do not share the cluster with tenants outside your trust boundary.

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

APIWeave stores workflows, runs, environments, collections, webhooks, and execution logs in MongoDB. Use the standard MongoDB backup tooling:

- **Self-hosted**: `mongodump` for logical backups, filesystem snapshots (LVM/ZFS) for physical backups, or MongoDB's own ops manager / cloud backup for managed setups.
- **MongoDB Atlas**: enable continuous cloud backup and periodic restore drills.
- Test a restore at least once per quarter. An untested backup is not a backup.
- Store backup files encrypted and on separate infrastructure from the database host.

## Observability

- **Logs**: backend and worker print to stdout; mirror to your log stack. Per-run traces live at `backend/logs/run_{runId}.log`.
- **Health**: `GET /api/health` returns liveness. Hit it from your proxy or uptime monitor.
- **Run state**: the frontend polls `GET /api/runs/{runId}` (fast 100 ms for 2 s, then 1 s) and shows live status on the canvas.
- **Audit**: webhook logs and admin actions land in MongoDB collections; surface them through MCP read tools.

## Pre-Production Checklist

- [ ] `APP_ENV=production`; `DEBUG=false`.
- [ ] HTTPS-only with HSTS; HTTP redirects to HTTPS.
- [ ] `BASE_URL` and `PUBLIC_BASE_URL` set to the real HTTPS backend URL.
- [ ] `ALLOWED_ORIGINS` lists the exact HTTPS frontend origin; no wildcard.
- [ ] `TRUSTED_HOSTS` lists the public hostnames only.
- [ ] `SESSION_SECRET_KEY` is a strong random value from a secret manager.
- [ ] `SESSION_COOKIE_SECURE=true`, `CSRF_ENABLED=true`.
- [ ] OAuth callback URLs in the provider console match `PUBLIC_BASE_URL`.
- [ ] `WEBHOOK_REQUIRE_HMAC=true`; webhook tokens and HMAC secrets stored in CI secret store.
- [ ] `MCP_REQUIRE_API_KEY=true` with a strong `MCP_API_KEY`; `MCP_ALLOWED_ORIGINS` restricted.
- [ ] MongoDB bound to the private network, auth enabled, backups verified.
- [ ] `BLOCK_PRIVATE_NETWORKS=true` so the executor cannot reach internal services.
- [ ] First admin created via SSO; setup mode reviewed.

Full source: [Security Guide](security.md) and [Authentication Guide](authentication.md).

## Doc-Truth Check

The CI pipeline includes a lightweight doc-truth check (`scripts/doc-truth-check.sh`) that runs on every pull request touching `docs/`, `backend/`, or `frontend/src/`. It greps the scoped docs for stale "Not Yet Supported" callouts and the architecture reference for a `## Known Gaps` heading. The check is advisory (it does not block the build) — it signals when documentation content is out of sync with the shipped feature set.

- **Trigger**: PR touching `docs/`, `backend/`, or `frontend/src/`.
- **Script**: `scripts/doc-truth-check.sh`
- **Scope**: 9 feature and operations docs + `docs/reference/architecture.md`
- **Failure**: Any match causes exit code 1; CI notes the failure but continues.

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
