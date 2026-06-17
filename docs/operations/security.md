# Security

*Production security model and deployment guardrails for APIWeave 2.0. Read this before exposing the platform to anyone outside your laptop.*

## Prerequisites

- [Authentication](authentication.md) for the per-instance owner, the SSO model, and the organization and workspace context
- [Deployment](deployment.md) for environment variables and reverse proxies
- [Encryption](encryption.md) for the per-scope Libsodium keypair model and the master KEK
- [Audit Log](audit.md) for the append-only event log that every meaningful action writes
- [Webhooks](../features/webhooks.md) if you trigger runs from CI/CD
- [MCP Integration](../features/mcp-integration.md) if AI agents call the platform

## Table of Contents

- [Authentication Model](#authentication-model)
- [Session Security](#session-security)
- [CSRF Protection](#csrf-protection)
- [CORS and Cookies](#cors-and-cookies)
- [Trusted Hosts and HTTPS](#trusted-hosts-and-https)
- [Webhook Authentication](#webhook-authentication)
- [MCP Authentication](#mcp-authentication)
- [Scoped Trust Boundaries](#scoped-trust-boundaries)
- [Worker Process Exposure](#worker-process-exposure)
- [SSRF Protection](#ssrf-protection)
- [Secret Masking](#secret-masking)
- [Audit Trail](#audit-trail)
- [Deployment Security Checklist](#deployment-security-checklist)
- [What NOT To Do](#what-not-to-do)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Authentication Model

APIWeave separates four credential systems on purpose. Do not blur them.

| Surface | Audience | Credential | Lifetime |
| --- | --- | --- | --- |
| Browser UI | Human users | OAuth/OIDC SSO session cookie | Idle 12h, absolute 7d |
| Workspace webhooks | CI/CD systems | `X-Webhook-Token` plus HMAC | Per-webhook, regenerable |
| Scoped service tokens | MCP, webhooks, future integrations | `Authorization: Bearer <scoped-token>` | Token expiry, revocable, narrowable |
| OAuth provider callbacks | Public | Provider authorization code | Single use |

Each system uses a different header, a different key store, and a different audit trail. A webhook token must never appear in a browser request. A user SSO cookie must never appear in a CI/CD job. A scoped service token must never appear in a workflow configuration value.

Human users sign in through OAuth or OIDC providers (GitHub, GitLab, Google, Microsoft). The browser receives an HttpOnly session cookie. The backend never sees the OAuth access token in user-space. There is no password login and no browser-visible admin secret.

Machine integrations (webhooks, MCP, scoped service tokens) authenticate with their own keys and never touch the browser session. See [Authentication](authentication.md) for the full SSO setup walkthrough.

## Session Security

The session cookie is the only thing a logged-in browser holds. Treat it like a password.

- `HttpOnly`: the cookie is not readable by JavaScript, so a cross-site scripting bug cannot leak it.
- `Secure` in production: browsers send the cookie only over HTTPS. Production must keep this on. Local development may turn it off to test on plain HTTP.
- `SameSite=Lax` by default: the cookie is sent on top-level navigations but not on most cross-site sub-requests, which blocks the common CSRF vectors.
- Idle timeout: 12 hours. After 12 hours of no activity the session expires and the user must sign in again.
- Absolute timeout: 7 days. Even with continuous activity, the session ends after a week and forces a fresh sign-in.
- Rotation on login and privilege change: signing in issues a fresh cookie. Privilege changes (admin promotion, role change) invalidate the current session.

`SESSION_SECRET_KEY` must be a strong random value loaded from deployment secret management, not from source. The same secret is used to sign session payloads, so anyone with the secret can forge sessions.

Do not put OAuth tokens, session IDs, or API keys in browser localStorage, sessionStorage, Zustand persistence, or any JavaScript-readable storage. The HttpOnly cookie is the only thing that should hold session state on the client.

## CSRF Protection

State-changing browser requests go through a double-submit cookie check.

1. The backend sets a non-HttpOnly cookie called `csrftoken` when it serves any page.
2. The frontend reads that cookie and sends the same value in the `X-CSRF-Token` request header for POST, PUT, PATCH, and DELETE calls.
3. The backend compares the cookie value against the header value. A mismatch or a missing header returns 403 before the route handler runs.
4. Requests without a session cookie bypass the check, because there is no logged-in user to protect.
5. GET, HEAD, and OPTIONS skip the check entirely because they are not state-changing.

Webhooks have their own authentication (`X-Webhook-Token` plus HMAC) and are intentionally exempt from the CSRF flow. Do not rely on the CSRF token for webhook endpoints.

Keep `CSRF_ENABLED=true` in production. Do not replace the protection with same-origin assumptions alone; a same-origin assumption does not survive a misconfigured CORS rule or a malicious browser extension.

## CORS and Cookies

CORS controls which browser origins can call the backend with credentials. The configuration is narrow on purpose.

```env
APP_ENV=production
ALLOWED_ORIGINS=https://app.apiweave.example.com
```

Rules:

- Do not use wildcard origins (`*`) with credentialed requests. The browser blocks it, and the backend rejects the misconfiguration on startup.
- Include only the exact HTTPS frontend origin in production. Subdomains, schemes, and ports are not wildcards; each one must be listed.
- Local development origins are limited to `http://localhost:3000` and similar local-only hosts. Do not add staging or production hosts to the development list.
- If a reverse proxy terminates TLS, configure it to forward the original scheme and host headers, and to enforce HTTPS redirects on plain-HTTP traffic.

## Trusted Hosts and HTTPS

The backend rejects requests whose `Host` header is not on the trusted list. This blocks DNS rebinding and host-header attacks.

```env
TRUSTED_HOSTS=apiweave.example.com,app.apiweave.example.com
PUBLIC_BASE_URL=https://apiweave.example.com
```

Rules:

- Use HTTPS for every public surface: the browser app, OAuth callbacks, the MCP HTTP endpoint, and webhook receivers.
- Local development on `http://localhost` is fine. Every other environment must be HTTPS.
- TLS termination at a reverse proxy is the recommended pattern. The proxy should redirect plain HTTP to HTTPS, use modern TLS settings, and forward `X-Forwarded-Proto` and `X-Forwarded-Host` so the backend sees the original scheme and host.
- Public base URLs go in `PUBLIC_BASE_URL` for callback configuration. The backend uses this to build absolute URLs in OAuth flows and webhook payloads.

## Webhook Authentication

Webhooks are machine-to-machine. Each webhook has a token and a per-webhook HMAC secret. See [Webhooks](../features/webhooks.md) for the full setup guide.

Production requirements:

- `WEBHOOK_REQUIRE_HMAC=true` keeps HMAC enforcement on. With this on, token-only execution is rejected.
- Each trigger sends three headers: `X-Webhook-Token` (identity), `X-Webhook-Signature` (integrity), and `X-Webhook-Timestamp` (replay protection).
- The signature is HMAC-SHA256 over the concatenation of the timestamp string and the raw request body, output as a lowercase hex string with no `sha256=` prefix.
- The replay window is plus or minus 300 seconds from the server clock. Outside the window the request is rejected.
- Store the token and the HMAC secret in your CI/CD secret store (GitHub Actions secrets, GitLab CI masked variables, Jenkins credentials). Never commit them to source.

If you previously created webhooks without HMAC, they keep working in development. In production you will see a warning log for each unauthenticated request until you regenerate the credentials and add the HMAC headers to your pipeline.

Webhook management (create, edit, delete, regenerate) is a human action that uses the same SSO session and CSRF protection as the rest of the UI. Webhook execution remains a separate, machine-only flow.

## MCP Authentication

The MCP HTTP endpoint is for AI agents and remote IDE integrations. It uses a scoped service token, not a global API key and not a session cookie. See [MCP Integration](../features/mcp-integration.md) for the transport details.

Production settings:

```env
MCP_ENABLED=true
MCP_HTTP_ENABLED=true
MCP_ALLOWED_ORIGINS=https://trusted-agent-host.example.com
```

The bearer token is a scoped service token created in the workspace or organization settings, with the narrowest permission set that the agent actually needs. There is no `MCP_API_KEY` in 2.0.

Rules:

- Every request to `/mcp` must carry `Authorization: Bearer <scoped-service-token>`.
- The `Origin` header is validated against `MCP_ALLOWED_ORIGINS`. Add only the exact origins of trusted agent hosts.
- A token whose permission set does not include the called tool returns 403 with the missing permission. There is no implicit grant.
- The token is intentionally separate from SSO sessions, CSRF cookies, and browser permissions. Do not use it as a user login credential, and do not expose it to frontend code.
- Stdio MCP is local-subprocess access and is appropriate only for trusted local agents. Do not run a stdio MCP client over a network boundary.

The MCP read and export tools redact persisted secrets in their responses. Runtime secret input was removed in 2.0; secret writes require a `secrets.write` permission on a scoped service token and a Libsodium sealed-box payload. The `MCP_ALLOW_SECRET_WRITES` flag from 1.0 is gone.

## Worker Process Exposure

The worker process polls the database for runs that are waiting to execute and runs them with the executor's full privileges (outbound HTTP, file reads, network policy checks). The worker has no authentication context of its own.

This makes the database the de-facto trust boundary for run creation.

- MongoDB must not be reachable from untrusted networks. Anyone who can write a document with `status: "pending"` to the runs collection can cause arbitrary workflow execution. The executor honors the `workflowId` referenced in the run, and the run's nodes and variables come from the workflow document, so a write to the runs collection is effectively code execution inside the executor.
- Bind MongoDB to localhost or a private network. Do not expose port 27017 to the public internet, and do not share the database cluster with tenants outside your trust boundary.
- Treat MongoDB-level access as a superset of the `runs:write` API permission. A user with that permission can already create pending runs through the normal API. Database access is a stronger capability and must stay inside the same trust boundary as the backend.
- The rate limiter uses an in-process counter by default. A single-process API server gets correct per-webhook limits. A multi-worker deployment behind a load balancer sees each process enforce its own counter, so the effective limit becomes `max_requests * worker_count`. For horizontal scaling, run an external limiter (Redis or another shared store) or accept the multiplier until the shared-store backend ships.

## SSRF Protection

APIWeave blocks outbound requests to private and reserved IP ranges by default. The blocklist is in effect for the workflow executor, the OpenAPI importer, and the MCP import tools.

Blocked ranges include the IPv4 loopback (`127.0.0.0/8`), the link-local metadata range (`169.254.0.0/16`), the three RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and the IPv6 equivalents (`::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`).

The block is on by default and is required in production. To allow specific internal hosts, add them to the approved-domains allowlist rather than turning the block off.

Impact for existing workflows:

- Workflows that call `http://127.0.0.1` or `http://localhost` to reach internal services are now blocked. Update the URLs to public hostnames, or add the host to the allowlist.
- MCP import tools inherit the same block. See the MCP import notes in [MCP Integration](../features/mcp-integration.md) for the recommended workaround when an OpenAPI spec lives on an internal host.

## Scoped Trust Boundaries

Every resource in 2.0 lives at a scope. The scopes are `org`, `workspace`, `environment`, `secret`, and `service_token`. A user with permission on a workspace is not automatically a member of the organization; a team with a grant on one environment does not have it on the next. The permission model is the first line of defense.

Rules:

- A user with the `workflows:run` permission on a workspace cannot read the workspace's secrets. The runner resolves `{{secrets.NAME}}` and the masking layer scrubs the value before the result is persisted.
- A user with the `secrets:write` permission on a scope cannot read the value back. The write path accepts a Libsodium sealed box; the read path returns metadata only.
- A scoped service token cannot exceed its declared permission set. The `secrets.write` permission lets it write sealed boxes; without the `secrets.read.metadata` permission, it cannot even see the secret list.
- A user removed from an organization loses access to every workspace, environment, secret, and service token that the organization owns. A user removed from a workspace loses access to that workspace's resources but keeps their org membership and other workspaces.
- Slug reuse after soft delete is blocked. Once a slug is retired, no future resource can claim it. The check applies to organization slugs, workspace slugs, team slugs, and environment names.

## Secret Masking

Persisted secret values are redacted in stored results, exports, and most log output. The masking detector uses key-name patterns plus structural walking, and the secret service also runs value-aware masking on the resolved secret set before any persistence layer sees it.

Fields whose names match `api_key`, `token`, `password`, `*_key`, `*_secret`, `*_credential`, and similar patterns are replaced with `<SECRET>` placeholders. The detection runs on the JSON tree of every result, so nested objects and arrays are covered. The value-aware masking layer also scrubs any value that matches the resolved secret set, even when the field name does not look like a secret.

Implications:

- A non-secret value whose name happens to match a secret pattern (a field literally called `token` that holds a JWT, for example) will be redacted. Rename the field or move the value out of the result if you need it visible.
- Project and workflow exports carry references only, not values, ciphertext, or per-scope private keys. The `.awecollection` v2 bundle never includes a secret value. The destination operator re-creates the values through the Libsodium write flow.
- Environment variable debug logs do not print raw values. Use the redaction-safe log format when investigating a run.

## Audit Trail

Every meaningful action in 2.0 writes an append-only audit event. The audit log is the canonical record of who did what, when, against which scope, and which resource. Take a JSON export before any destructive operation, including the destructive database reset that the 2.0 install requires. See the [Audit Log guide](audit.md) for the event model, the filter set, and the export flow.

## Deployment Security Checklist

Walk through this list before opening the platform to anyone outside the deployment team.

- [ ] `APP_ENV=production` or `prod`.
- [ ] `BASE_URL` and `PUBLIC_BASE_URL` point to the HTTPS public backend URL.
- [ ] OAuth callback URLs match the production backend URL for every enabled provider (GitHub, GitLab, Google, Microsoft).
- [ ] `SESSION_SECRET_KEY` is set from a secret manager and is at least 32 bytes of random data.
- [ ] `SESSION_COOKIE_SECURE=true` so the session cookie is HTTPS-only.
- [ ] `CSRF_ENABLED=true` so the double-submit cookie check stays on.
- [ ] `ALLOWED_ORIGINS` contains the exact HTTPS frontend origin only. No wildcards. No development hosts.
- [ ] `TRUSTED_HOSTS` (or the reverse proxy host allowlist) contains only the expected public hostnames.
- [ ] `WEBHOOK_REQUIRE_HMAC=true` so webhook execution requires an HMAC signature.
- [ ] `MCP_HTTP_ENABLED=true` only when the Streamable HTTP transport is actually used, and `MCP_ALLOWED_ORIGINS` is restricted to trusted agent hosts.
- [ ] Scoped service tokens for MCP, webhooks, and CI/CD are created with the narrowest permission set the consumer needs. The 1.0 `MCP_API_KEY` is not used.
- [ ] OAuth client secrets, webhook tokens, HMAC secrets, and the master `SECRET_ENCRYPTION_KEY` are stored outside source control (CI/CD secret store, vault, KMS).
- [ ] MongoDB is bound to localhost or a private network. Port 27017 is not exposed to the public internet.
- [ ] The destructive database reset ran before the first sign-in, and the audit log was exported to a separate host before the reset.
- [ ] Approved-domain signup is either disabled or restricted to owned domains.
- [ ] The first owner account was created through a verified SSO email and has been audited.
- [ ] TLS termination enforces HTTPS redirects and modern TLS settings (TLS 1.2 or higher, modern cipher list).

## What NOT To Do

Anti-patterns that bypass the security model. Each of these is a known footgun.

- Do not store OAuth access tokens, session IDs, or session secrets in localStorage, sessionStorage, Zustand persistence, or any JavaScript-readable browser storage. Use the HttpOnly session cookie only.
- Do not expose admin keys, deployment secrets, OAuth client secrets, or HMAC secrets to the browser. The frontend bundle is public; anything in it is public.
- Do not use wildcard CORS (`*`) with credentialed requests. Browsers block it; the backend rejects the misconfiguration; the intent is a footgun.
- Do not run a public production deployment with `SESSION_COOKIE_SECURE=false`. Plain-HTTP cookies are sniffable.
- Do not disable CSRF protection for browser-authenticated mutations. The double-submit cookie check is the defense against cross-site form posts.
- Do not introduce password login. APIWeave is SSO-only in v1; there is no password store to leak.
- Do not use webhook tokens or scoped service tokens as human login credentials. They are machine credentials with different lifecycle and audit requirements.
- Do not expose MongoDB to the public internet, and do not share the database cluster across trust boundaries. The runs collection is a write surface for arbitrary workflow execution.
- Do not turn off the SSRF blocklist (`BLOCK_PRIVATE_NETWORKS`) in production. If a workflow needs to call an internal service, add the host to the approved-domains allowlist instead.
- Do not use a weak or shared `SESSION_SECRET_KEY`. Rotate it like any other secret, and treat the value as production data.
- Do not paste a plaintext secret value into a write endpoint. The 2.0 write path is Libsodium sealed-box only; the backend rejects plaintext.
- Do not ship a secret value or ciphertext in a `.awecollection` bundle. The v2 schema is references only.

## Troubleshooting

- **If the browser signs in but every state-changing request returns 403**, the frontend is not sending the `X-CSRF-Token` header, or the header value does not match the `csrftoken` cookie. Confirm both are present and identical, and that `CSRF_ENABLED` is `true`. Webhook endpoints are exempt by design; this check is for browser sessions.
- **If a workflow that used to call `http://127.0.0.1` or `http://localhost` now fails**, the SSRF blocklist is rejecting the target. Either update the URL to a public hostname or add the host to the approved-domains allowlist. The block is required in production and there is no flag to disable it safely.
- **If webhook triggers work in development but return 401 in production**, HMAC is required and the request is missing `X-Webhook-Signature` and `X-Webhook-Timestamp`. Regenerate the credentials, add the three headers to the pipeline, and verify the signing scheme is HMAC-SHA256 over `timestamp + body` with a lowercase hex output.
- **If the per-webhook rate limit seems to drift between deployments**, the rate limiter is in-process by default. A multi-worker deployment sees `max_requests * worker_count`. Add an external shared store, or accept the multiplier until the shared backend ships.
- **If a stored result is missing values that look redacted**, the field name matches a secret pattern (`api_key`, `token`, `password`, `*_key`, `*_secret`, `*_credential`). Rename the field or move the value out of the JSON result if it is not actually a secret.
- **If an operator can trigger runs that should not be possible**, audit MongoDB access. Anyone with write access to the runs collection can create pending runs; that is a stronger capability than the API permission model and must stay inside the same trust boundary as the backend.

## Related

- [Authentication](authentication.md)
- [Deployment](deployment.md)
- [Encryption](encryption.md)
- [Audit Log](audit.md)
- [Environment Protection](environment-protection.md)
- [Webhooks](../features/webhooks.md)
- [MCP Integration](../features/mcp-integration.md)
- [Environment Variables](../reference/environment-variables.md)
