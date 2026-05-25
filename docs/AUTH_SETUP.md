# Authentication Setup

APIWeave uses SSO-only human authentication. Browser users sign in through OAuth/OIDC providers and receive an HttpOnly server session cookie. Machine-to-machine integrations such as webhooks and MCP use separate keys and do not use browser sessions.

## Public URLs

Choose the public HTTPS base URL for the backend before creating provider applications:

```env
PUBLIC_BASE_URL=https://apiweave.example.com
BASE_URL=https://apiweave.example.com
ALLOWED_ORIGINS=https://app.apiweave.example.com
```

Every production callback URL below uses `{base_url}` as the backend public base URL, not the frontend URL.

## OAuth Provider Setup

All providers use the authorization-code flow. OIDC providers also validate nonce server-side. Never commit real client secrets; put them only in deployment secret storage.

### GitHub

1. Create a GitHub OAuth App.
2. Set the Authorization callback URL to:

   ```text
   {base_url}/api/auth/callback/github
   ```

3. Configure APIWeave with:

   ```env
   GITHUB_CLIENT_ID=<github-oauth-client-id>
   GITHUB_CLIENT_SECRET=<github-oauth-client-secret>
   ```

4. Ensure the app can request the `/user/emails` scope. GitHub is not treated as OIDC in APIWeave; APIWeave calls `/user` and `/user/emails` and only accepts verified email addresses for signup or account linking.

### GitLab

1. Create a GitLab OAuth application.
2. Set the Redirect URI to:

   ```text
   {base_url}/api/auth/callback/gitlab
   ```

3. Configure APIWeave with:

   ```env
   GITLAB_CLIENT_ID=<gitlab-oauth-client-id>
   GITLAB_CLIENT_SECRET=<gitlab-oauth-client-secret>
   ```

4. APIWeave requires a verified/confirmed email before creating or linking an account.

### Google

1. Create an OAuth client in Google Cloud Console.
2. Use the Web application client type.
3. Add the authorized redirect URI:

   ```text
   {base_url}/api/auth/callback/google
   ```

4. Configure APIWeave with:

   ```env
   GOOGLE_CLIENT_ID=<google-oauth-client-id>
   GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
   ```

5. Google is handled as OIDC. APIWeave validates state, PKCE, ID token claims, and nonce.

### Microsoft

1. Register an application in Microsoft Entra ID.
2. Add a Web platform redirect URI:

   ```text
   {base_url}/api/auth/callback/microsoft
   ```

3. Configure supported account types:
   - Multi-tenant: choose accounts in any organizational directory and set `MICROSOFT_TENANT=common`.
   - Single-tenant: choose your tenant only and set `MICROSOFT_TENANT=<tenant-id>`.
4. Configure APIWeave with:

   ```env
   MICROSOFT_CLIENT_ID=<microsoft-application-client-id>
   MICROSOFT_CLIENT_SECRET=<microsoft-client-secret>
   MICROSOFT_TENANT=common
   ```

5. Microsoft is handled as OIDC. APIWeave validates state, PKCE, ID token claims, and nonce.

## Environment Variable Reference

| Variable | Required | Purpose |
|----------|----------|---------|
| `APP_ENV` | Yes | Use `production`/`prod` for production security validation. |
| `BASE_URL` | Yes | Backend base URL used by the app. |
| `PUBLIC_BASE_URL` | Recommended | Public HTTPS backend URL used when configuring provider callbacks. |
| `ALLOWED_ORIGINS` | Yes | Comma-separated exact frontend origins allowed by CORS. Do not use `*` with credentials. |
| `TRUSTED_HOSTS` | Production | Comma-separated public hostnames accepted by the app/proxy stack. |
| `SESSION_SECRET_KEY` | Production | Strong random session signing secret. |
| `SESSION_COOKIE_SECURE` | Production | Must remain `true` in production so cookies require HTTPS. |
| `SESSION_COOKIE_SAMESITE` | Yes | Defaults to `lax`. |
| `SESSION_MAX_IDLE_MINUTES` | Yes | Defaults to `720` (12 hours idle timeout). |
| `SESSION_MAX_ABSOLUTE_MINUTES` | Yes | Defaults to `10080` (7 days absolute timeout). |
| `CSRF_ENABLED` | Yes | Keep `true`; state-changing browser requests require CSRF validation. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | If GitHub enabled | GitHub OAuth app credentials. |
| `GITLAB_CLIENT_ID` / `GITLAB_CLIENT_SECRET` | If GitLab enabled | GitLab OAuth app credentials. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | If Google enabled | Google OIDC credentials. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | If Microsoft enabled | Microsoft Entra app credentials. |
| `MICROSOFT_TENANT` | Microsoft | `common` for multi-tenant or a tenant ID for single-tenant. |
| `APPROVED_DOMAINS_ENABLED` | Yes | Enables verified-email domain signup when true. |
| `APPROVED_DOMAINS` | If domain signup enabled | Comma-separated allowed email domains. |
| `SETUP_MODE_ENABLED` | Bootstrap | Allows the first successful SSO login to become admin when there are zero users. |
| `WEBHOOK_REQUIRE_HMAC` | Production | Must be `true` in production so webhook execution requires HMAC. |
| `MCP_REQUIRE_API_KEY` | Production | Must be `true` for HTTP MCP. |
| `MCP_API_KEY` | If HTTP MCP enabled | Machine-to-machine MCP bearer key. |

## Setup Mode and First Admin

When no users exist and `SETUP_MODE_ENABLED=true`, the first successful SSO login becomes the initial admin. After that first user is created, setup mode locks for normal operation; later users must enter through an invitation or an approved-domain signup path.

Operational rules:

- Use a real provider account with a verified email for the first login.
- Verify the first user has admin permissions before inviting others.
- Do not leave unaudited bootstrap access exposed on a public instance.

## Approved Domains

Approved domains allow self-signup only for verified email addresses under explicit domains:

```env
APPROVED_DOMAINS_ENABLED=true
APPROVED_DOMAINS=example.com,example.org
```

Domain matching is based on the verified email returned by the provider. Unverified provider email addresses are rejected and cannot be used for signup or account linking.

## Invite-Only vs Domain Signup

| Mode | Configuration | Behavior |
|------|---------------|----------|
| Invite-only | `APPROVED_DOMAINS_ENABLED=false` | New users need an admin-generated invite link. |
| Domain signup | `APPROVED_DOMAINS_ENABLED=true` plus `APPROVED_DOMAINS` | Users with verified emails on listed domains can sign in without an invite. |

Admins can still use invites in either mode.

## Session Policy

APIWeave sessions are backend-owned and cookie-based:

- Cookie is HttpOnly and not readable by JavaScript.
- Cookie is Secure in production and must be sent only over HTTPS.
- SameSite defaults to `Lax`.
- Idle timeout: 12 hours (`SESSION_MAX_IDLE_MINUTES=720`).
- Absolute timeout: 7 days (`SESSION_MAX_ABSOLUTE_MINUTES=10080`).
- Sessions rotate on login and privilege-changing events.

Do not place OAuth tokens, session IDs, or API keys in browser localStorage.

## Related Guides

- [Security](SECURITY.md)
- [Webhook Quick Start](WEBHOOK_QUICKSTART.md)
- [MCP Integration Guide](MCP.md)
