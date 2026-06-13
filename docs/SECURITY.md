# Security Guide

This guide summarizes the production security posture expected for APIWeave deployments.

## Human Authentication Model

APIWeave human users authenticate with SSO only. The backend owns the session and sends an HttpOnly cookie to the browser. There is no password login in v1 and no browser-visible admin secret.

## Session Security

Production session requirements:

- `SESSION_SECRET_KEY` is a strong random secret stored in deployment secret management.
- Session cookie is `HttpOnly` so JavaScript cannot read it.
- `SESSION_COOKIE_SECURE=true` so browsers send it only over HTTPS.
- `SESSION_COOKIE_SAMESITE=lax` unless a stricter deployment-specific setting is proven compatible.
- Idle timeout is 12 hours: `SESSION_MAX_IDLE_MINUTES=720`.
- Absolute timeout is 7 days: `SESSION_MAX_ABSOLUTE_MINUTES=10080`.
- Sessions rotate on login and privilege-changing events.
- Logout revokes the current session and clears the cookie.

Development override: `get_session_cookie_secure()` returns false only when `APP_ENV=development`, allowing local HTTP testing. Production (`APP_ENV=production` or `prod`) must keep secure cookies enabled.

## CSRF Protection

APIWeave uses a double-submit cookie pattern for browser mutations:

- The backend issues a non-HttpOnly `csrftoken` cookie.
- The frontend sends the same value in the `X-CSRF-Token` header for state-changing requests.
- The backend rejects missing or mismatched tokens.

Keep `CSRF_ENABLED=true` for production. Do not replace CSRF protection with same-origin assumptions alone.

## CSRF Middleware Behavior

The CSRF middleware in `backend/app/main.py:80-113` enforces CSRF protection ONLY for state-changing requests (POST, PUT, PATCH, DELETE) that include a `session` cookie AND a `csrftoken` cookie.

### What IS protected:
- State-changing requests with both `session` and `csrftoken` cookies are validated. Missing or mismatched `X-CSRF-Token` header returns 403.
- The check is enforced before the route handler runs.

### What is NOT protected:
- Requests without a `session` cookie bypass CSRF entirely. This is intentional for webhooks (`/api/webhooks/...`) and the public API endpoints that use token-based auth.
- GET, HEAD, OPTIONS methods skip CSRF validation entirely.
- Webhook endpoints (`/api/webhooks/.../execute`) are intentionally exempt — they authenticate via `X-Webhook-Token` header.

### Regression guidance:
If you add a new session-protected API endpoint:
1. The CSRF middleware will automatically cover it — no additional code needed.
2. The frontend must include the `csrftoken` cookie value as `X-CSRF-Token` header on state-changing requests.
3. The endpoint will return 403 if either cookie is missing or the header doesn't match.

If you add an endpoint that should be exempt from CSRF (e.g., a custom auth callback):
- Add the path to `_CSRF_EXEMPT_EXACT` or `_CSRF_EXEMPT_PREFIXES` in `main.py:69-77`.

## CORS and Cookies

The backend uses credentialed CORS because the browser sends session cookies. Production deployments must set exact frontend origins:

```env
APP_ENV=production
ALLOWED_ORIGINS=https://app.apiweave.example.com
```

Rules:

- Do not use wildcard origins (`*`) with `allow_credentials=true`.
- Include only HTTPS frontend origins in production.
- Keep local development origins limited to `http://localhost:3000`, `http://localhost:5173`, or equivalent local-only hosts.
- If a reverse proxy terminates TLS, ensure it forwards the correct scheme/host headers and enforces HTTPS redirects.

## Trusted Hosts and HTTPS

Production deployments should restrict accepted hostnames at the reverse proxy and app configuration layer:

```env
TRUSTED_HOSTS=apiweave.example.com,app.apiweave.example.com
PUBLIC_BASE_URL=https://apiweave.example.com
```

Use HTTPS for all public browser, OAuth callback, MCP HTTP, and webhook endpoints. Development can use localhost HTTP only.

## Webhook Authentication

Webhook execution is machine-to-machine authentication, not human session authentication.

Each webhook has:

- `X-Webhook-Token` for webhook identity.
- `X-Webhook-Signature` HMAC-SHA256 signature for payload integrity.
- `X-Webhook-Timestamp` for replay-window enforcement.

Production deployments must set:

```env
WEBHOOK_REQUIRE_HMAC=true
```

With this enabled, token-only webhook execution is rejected. Store webhook tokens and HMAC secrets in CI/CD secret stores, not in source code or browser configuration.

Webhook management is a human authenticated UI/API action controlled by `webhooks:*` permissions. Execution remains M2M.

## MCP Authentication

MCP is also machine-to-machine access and is separate from human browser sessions.

For Streamable HTTP MCP in production:

```env
MCP_ENABLED=true
MCP_HTTP_ENABLED=true
MCP_REQUIRE_API_KEY=true
MCP_API_KEY=<strong-random-key>
MCP_ALLOWED_ORIGINS=https://trusted-agent-host.example.com
```

Requests must include `Authorization: Bearer <MCP_API_KEY>`. MCP read/export tools redact persisted secrets, and runtime secrets are accepted only where explicitly supported. Stdio MCP is local subprocess access and should be available only to trusted local agents.

## Deployment Security Checklist

Before exposing APIWeave publicly:

- [ ] `APP_ENV=production` or `prod`.
- [ ] `BASE_URL` / `PUBLIC_BASE_URL` use HTTPS public backend URLs.
- [ ] OAuth callback URLs match the production backend URL for GitHub, GitLab, Google, and Microsoft.
- [ ] `SESSION_SECRET_KEY` is set from a secret manager.
- [ ] `SESSION_COOKIE_SECURE=true`.
- [ ] `CSRF_ENABLED=true`.
- [ ] `ALLOWED_ORIGINS` contains exact HTTPS frontend origins only; no wildcard.
- [ ] `TRUSTED_HOSTS` or the reverse proxy host allowlist contains only expected hostnames.
- [ ] `WEBHOOK_REQUIRE_HMAC=true`.
- [ ] `MCP_REQUIRE_API_KEY=true` when HTTP MCP is enabled.
- [ ] `MCP_API_KEY`, OAuth client secrets, webhook tokens, and HMAC secrets are stored outside source control.
- [ ] Approved-domain signup is either disabled or restricted to owned domains.
- [ ] First admin setup has been completed with a verified SSO email.
- [ ] Last-admin protection and admin invite process are verified before onboarding users.
- [ ] TLS termination enforces HTTPS redirects and modern TLS settings.

## What Not To Do

- Do not store OAuth access tokens, session IDs, or session secrets in localStorage, sessionStorage, Zustand persistence, or any JavaScript-readable browser storage.
- Do not expose admin keys or deployment secrets to the browser.
- Do not use wildcard CORS with credentialed requests.
- Do not run public production with `SESSION_COOKIE_SECURE=false`.
- Do not disable CSRF protection for browser-authenticated mutations.
- Do not use password login in v1; APIWeave is SSO-only.
- Do not use webhook tokens or MCP API keys as human login credentials.

## Worker Process Exposure

The APIWeave worker process (`backend/app/worker.py`) polls MongoDB for pending runs and executes them via `WorkflowExecutor.execute()`. The worker has no authentication context of its own. It claims any document in the `runs` collection whose `status` is `pending` and runs it with the executor's full privileges, which include outbound HTTP, file reads, and the `BLOCK_PRIVATE_NETWORKS` policy check.

Consequences:

- **MongoDB must not be reachable from untrusted networks.** Anyone who can write to the `runs` collection with `status: "pending"` can cause arbitrary workflow execution. The executor honors any `workflowId` referenced in the run, and the run's `nodes` and `variables` come from the workflow document, so a write to that collection is effectively code execution inside the executor.
- **Deployment requirement.** Bind MongoDB to localhost or a private network. Do not expose port 27017 to the public internet, and do not share the database cluster with tenants outside your trust boundary.
- **Defense in depth.** `BLOCK_PRIVATE_NETWORKS=true` (the default, and required in production) stops the executor from reaching `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and other reserved ranges, so a compromised run still can't pivot to internal services.
- **Operator access is sufficient.** A user with the `runs:write` permission can also create pending runs through the API, which is the intended path. Treat MongoDB-level access as a superset of that capability.

## Rate Limiter Backend

The webhook rate limiter (`backend/app/middleware/rate_limiter.py`) uses an in-memory sliding window by default. The `RATE_LIMITER_BACKEND` setting selects the storage backend:

- `RATE_LIMITER_BACKEND=memory` (default). Per-process counters stored in a `defaultdict` inside the middleware instance. Counters reset on process restart and are not shared between worker processes.
- `RATE_LIMITER_BACKEND=mongodb`. Reserved for a future MongoDB-backed implementation. Selecting this value today does not switch the backend; the middleware still uses the in-memory implementation. Do not rely on `mongodb` for cross-process limiting until the implementation lands.

Operational impact:

- A single-process API server (the default `uvicorn` deployment) gets correct per-webhook limits.
- A multi-worker deployment behind a load balancer, or a horizontally scaled API, will see each process enforce its own counter. The effective limit becomes `max_requests * worker_count` until you switch to a shared store.
- For production deployments with more than one API process, run an external limiter (Redis or another shared store) or add a worker token plus a coordinated limiter. Tracking this is out of scope for the current release.

## Migration Notes (Wave 2)

The following breaking changes were introduced in Wave 2 of the security-remediation plan. Existing deployments must update their configuration and verify their workflows still operate correctly.

### SSRF Protection (F1, F2, F12)

All outbound HTTP requests from the executor, OpenAPI importer, and MCP tools are now validated against a blocklist of private/reserved IP ranges:
- 0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 (metadata), 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- IPv6: ::/128, ::1/128, fc00::/7, fe80::/10, ff00::/8

**Action required**: If your workflows use `http://127.0.0.1` or `http://localhost` to call internal services, they will now be BLOCKED. Update your workflow URLs to use the public hostname or set `APPROVED_DOMAINS` in your environment to allowlist internal hosts.

### Secret Masking (F4, F10, F15, F19)

The executor's secret masking now uses key-name-based detection (api_key, token, password, *_key, *_secret, etc.) plus structural walking. This is more robust but also more aggressive:
- Fields named like `api_key`, `token`, `password`, `*_credential` are now redacted in result storage
- Env variable debug logs no longer print raw values

**Action required**: If your workflow produces non-secret values with names matching these patterns (e.g., a field literally called `token` that holds a JWT), it will now be redacted. Rename the field or remove the secret from the result.

### Webhook HMAC Enforcement (F9)

The `WEBHOOK_REQUIRE_HMAC` flag now triggers a WARNING log in production when disabled. This is a per-request warning, not a startup failure.

**Action required**: Existing webhook integrations without HMAC will continue to work in dev/staging. In production, configure HMAC for all webhooks to avoid the warning and improve security.

### Webhook Body Size Limit (F18)

All webhook payloads are now rejected with 413 if they exceed `MAX_WEBHOOK_BODY_SIZE` (default: 65536 bytes / 64KB).

**Action required**: If you have webhooks sending payloads > 64KB, increase the `MAX_WEBHOOK_BODY_SIZE` setting or reduce the payload size.

### Post-Wave 2 Regression Fix: Parallel HTTP Branches

Wave 2's rewiring of `safe_request()` into `_execute_http_request` (F1) surfaced two coupled bugs in the executor. Workflows with parallel HTTP branches (for example, two `http-request` nodes reached from a `merge` node, or any two branches that each hit the same URL) intermittently failed with `HTTP request failed ... Connection closed` and `coroutine raised StopIteration`, with `All N branches failed` reported by `asyncio.gather`.

**Root cause 1 — `safe_request()` returned a response from a closed session.**

`backend/app/services/safe_http.py::safe_request` was structured as `async with aiohttp.ClientSession(...) as session: response = await session.request(...); return response`. The `async with` exit closed the session (and its connection pool) *before* the response reached the caller. When `_execute_http_request` then called `await response.text()` on the detached response, aiohttp raised `Connection closed`. aiohttp's session teardown is scheduled, not synchronous, so the bug appeared as a race: one branch's read landed before teardown and succeeded, the other landed after and failed.

**Root cause 2 — `raise StopIteration` in a coroutine.**

`backend/app/runner/executor.py::_execute_node` used `raise StopIteration(error_msg)` as a control-flow sentinel so the `except Exception:` handlers in the executor would not catch the intentional stop from `continue_on_fail=False`. Since Python 3.7 a coroutine that raises `StopIteration` triggers PEP 479 and asyncio reports it as `RuntimeError: coroutine raised StopIteration`. This was latent for years: the HTTP path always succeeded before Wave 2, so the error-stop branch was never reached. Once Root cause 1 forced the error path, Root cause 2 fired and propagated through `asyncio.gather`.

**Fix**:

- `safe_request`, `safe_get`, and `safe_post` now return `tuple[ClientResponse, ClientSession]` and keep the session open. The caller (`_execute_http_request`) closes both in a `finally` block. The redirect loop reuses a single session across hops, so connection pooling still works.
- A new internal `_StopBranch(BaseException)` class replaces `StopIteration` as the intentional-stop sentinel. Inheriting from `BaseException` (not `Exception`) preserves the original "bypass `except Exception:`" intent without triggering PEP 479.
- A regression test `test_returned_session_keeps_response_readable` was added in `tests/test_safe_http.py` to read the body through the returned session and catch this class of bug in the future.

**No action required** for existing deployments — the fix is a bug fix, not a behavior change. Workflows that exhibited the symptom will now succeed.

## Related Guides

- [Authentication Setup](AUTH_SETUP.md)
- [Webhook Quick Start](WEBHOOK_QUICKSTART.md)
- [MCP Integration Guide](MCP.md)
