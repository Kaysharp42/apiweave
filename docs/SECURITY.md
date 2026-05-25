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

## Related Guides

- [Authentication Setup](AUTH_SETUP.md)
- [Webhook Quick Start](WEBHOOK_QUICKSTART.md)
- [MCP Integration Guide](MCP.md)
