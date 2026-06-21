# Authentication

*How APIWeave 2.0 authenticates human users and machine clients. Covers the SSO model, the per-instance owner bootstrap, the personal workspace created on first sign-in, the organization and workspace context that every session carries, the invite flow, session policy, approved domains, and the OAuth provider setup.*

## Prerequisites

- Read the [Security Guide](security.md) for the cross-cutting posture (CSRF, CORS, secrets, worker exposure).
- A running APIWeave 2.0 instance with a verified backend `BASE_URL` and a frontend origin in `ALLOWED_ORIGINS`. The database must be clean (post-2.0 destructive reset).
- A secret manager for `SESSION_SECRET_KEY`, `SECRET_KEY`, `SECRET_ENCRYPTION_KEY`, and the OAuth client secrets for each provider you enable.

## Authentication Model

APIWeave has three distinct authentication paths, and they never share credentials.

**Human users (browsers):** SSO only. The browser never sees a password field, and there is no local password login in 2.0. The backend owns the session and sends an HttpOnly cookie to the browser. The cookie is signed with `SESSION_SECRET_KEY` and validated on every state-changing request through the double-submit CSRF pattern described in the [Security Guide](security.md). Every session is bound to a user and carries the user's current organization and workspace context through the URL.

**Machine clients (CI/CD, AI agents):** Token-based, scoped to an organization or workspace. Scoped webhooks use `X-Webhook-Token` plus an HMAC-SHA256 signature. MCP HTTP and other API consumers use a scoped service token in `Authorization: Bearer <token>`. These credentials are separate from any human session and never use the browser cookie jar. See [Webhooks](../features/webhooks.md) and [MCP Integration](../features/mcp-integration.md) for the full contract.

```text
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

Why this split: humans hold an interactive session with a short idle window; machines hold a long-lived scoped token tied to a specific integration. Mixing them would either lock humans out at automation scale or leak automation tokens into the browser.

## Deployment Mode

`DEPLOYMENT_MODE` in `backend/.env` selects the operating model at startup. The two modes are designed to be drop-in replacements for each other: the API surface, scope model, permission evaluator, and persistence are identical. The only thing that changes is *who* the backend treats as the authenticated caller.

| Mode | Use it for | What's enabled | What's disabled |
| --- | --- | --- | --- |
| `single_user` | Local evaluation, single-operator self-host, dev laptops, side projects | Personal workspace auto-created on first request. All canvas features work. | OAuth, sessions, CSRF, invites, approved domains, organizations, admin pages, login screen. |
| `multi_tenant` | Hosted SaaS, team installs, any deployment that needs invites or orgs | OAuth SSO (4 providers), server-side sessions, double-submit CSRF, invites, approved domains, full org/workspace/team model, admin pages. | (nothing — the full 2.0 surface) |

Default is `multi_tenant` to preserve the historical 2.0 behavior. Set the variable in `backend/.env` and restart the backend; no code changes are required.

### How `single_user` Works

The backend treats the entire install as belonging to one user. On the first request after the backend starts, a single synthetic owner row is created in the `users` collection with a stable id (`usr-single-user-owner`), the `admin` role, and a verified email of `owner@localhost`. The personal workspace at slug `personal` is auto-created for this owner the same way the multi-tenant first-sign-in bootstrap creates one for a real user.

Every subsequent request is authenticated as this owner. There is no login screen, no logout, no session cookie, no CSRF token, no invite flow. The frontend `AuthProvider` calls `GET /api/auth/mode` once on boot; the response is `{ "mode": "single_user" }`, and the login, setup, and admin routes redirect to `/app` automatically.

The reason this works without special-casing downstream code: the synthetic owner is a real `User` document with the `admin` role. Every `get_current_user` dependency call returns it; every `require_permission` and `require_scoped_permission` check works as it does for any admin user. The Phase 1 security hardening (the `ScopedPermissionEvaluator` rewrite) is designed against the same `User` shape, so it will pick up single-user mode automatically.

### How `multi_tenant` Works

The historical 2.0 model. The first sign-in through any enabled OAuth provider becomes the per-instance owner; a personal workspace is auto-created for them. Subsequent sign-ins through OAuth, invites, and approved domains produce normal users. Sessions are stored server-side, the session cookie is HttpOnly + Signed, and CSRF is enforced on every state-changing method. See the rest of this guide for the full contract.

### Choosing a Mode

- **Local evaluation or single-operator self-host**: `single_user`. Zero auth configuration.
- **Self-hosted for a small private team**: `single_user` if you do not need invites, orgs, or teams. Switch to `multi_tenant` the moment you need them.
- **Hosted multi-tenant SaaS**: `multi_tenant`.
- **Production with public signup or invites**: `multi_tenant`.

### Switching Modes

You can flip `DEPLOYMENT_MODE` in `.env` and restart the backend at any time. The mode is read fresh on every request, not at startup, but a restart is the cleanest transition.

- **multi_tenant → single_user**: The synthetic owner is created on the next request. Existing real users, sessions, and OAuth identities stay in the database but are no longer reachable from the UI. The synthetic owner gets a fresh personal workspace; the old user's personal workspace remains in the database alongside it. You have three options for the old data:
  - **Leave it**: the old workspace remains in the database, unreachable from single-user mode. It is preserved if you later switch back to multi_tenant.
  - **Adopt it**: run `python scripts/adopt_workspace.py <workspaceId>` from the `backend/` directory to reassign the old workspace to the synthetic owner. The script is idempotent and adds an admin membership for the owner. Run this **before** the first frontend request triggers the lazy bootstrap, otherwise the synthetic owner will already own a freshly created personal workspace and the script will refuse the transfer (the `(ownerUserId, slug)` unique index forbids two personal workspaces for the same user). If you hit that, delete the empty bootstrap workspace and retry.
  - **Wipe it**: use the destructive database reset in [Installation](../getting-started/installation.md#destructive-database-reset) to clear everything and start fresh.
- **single_user → multi_tenant**: You must configure at least one OAuth provider (`*_CLIENT_ID` and `*_CLIENT_SECRET`) and `SESSION_SECRET_KEY` before the first sign-in can succeed. The startup checks in [Deployment](deployment.md) enforce these in production. The synthetic owner's workspace is left in place; the first real OAuth user gets their own personal workspace with no collision.

### What the Frontend Sees

The frontend exposes `isSingleUser` from `useAuth()` and gates three places on it:

1. `/login` redirects to `/app` in single-user mode (no login screen).
2. `/setup` redirects to `/app` in single-user mode (no setup screen).
3. `AdminRoute` redirects to `/app` in single-user mode (no admin surface — there's no org to administer).

The org/workspace switcher continues to show the personal workspace in both modes. The create-org/workspace affordances called for in Phase 3 of the hosted-multi-tenant roadmap will themselves be gated on `isSingleUser` so they do not render in self-hosted installs.

## Per-Instance Owner Bootstrap

APIWeave 2.0 has a single per-instance owner. The first user to sign in through any enabled provider becomes the owner, and the backend auto-creates a default personal workspace at the slug `personal` for that user. The owner can then create the first organization, invite teammates, and create organization-owned workspaces.

The 1.0 `SETUP_MODE_ENABLED` first-admin bootstrap is gone. There is no separate "setup mode" flag. The first sign-in is the bootstrap. Subsequent sign-ins are normal logins.

Operational rules:

- The first sign-in happens on a clean database. Run the destructive reset in [Installation](../getting-started/installation.md#destructive-database-reset) before the first sign-in if you are upgrading from 1.0.
- Use a real, verified email for the owner. Unverified provider emails are rejected and cannot bootstrap.
- Verify the owner has the org-owner role before inviting others. Without an owner, no further signups are possible.
- Do not expose an unhardened instance to the public internet before the owner is created and the OAuth providers are locked down.

```env
# During first-owner bootstrap
APPROVED_DOMAINS_ENABLED=false

# After the first owner exists
APPROVED_DOMAINS_ENABLED=true
APPROVED_DOMAINS=example.com,example.org
```

## Organization and Workspace Context

After the owner is created, the user lives in two scopes at once:

- **Personal workspace** (`/personal/...`): the auto-created personal workspace, owned by the user, with the slug `personal`. Available to the user from any browser session.
- **Organization-owned workspaces** (`/<orgSlug>/<workspaceSlug>/...`): workspaces the user creates inside an organization. The user has a role on the org (`owner`, `member`, `billing`, `security`) and a role on the workspace (`read`, `triage`, `write`, `maintain`, `admin`).

The org and workspace switcher in the header shows the current selection. The URL pattern tells the backend which scope every API call applies to. The session cookie does not encode the current org or workspace; the URL does. Switching the dropdown changes the URL, and the page re-renders against the new scope.

A user can be a member of multiple organizations. A user can be a direct member of a workspace, a team member with a grant on the workspace, or an outside collaborator on the workspace. The user does not need to be an org member to collaborate on a single workspace.

## Invites and Team Membership

Organization invites are sent by email from the org settings page. Each invite carries a one-time token, an expiry, and a role (`member`, `billing`, or `security`; the `owner` role is reserved for the bootstrap owner and a hand-off flow). Invites can be resent and cancelled before acceptance.

Team membership is a separate layer. A team lives inside an organization, has members, and receives permission grants for workspaces, environments, secrets, and approvals. Outside collaborators join a single workspace without becoming a team or org member.

## Approved Domains

Approved domains gate which email addresses can create accounts. Domain matching is based on the verified email returned by the provider; unverified provider emails are rejected and cannot be used for signup or account linking. The gate is enforced on every OAuth sign-in once the provider is enabled.

| Mode | Configuration | Behavior |
|------|---------------|----------|
| Invite-only | `APPROVED_DOMAINS_ENABLED=false` | First owner via first sign-in. Admins and owners generate invite links; invitees sign in through OAuth. |
| Domain signup | `APPROVED_DOMAINS_ENABLED=true` plus `APPROVED_DOMAINS` | First owner via first sign-in. Verified emails on listed domains sign in directly through OAuth; admins and owners can still send invites. |

```env
APPROVED_DOMAINS_ENABLED=true
APPROVED_DOMAINS=example.com,example.org
```

Owners retain the ability to issue invites in either mode. Treat `APPROVED_DOMAINS` as a tenant allowlist: include only the domains your organization owns, and review the list every time you add or remove a corporate domain.

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

For the full cookie and CSRF interaction, see the [Security Guide](security.md).

## Production Auth Checklist

A short list of the auth-related items a deployment must pass before going live. The complete deployment checklist lives in the [Security Guide](security.md#deployment-security-checklist) and the [Deployment Guide](../operations/deployment.md).

- [ ] `APP_ENV=production` (or `prod`).
- [ ] `SESSION_SECRET_KEY` set from a secret manager, generated with `openssl rand -hex 32`.
- [ ] `SESSION_COOKIE_SECURE=true` (the backend rejects `false` outside development).
- [ ] `CSRF_ENABLED=true`.
- [ ] `ALLOWED_ORIGINS` lists the exact HTTPS frontend origin, no wildcards.
- [ ] Database wiped with the destructive reset in [Installation](../getting-started/installation.md#destructive-database-reset) before the first sign-in.
- [ ] First sign-in completed through a verified SSO email, owner role confirmed.
- [ ] `APPROVED_DOMAINS` contains only the domains your organization owns, or the gate is disabled for invite-only operation.

## OAuth Provider Setup

The login path is gated by `OAUTH_LOGIN_ENABLED` (default `false`). When the flag is off, the per-instance owner created through the first sign-in on a clean database is the only way to sign in; when the flag is on, the provider buttons on the login page activate and the callback handlers respond to real provider authorization codes. Register each provider application before flipping the flag on, and store the client secrets in your deployment secret manager. Account linking is blocked by policy; the error is surfaced to the operator rather than auto-linking to an existing account.

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
- `APPROVED_DOMAINS_ENABLED` and `APPROVED_DOMAINS` for tenant gating.
- `OAUTH_LOGIN_ENABLED=true` once the provider applications are registered and the client secrets are in the secret manager.
- `SECRET_ENCRYPTION_KEY` (32 bytes, base64-encoded) for secret-at-rest envelope encryption. See the [Encryption Guide](encryption.md).

## Troubleshooting

- **If you cannot sign in at all**, `OAUTH_LOGIN_ENABLED` is off and no owner exists. Drop the database, restart the backend, complete the first sign-in through a verified SSO email, and the owner role is created.
- **If the first sign-in is rejected**, the email you are using is not verified. Provider login requires a verified primary email. Confirm the account in the provider's email settings and retry.
- **If the first sign-in lands on a blank page or 404s on `/personal/workflows`**, the database was not dropped before the first sign-in. Run the destructive reset and try again.
- **If the session cookie is not set in the browser**, `SESSION_COOKIE_SECURE=true` is set while the page is served over HTTP, or `APP_ENV=development` is set in a production-like deploy. The browser silently drops an insecure cookie. Confirm the page is served over HTTPS and that `APP_ENV` matches the deployment.
- **If the session expires faster than expected**, check `SESSION_MAX_IDLE_MINUTES` and `SESSION_MAX_ABSOLUTE_MINUTES`. The defaults are 12 hours idle and 7 days absolute. Rotation on privilege change also forces a fresh absolute clock.
- **If `APPROVED_DOMAINS` is set but a valid domain is still rejected**, the provider returned an unverified email, or the user already exists with a different verified email. Account linking is blocked by policy; create a new account or contact an owner to merge the existing one.
- **If a user cannot see an organization or workspace**, the user is not a member. Owners can invite the user from the org settings page, or an outside collaborator invitation can be issued for a single workspace.

## Related

- [Security Guide](security.md) for the cross-cutting posture, CSRF, CORS, secret masking, and the worker exposure caveat.
- [Environment Variables Reference](../reference/environment-variables.md) for the full `Authentication and OAuth`, `Sessions and CSRF`, and `Approved Domains` tables.
- [Webhooks](../features/webhooks.md) for the machine-to-machine side of the authentication story.
- [MCP Integration](../features/mcp-integration.md) for the second machine-to-machine path (HTTP MCP with scoped service tokens).
- [Encryption Guide](encryption.md) for the `SECRET_ENCRYPTION_KEY` setup and rotation.
- [Audit Log](audit.md) for the events that every authentication action writes.
