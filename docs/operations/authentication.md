# Authentication

*How APIWeave authenticates human users and machine clients in 1.0. Covers the SSO model, the local admin bootstrap, session policy, approved domains, and the OAuth provider setup that is scheduled for 1.1.*

## Prerequisites

- Read the [Security Guide](../security.md) for the cross-cutting posture (CSRF, CORS, secrets, worker exposure).
- A running APIWeave instance with a verified backend `BASE_URL` and a frontend origin in `ALLOWED_ORIGINS`.
- A secret manager for `SESSION_SECRET_KEY`, `SECRET_KEY`, and the future OAuth client secrets.

## Not Yet Supported in 1.0

> **OAuth and OIDC multi-user login are not yet active in 1.0.** The four supported providers (GitHub, GitLab, Google, Microsoft) are configured in the environment reference and the callback routes are wired, but the multi-user OAuth login path is **not yet enabled in this release**. The only working sign-in path today is a single local admin created through setup mode. Multi-user SSO, invite links, and approved-domain signup all depend on the OAuth login path and become available together in 1.1.
>
> What works in 1.0:
>
> - The first admin can sign in through setup mode and bootstrap the instance.
> - Browser sessions are signed and stored in an HttpOnly cookie.
> - Approved-domain settings and setup-mode flags are read by the backend (so the configuration is already in place for 1.1).
> - OAuth client ID and secret variables can be set; they will activate when the login path ships.
>
> What does **not** work in 1.0:
>
> - OAuth/OIDC sign-in buttons on the login page. The buttons are not rendered.
> - Account linking, multi-user invites, and approved-domain signup via provider login.
> - Callback handlers responding to a real provider authorization code (the route is wired but the handshake is not yet active).
>
> Track status under "Known Gaps" in the [Architecture Reference](../reference/architecture.md). The provider-by-provider setup instructions for 1.1 are preserved later in this page so you can prepare the credentials ahead of the release.

## Authentication Model

APIWeave has two distinct authentication paths, and they never share credentials.

**Human users (browsers):** SSO only. The browser never sees a password field, and there is no local password login in 1.0. The backend owns the session and sends an HttpOnly cookie to the browser. The cookie is signed with `SESSION_SECRET_KEY` and validated on every state-changing request through the double-submit CSRF pattern described in the [Security Guide](../security.md).

**Machine clients (CI/CD, AI agents):** Token-based. Webhook execution uses `X-Webhook-Token` plus an HMAC-SHA256 signature. MCP HTTP uses `Authorization: Bearer <MCP_API_KEY>`. These credentials are separate from any human session and never use the browser cookie jar. See [Webhooks](../features/webhooks.md) and [MCP Integration](../features/mcp-integration.md) for the full contract.

```
+--------+     SSO callback      +-----------+     HttpOnly cookie     +----------+
| Browser| <------------------> |  Backend  | <---------------------> |  Session |
+--------+                       +-----------+                         +----------+
                                       |
                                       | Bearer / Token
                                       v
                                 +-----------+
                                 | Webhook / |
                                 | MCP HTTP  |
                                 +-----------+
```

Why this split: humans hold an interactive session with a short idle window; machines hold a long-lived token tied to a specific integration. Mixing them would either lock humans out at automation scale or leak automation tokens into the browser.

## Setup Mode

Setup mode is the bootstrap path for the first admin. When no users exist and `SETUP_MODE_ENABLED=true`, the backend accepts a sign-in from the local admin account and creates that user with the admin role. After the first user exists, the bootstrap path locks and later users must enter through the path that ships in 1.1 (invite link or approved-domain signup).

Operational rules:

- Enable setup mode only while bootstrapping. Set `SETUP_MODE_ENABLED=false` after the first admin is created.
- Use a real, verified email for the first admin. Unverified emails are rejected and cannot bootstrap.
- Verify the first user has the admin role before you turn setup mode off. Without an admin, the instance is locked out of further onboarding.
- Do not expose an unhardened instance to the public internet while setup mode is on. Anyone who can reach the login page can become the first admin.

```env
# During first-admin bootstrap
SETUP_MODE_ENABLED=true
APPROVED_DOMAINS_ENABLED=false

# After the first admin exists
SETUP_MODE_ENABLED=false
APPROVED_DOMAINS_ENABLED=true
APPROVED_DOMAINS=example.com,example.org
```

## Approved Domains

Approved domains gate which email addresses can create accounts. Domain matching is based on the verified email returned by the provider; unverified provider emails are rejected and cannot be used for signup or account linking. Because the OAuth login path is not yet active in 1.0, this gate is read by the backend but not yet enforced end-to-end; it will enforce automatically when 1.1 turns the login path on.

| Mode | Configuration | Behavior in 1.0 | Behavior in 1.1 |
|------|---------------|------------------|------------------|
| Invite-only | `APPROVED_DOMAINS_ENABLED=false` | First admin via setup mode. | Admins generate invite links; invitees sign in through OAuth. |
| Domain signup | `APPROVED_DOMAINS_ENABLED=true` plus `APPROVED_DOMAINS` | First admin via setup mode. | Verified emails on listed domains sign in directly; admins can still send invites. |

```env
APPROVED_DOMAINS_ENABLED=true
APPROVED_DOMAINS=example.com,example.org
```

Admins retain the ability to issue invites in either mode once 1.1 lands. Treat `APPROVED_DOMAINS` as a tenant allowlist: include only the domains your organization owns, and review the list every time you add or remove a corporate domain.

## Session Policy

Sessions are server-owned and browser-transport-only. The backend stores the session state and emits a single cookie called `session` to the browser. The browser never reads, writes, or copies the cookie value.

| Property | Value | Why |
|----------|-------|-----|
| `HttpOnly` | always | Stops JavaScript from reading the cookie, which closes off the most common XSS-driven session theft path. |
| `Secure` | required in production | Browsers send the cookie only over HTTPS. Forced off only when `APP_ENV=development` for local HTTP testing. |
| `SameSite` | `lax` (default) | Stops the browser from attaching the cookie to cross-site POSTs. Tighten to `strict` only after confirming third-party login flows still work. |
| Idle timeout | 12 hours (`SESSION_MAX_IDLE_MINUTES=720`) | The session expires if the user is inactive for 12 hours. |
| Absolute timeout | 7 days (`SESSION_MAX_ABSOLUTE_MINUTES=10080`) | The session expires after 7 days from issue, even with continuous activity. |
| Rotation | on login and on privilege change | A fresh session ID is issued whenever the user's role or permissions change, which invalidates any captured pre-change session. |

Sessions rotate on login and on privilege-changing events. Logout revokes the current session and clears the cookie. The session is never stored in `localStorage`, `sessionStorage`, Zustand persistence, or any other JavaScript-readable browser store.

For the full cookie and CSRF interaction, see the [Security Guide](../security.md).

## Production Auth Checklist

A short list of the auth-related items a deployment must pass before going live. The complete deployment checklist lives in the [Security Guide](../security.md#deployment-security-checklist) and the [Deployment Guide](../operations/deployment.md).

- [ ] `APP_ENV=production` (or `prod`).
- [ ] `SESSION_SECRET_KEY` set from a secret manager, generated with `openssl rand -hex 32`.
- [ ] `SESSION_COOKIE_SECURE=true` (the backend rejects `false` outside development).
- [ ] `CSRF_ENABLED=true`.
- [ ] `ALLOWED_ORIGINS` lists the exact HTTPS frontend origin, no wildcards.
- [ ] `SETUP_MODE_ENABLED=false` after the first admin exists.
- [ ] `APPROVED_DOMAINS` contains only the domains your organization owns, or the gate is disabled for invite-only operation.

## OAuth Provider Setup (Available in 1.1)

> **The OAuth login path is not yet active in 1.0.** The instructions below are preserved for operators who want to register applications in the provider consoles ahead of the 1.1 release. Do not advertise a sign-in button that does not yet work; the buttons will appear in 1.1.

All four providers use the authorization-code flow. The callback URL is built from `PUBLIC_BASE_URL` (the public backend URL, not the frontend URL). The placeholder `{base_url}` below stands in for the value of `PUBLIC_BASE_URL` in your deployment.

Never commit real client secrets. Put them only in deployment secret storage and reference them by name from the environment.

### GitHub

GitHub is treated as OAuth (not OIDC). APIWeave calls `/user` and `/user/emails` and only accepts verified primary emails.

- Register an OAuth App at `https://github.com/settings/developers`.
- Authorization callback URL: `{base_url}/api/auth/callback/github`.
- Scopes: `read:user user:email`.
- Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.

```env
GITHUB_CLIENT_ID=<your-github-client-id>
GITHUB_CLIENT_SECRET=<your-github-client-secret>
```

### GitLab

GitLab uses OAuth and requires a verified primary email before account creation or linking.

- Register an application under your GitLab user or group settings.
- Redirect URI: `{base_url}/api/auth/callback/gitlab`.
- Scopes: `openid profile email`.
- Env: `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`.

```env
GITLAB_CLIENT_ID=<your-gitlab-client-id>
GITLAB_CLIENT_SECRET=<your-gitlab-client-secret>
```

### Google

Google is handled as OIDC. The backend validates state, PKCE, ID token claims, and nonce.

- Create a Web application OAuth client in Google Cloud Console.
- Authorized redirect URI: `{base_url}/api/auth/callback/google`.
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

```env
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
```

### Microsoft (Entra ID)

Microsoft is handled as OIDC with the same validation flow as Google. Register the app in Microsoft Entra ID and choose a tenant strategy before you copy the credentials.

- Register an application in Microsoft Entra ID, Web platform.
- Redirect URI: `{base_url}/api/auth/callback/microsoft`.
- Multi-tenant: set `MICROSOFT_TENANT=common`.
- Single-tenant: set `MICROSOFT_TENANT=<your-tenant-id>`.
- Env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`.

```env
MICROSOFT_CLIENT_ID=<your-microsoft-client-id>
MICROSOFT_CLIENT_SECRET=<your-microsoft-client-secret>
MICROSOFT_TENANT=common
```

### Callback URL Recap

The callback URL pattern is the same for all four providers. Use the backend's public URL (the value of `PUBLIC_BASE_URL`), not the frontend URL.

```text
{base_url}/api/auth/callback/github
{base_url}/api/auth/callback/gitlab
{base_url}/api/auth/callback/google
{base_url}/api/auth/callback/microsoft
```

## Environment Variables

Every variable that drives authentication is documented in the [Environment Variables Reference](../reference/environment-variables.md), under the **Authentication and OAuth**, **Sessions and CSRF**, and **Approved Domains** sections.

The minimum production set:

- `APP_ENV=production`.
- `SESSION_SECRET_KEY` (a strong random value).
- `SESSION_COOKIE_SECURE=true`.
- `SESSION_MAX_IDLE_MINUTES=720` (12 hours, default).
- `SESSION_MAX_ABSOLUTE_MINUTES=10080` (7 days, default).
- `CSRF_ENABLED=true`.
- `SETUP_MODE_ENABLED=false` after the first admin exists.
- `APPROVED_DOMAINS_ENABLED` and `APPROVED_DOMAINS` for tenant gating.

Do not set OAuth client IDs and secrets in 1.0; the login path is not yet active. When 1.1 lands, set them through your secret manager and restart the backend.

## Troubleshooting

- **If you cannot sign in at all in 1.0**, the OAuth login path is not yet active. Use setup mode to create the first admin (set `SETUP_MODE_ENABLED=true`, restart, sign in once, then set it back to `false`).
- **If the first admin sign-in is rejected**, the email you are using is not verified. Provider login requires a verified primary email. Confirm the account in the provider's email settings and retry.
- **If setup mode refuses to create the user**, a user already exists in the database. Setup mode only works while the user collection is empty. Sign in with the existing first admin, or restore the database to a clean state if you are recovering from a broken bootstrap.
- **If the session cookie is not set in the browser**, `SESSION_COOKIE_SECURE=true` is set while the page is served over HTTP, or `APP_ENV=development` is set in a production-like deploy. The browser silently drops an insecure cookie. Confirm the page is served over HTTPS and that `APP_ENV` matches the deployment.
- **If the session expires faster than expected**, check `SESSION_MAX_IDLE_MINUTES` and `SESSION_MAX_ABSOLUTE_MINUTES`. The defaults are 12 hours idle and 7 days absolute. Rotation on privilege change also forces a fresh absolute clock.
- **If `APPROVED_DOMAINS` changes are not enforced**, the OAuth login path is not yet active in 1.0. Domain matching is wired in the backend but does not gate sign-in until 1.1. The setting still takes effect the moment 1.1 turns the login path on, so set it now and let 1.1 pick it up.

## Related

- [Security Guide](../security.md) for the cross-cutting posture, CSRF, CORS, secret masking, and the worker exposure caveat.
- [Environment Variables Reference](../reference/environment-variables.md) for the full `Authentication and OAuth`, `Sessions and CSRF`, and `Approved Domains` tables.
- [Webhooks](../features/webhooks.md) for the machine-to-machine side of the authentication story.
- [MCP Integration](../features/mcp-integration.md) for the second machine-to-machine path (HTTP MCP).
- [Architecture Reference](../reference/architecture.md) for the "Known Gaps" tracker that records the OAuth login path as scheduled for 1.1.
