<!-- INTERNAL: scratch file for docs-1.0-cleanup project. Not user-facing. -->

# Old Content Extraction (Pre-1.0 Docs)

This file preserves factual content from the 11 pre-1.0 docs in `docs/` so it can be cross-referenced during the rewrite (T6–T33). It is NOT a polished doc — it is a working scratch artifact.

**Source docs** (referenced throughout):

- `WORKFLOWS_AND_NODES.md` (142 lines)
- `VARIABLES_EXTRACTORS_JSON_EDITOR.md` (122 lines)
- `ENVIRONMENTS_COLLECTIONS.md` (107 lines)
- `AUTH_SETUP.md` (172 lines)
- `SECURITY.md` (229 lines)
- `WEBHOOK_QUICKSTART.md` (619 lines)
- `MCP.md` (617 lines)
- `SWAGGER_UI_BASE_URL_IMPORT.md` (100 lines)
- `FAQ_TROUBLESHOOTING.md` (173 lines)
- `NAVIGATION.md` (28 lines)
- `README.md` (26 lines)

---

## Workflows and Nodes

> Source: `WORKFLOWS_AND_NODES.md`

A workflow is a graph of connected nodes. Each node does one job (request, assertion, delay, merge, etc.). Edges define execution order. You can run the full graph and inspect results per node.

### Create a workflow (canvas)

1. Open APIWeave.
2. Create a new workflow from the empty state or the Workflows panel.
3. APIWeave starts with a Start node.
4. Open the Add Nodes panel (plus button at bottom-right).
5. Drag nodes onto the canvas.
6. Connect nodes by dragging from one handle to another.

Tip from doc: Save often from the top toolbar (`Save`) or use `Ctrl+S`.

### Canvas actions and shortcuts

- `Run`: executes the active workflow.
- `Run` dropdown:
  - `Run`: full workflow from Start.
  - `Run from last failed node`: resumes from the first failed node of the latest failed run.
  - `Run all failed nodes and continue`: resumes from every failed node in the latest failed run.
  - Per-node failed entries: resumes from a specific failed node.
- `History`: opens previous runs.
- `JSON`: opens the JSON editor.
- `Import`: opens import-to-nodes panel.
- `Refresh`: refreshes Swagger/OpenAPI templates from the selected environment.

Resume actions are available only when the latest run status is failed.

Keyboard shortcuts:

- `Ctrl+N`: new workflow
- `Ctrl+S`: save
- `Ctrl+R` or `F5`: run
- `Ctrl+J`: JSON editor
- `Ctrl+C`: copy selected node (canvas context only)
- `Ctrl+V`: paste node (canvas context only)

Note: copy/paste shortcuts are context-aware. When the cursor is in a text editor (request body, response view, node modal fields), normal text copy/paste takes precedence.

### Node types (extracted verbatim)

**Start** — Entry point for execution. Has an output handle only. Usually one Start node per workflow.

**End** — Terminal node to stop a path. Has an input handle only. Use one or more End nodes for clear completion paths.

**HTTP Request** — Main workhorse node for API calls. Configure directly in the node body or double-click for the modal editor.
- Method: `GET`, `POST`, `PUT`, `DELETE`, `PATCH`
- URL
- Query parameters (`key=value`, one per line)
- Headers (`key=value`, one per line)
- Cookies (`key=value`, one per line)
- Body (usually JSON text)
- Timeout (seconds)
- Variable placeholders work in all request fields.

**Assertion** — Validates previous results and branches logic. Supports checks on status, response body fields, headers, cookies, or workflow variables. Two output handles: `pass` (all assertions passed) and `fail` (at least one failed). Typical pattern: `HTTP Request -> Assertion -> pass path / fail path`.

**Delay** — Wait in milliseconds before continuing. Use cases: polling intervals, pacing rate-limited calls, waiting for eventual consistency.

**Merge** — Combines parallel branches into one path. Strategies:
- `all`: wait for all branches
- `any`: continue when any branch completes
- `first`: continue with first completed branch
- `conditional`: continue based on merge conditions

Use when one node fans out into multiple branches and a single downstream step is needed.

### Build pattern (from doc)

1. Start with the happy path.
2. Add assertion checks after critical HTTP calls.
3. Add fail branches for recovery or logging calls.
4. Add delay/merge only when needed.
5. Run and inspect node-level results before adding more complexity.

### Resume behavior details

- Resume runs reuse prior workflow variables and successful upstream node results.
- In parallel failures, you can resume one failed node or all failed nodes together.
- Repeated failed resumes are lineage-aware: if attempt A fails, then attempt B fails, a later resume still hydrates context from earlier successful upstream attempts.
- If the latest run is successful, resume options are hidden/disabled until a new failure occurs.

### Who can run

Runs are started by signed-in users with the required workflow/run permission. External CI/CD execution uses webhooks (see `WEBHOOK_QUICKSTART.md`), authenticated separately with machine-to-machine token and HMAC credentials.

---

## Variables and Extractors

> Sources: `VARIABLES_EXTRACTORS_JSON_EDITOR.md`, `WORKFLOWS_AND_NODES.md` (placeholder usage), `FAQ_TROUBLESHOOTING.md` (placeholder troubleshooting)

### Placeholder syntax (all use double curly braces)

**Environment variables** — values from the selected environment:

```
{{env.BASE_URL}}
{{env.API_VERSION}}
```

**Workflow variables** — values stored at workflow level:

```
{{variables.token}}
{{variables.userId}}
```

**Previous node result**:

```
{{prev.response.body.id}}
{{prev.response.headers.content-type}}
{{prev.response.cookies.session}}
```

**Parallel branch access (after a merge)** — by index:

```
{{prev[0].response.body.id}}
{{prev[1].response.body.id}}
```

**Secrets** — runtime secrets entered through the Secrets prompt:

```
{{secrets.API_KEY}}
{{secrets.CLIENT_SECRET}}
```

**Dynamic functions**:

```
{{uuid()}}
{{randomString(12)}}
{{randomEmail()}}
{{timestamp()}}
```

### Difference between namespaces (verbatim from FAQ)

- `env.*`: environment-level values (base URLs, constants)
- `variables.*`: workflow values created manually or via extractors
- `prev.*`: previous node result (or `prev[index]` after merge)
- `secrets.*`: runtime secret values entered before run

### Add extractors in HTTP nodes

1. Open or expand an HTTP Request node.
2. Go to the extractor section.
3. Add: variable name (e.g. `token`) and path (e.g. `response.body.access_token`).
4. Run the workflow.
5. Reuse the value as `{{variables.token}}`.

Common extractor paths:

- `response.body.field`
- `response.body.user.id`
- `response.body.items[0].id`
- `response.headers.x-request-id`
- `response.cookies.session`
- `response.statusCode`

### Variables panel

Open the side panel and use the Variables tab to add, edit, delete variables, and confirm usage syntax. Useful for test data setup before running a workflow.

### JSON editor workflow

Open with toolbar `JSON` button or `Ctrl+J`.

Recommended flow: Save first, open JSON editor, make targeted edits to `nodes`, `edges`, or `variables`, click apply, fix any validation errors.

JSON editing tips:

- Keep IDs stable (`nodeId`, `edgeId`) unless replacing structures.
- Ensure edge references point to existing node IDs.
- Keep valid JSON (commas, quotes, braces).
- Use small edits and apply incrementally.

### Common mistakes (from doc)

- Placeholder typo: `{{variable.token}}` instead of `{{variables.token}}`
- Wrong extractor path for nested objects/arrays
- Using a variable before it is extracted or defined
- Invalid JSON structure when editing manually

FAQ adds:

- Plain-text placeholder: typo in variable namespace (`{{variable.x}}` instead of `{{variables.x}}`), variable not defined yet, or extractor path is incorrect.
- Extractor did not set value: inspect node response body first, update extractor path to match real response shape, rerun and check Variables panel.
- Old variable value persists: update/delete in Variables panel, rerun from the first relevant node.
- Merge branch variable lookup fails: use branch index placeholders `{{prev[0].response...}}` / `{{prev[1].response...}}`; confirm merge strategy and branch count from run results.

---

## Environments, Secrets, and Collections

> Source: `ENVIRONMENTS_COLLECTIONS.md`

### Environments

Open Environment Manager from the top header (`Environments`). Each environment can include name/description, variables (for `{{env.NAME}}` placeholders), secrets (entered at run time), and optional Swagger/OpenAPI URL.

To create: open Environment Manager, click `New Environment`, set name/description, add variables, optionally set Swagger/OpenAPI URL, save.

Example variables:

- `BASE_URL=https://api.staging.example.com`
- `API_VERSION=v1`

Use in requests: `{{env.BASE_URL}}/users`.

### Secrets

Secrets are values you do not want to store in plain workflow config.

- Manage secret keys in Environment Manager (`Manage Secrets`).
- At run time, APIWeave prompts for missing secret values.
- Entered values are stored in browser session storage.

Use in requests: `{{secrets.API_KEY}}`, `{{secrets.CLIENT_SECRET}}`.

**Partial / 1.0 status hint**: The `ENVIRONMENTS_COLLECTIONS.md` doc models secrets as a runtime prompt, but `SECURITY.md` Migration Notes (F4, F10, F15, F19) indicate secret masking has been tightened. Treat runtime secret flow as documented but watch for "Not yet supported in 1.0" callouts in the rewrite.

### Duplicate and delete

- `Duplicate` creates a copy with variables, secrets keys, and Swagger URL.
- Delete is blocked if workflows still reference that environment.

### Collections

Collections group related workflows. Use cases: feature-based, release-cycle, team/service ownership.

To create/edit: open Collections view in sidebar, click `Create` or open Collection Manager, set name/description/color, save.

To assign a workflow to a collection (from a workflow tab): open right-side panel, go to `Settings`, in `Collections` choose a collection. Remove assignment from the same area if needed.

In Collection Manager, the workflow order view lets you: reorder by drag-and-drop, enable/disable items, set per-item continue/stop behavior, save order for collection execution scenarios.

### Export/import

- Workflow export/import from workflow actions. Optional environment data can be included.
- Collection export/import as `.awecollection` bundles with workflows. Optional environment export is supported. Dry-run validation is available before import.
- Sensitive values are sanitized in exports and replaced with placeholders where needed.
- After import, re-enter required secrets before running in sensitive environments.

---

## Authentication and SSO

> Source: `AUTH_SETUP.md`

APIWeave uses SSO-only human authentication. Browser users sign in through OAuth/OIDC providers and receive an HttpOnly server session cookie. Machine-to-machine integrations (webhooks, MCP) use separate keys and do not use browser sessions.

### Public URLs (env shape)

```env
PUBLIC_BASE_URL=https://apiweave.example.com
BASE_URL=https://apiweave.example.com
ALLOWED_ORIGINS=https://app.apiweave.example.com
```

Every production callback URL uses `{base_url}` as the backend public base URL, not the frontend URL.

All providers use the authorization-code flow. OIDC providers also validate nonce server-side. Never commit real client secrets; put them only in deployment secret storage.

### OAuth providers and callback URLs

**GitHub** (not OIDC; APIWeave calls `/user` and `/user/emails`; only verified emails accepted)

- Callback: `{base_url}/api/auth/callback/github`
- Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Requires `/user/emails` scope.

**GitLab**

- Callback: `{base_url}/api/auth/callback/gitlab`
- Env: `GITLAB_CLIENT_ID`, `GITLAB_CLIENT_SECRET`
- Requires verified/confirmed email before creating/linking an account.

**Google** (handled as OIDC; validates state, PKCE, ID token claims, nonce)

- Web application client type
- Callback: `{base_url}/api/auth/callback/google`
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**Microsoft** (handled as OIDC; validates state, PKCE, ID token claims, nonce)

- Register in Microsoft Entra ID, Web platform redirect URI: `{base_url}/api/auth/callback/microsoft`
- Multi-tenant: `MICROSOFT_TENANT=common`
- Single-tenant: `MICROSOFT_TENANT=<tenant-id>`
- Env: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`

### Environment variable reference

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

### Setup mode and first admin

When no users exist and `SETUP_MODE_ENABLED=true`, the first successful SSO login becomes the initial admin. After that first user, setup mode locks for normal operation; later users must enter through an invitation or approved-domain signup path.

Operational rules:

- Use a real provider account with a verified email for the first login.
- Verify the first user has admin permissions before inviting others.
- Do not leave unaudited bootstrap access exposed on a public instance.

### Approved domains

```env
APPROVED_DOMAINS_ENABLED=true
APPROVED_DOMAINS=example.com,example.org
```

Domain matching is based on the verified email returned by the provider. Unverified provider emails are rejected and cannot be used for signup or account linking.

### Invite-only vs domain signup

| Mode | Configuration | Behavior |
|------|---------------|----------|
| Invite-only | `APPROVED_DOMAINS_ENABLED=false` | New users need an admin-generated invite link. |
| Domain signup | `APPROVED_DOMAINS_ENABLED=true` plus `APPROVED_DOMAINS` | Users with verified emails on listed domains can sign in without an invite. |

Admins can still use invites in either mode.

### Session policy (verbatim)

- Cookie is HttpOnly and not readable by JavaScript.
- Cookie is Secure in production and must be sent only over HTTPS.
- SameSite defaults to `Lax`.
- Idle timeout: 12 hours (`SESSION_MAX_IDLE_MINUTES=720`).
- Absolute timeout: 7 days (`SESSION_MAX_ABSOLUTE_MINUTES=10080`).
- Sessions rotate on login and privilege-changing events.

Do not place OAuth tokens, session IDs, or API keys in browser localStorage.

---

## Security Model

> Source: `SECURITY.md`

### Human auth model

APIWeave human users authenticate with SSO only. The backend owns the session and sends an HttpOnly cookie to the browser. There is no password login in v1 and no browser-visible admin secret.

### Session security (production)

- `SESSION_SECRET_KEY` is a strong random secret stored in deployment secret management.
- Session cookie is `HttpOnly`.
- `SESSION_COOKIE_SECURE=true` so browsers send it only over HTTPS.
- `SESSION_COOKIE_SAMESITE=lax` unless a stricter deployment-specific setting is proven compatible.
- Idle timeout 12h (`SESSION_MAX_IDLE_MINUTES=720`).
- Absolute timeout 7d (`SESSION_MAX_ABSOLUTE_MINUTES=10080`).
- Sessions rotate on login and privilege-changing events.
- Logout revokes the current session and clears the cookie.

Development override: `get_session_cookie_secure()` returns false only when `APP_ENV=development`. Production (`APP_ENV=production` or `prod`) must keep secure cookies enabled.

### CSRF protection (double-submit cookie pattern)

- The backend issues a non-HttpOnly `csrftoken` cookie.
- The frontend sends the same value in the `X-CSRF-Token` header for state-changing requests.
- The backend rejects missing or mismatched tokens.

Keep `CSRF_ENABLED=true` for production. Do not replace CSRF protection with same-origin assumptions alone.

CSRF middleware behavior (per doc):

- Enforced ONLY for state-changing requests (POST, PUT, PATCH, DELETE) that include both `session` and `csrftoken` cookies.
- Missing or mismatched `X-CSRF-Token` header returns 403. Enforced before the route handler runs.
- Requests without a `session` cookie bypass CSRF (intentional for webhooks and public API endpoints with token auth).
- GET, HEAD, OPTIONS skip CSRF entirely.
- Webhook endpoints (`/api/webhooks/.../execute`) are intentionally exempt — they authenticate via `X-Webhook-Token`.

Regression guidance from doc:

- New session-protected endpoints are covered automatically; frontend must include `csrftoken` value as `X-CSRF-Token` header on state-changing requests.
- To exempt a path, add to `_CSRF_EXEMPT_EXACT` or `_CSRF_EXEMPT_PREFIXES` lists.

### CORS and cookies

```env
APP_ENV=production
ALLOWED_ORIGINS=https://app.apiweave.example.com
```

Rules:

- Do not use wildcard origins (`*`) with `allow_credentials=true`.
- Include only HTTPS frontend origins in production.
- Keep local development origins limited to `http://localhost:3000`, `http://localhost:5173`, or equivalent local-only hosts.
- If a reverse proxy terminates TLS, ensure it forwards the correct scheme/host headers and enforces HTTPS redirects.

### Trusted hosts and HTTPS

```env
TRUSTED_HOSTS=apiweave.example.com,app.apiweave.example.com
PUBLIC_BASE_URL=https://apiweave.example.com
```

Use HTTPS for all public browser, OAuth callback, MCP HTTP, and webhook endpoints. Development can use localhost HTTP only.

### Webhook authentication

Each webhook has:

- `X-Webhook-Token` for webhook identity.
- `X-Webhook-Signature` HMAC-SHA256 signature for payload integrity.
- `X-Webhook-Timestamp` for replay-window enforcement.

Production: `WEBHOOK_REQUIRE_HMAC=true` (required). With this on, token-only execution is rejected. Store webhook tokens and HMAC secrets in CI/CD secret stores, not in source code or browser configuration.

Webhook management is a human authenticated UI/API action controlled by `webhooks:*` permissions. Execution remains M2M.

### MCP authentication

For Streamable HTTP MCP in production:

```env
MCP_ENABLED=true
MCP_HTTP_ENABLED=true
MCP_REQUIRE_API_KEY=true
MCP_API_KEY=<strong-random-key>
MCP_ALLOWED_ORIGINS=https://trusted-agent-host.example.com
```

Requests must include `Authorization: Bearer <MCP_API_KEY>`. MCP read/export tools redact persisted secrets, and runtime secrets are accepted only where explicitly supported. Stdio MCP is local subprocess access and should be available only to trusted local agents.

### Deployment security checklist (verbatim)

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

### "What not to do" (verbatim)

- Do not store OAuth access tokens, session IDs, or session secrets in localStorage, sessionStorage, Zustand persistence, or any JavaScript-readable browser storage.
- Do not expose admin keys or deployment secrets to the browser.
- Do not use wildcard CORS with credentialed requests.
- Do not run public production with `SESSION_COOKIE_SECURE=false`.
- Do not disable CSRF protection for browser-authenticated mutations.
- Do not use password login in v1; APIWeave is SSO-only.
- Do not use webhook tokens or MCP API keys as human login credentials.

### Worker process exposure (security-critical)

The APIWeave worker process (`backend/app/worker.py`) polls MongoDB for pending runs and executes them via `WorkflowExecutor.execute()`. The worker has no authentication context of its own. It claims any document in the `runs` collection whose `status` is `pending` and runs it with the executor's full privileges, which include outbound HTTP, file reads, and the `BLOCK_PRIVATE_NETWORKS` policy check.

Consequences:

- **MongoDB must not be reachable from untrusted networks.** Anyone who can write to the `runs` collection with `status: "pending"` can cause arbitrary workflow execution. The executor honors any `workflowId` referenced in the run, and the run's `nodes` and `variables` come from the workflow document, so a write to that collection is effectively code execution inside the executor.
- **Deployment requirement.** Bind MongoDB to localhost or a private network. Do not expose port 27017 to the public internet, and do not share the database cluster with tenants outside your trust boundary.
- **Defense in depth.** `BLOCK_PRIVATE_NETWORKS=true` (default, required in production) stops the executor from reaching `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, and other reserved ranges, so a compromised run still can't pivot to internal services.
- **Operator access is sufficient.** A user with the `runs:write` permission can also create pending runs through the API, which is the intended path. Treat MongoDB-level access as a superset of that capability.

### Rate limiter backend

`backend/app/middleware/rate_limiter.py` uses an in-memory sliding window by default. `RATE_LIMITER_BACKEND` setting:

- `memory` (default). Per-process counters in a `defaultdict`. Counters reset on restart, not shared between workers.
- `mongodb`. Reserved for a future implementation. Selecting this value today does NOT switch the backend; the middleware still uses in-memory. Do not rely on `mongodb` for cross-process limiting until the implementation lands.

Operational impact:

- A single-process API server (the default `uvicorn` deployment) gets correct per-webhook limits.
- A multi-worker deployment behind a load balancer, or a horizontally scaled API, will see each process enforce its own counter. The effective limit becomes `max_requests * worker_count` until you switch to a shared store.
- For production deployments with more than one API process, run an external limiter (Redis or another shared store) or add a worker token plus a coordinated limiter. Tracking this is out of scope for the current release.

### Migration notes (Wave 2 — breaking changes)

**SSRF Protection (F1, F2, F12)** — all outbound HTTP requests from the executor, OpenAPI importer, and MCP tools are validated against a blocklist:

- IPv4: `0.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16` (metadata), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- IPv6: `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`

Action required: workflows using `http://127.0.0.1` or `http://localhost` to call internal services will now be BLOCKED. Update URLs to use public hostnames or set `APPROVED_DOMAINS` to allowlist internal hosts.

**Secret Masking (F4, F10, F15, F19)** — executor secret masking now uses key-name-based detection (`api_key`, `token`, `password`, `*_key`, `*_secret`, `*_credential`, etc.) plus structural walking.

- Fields named like `api_key`, `token`, `password`, `*_credential` are now redacted in result storage.
- Env variable debug logs no longer print raw values.
- Action required: non-secret values with names matching these patterns (e.g. a field literally called `token` that holds a JWT) will now be redacted. Rename the field or remove the secret from the result.

**Webhook HMAC Enforcement (F9)** — `WEBHOOK_REQUIRE_HMAC=false` now triggers a WARNING log in production (per-request, not startup failure). Existing webhook integrations without HMAC continue to work in dev/staging. In production, configure HMAC for all webhooks to avoid warnings.

**Webhook Body Size Limit (F18)** — webhook payloads rejected with 413 if they exceed `MAX_WEBHOOK_BODY_SIZE` (default 65536 bytes / 64KB). Increase the setting or reduce payload size.

**Post-Wave 2 Regression Fix: Parallel HTTP Branches** — workflows with parallel HTTP branches intermittently failed with `HTTP request failed ... Connection closed` and `coroutine raised StopIteration`, with `All N branches failed` reported by `asyncio.gather`.

Root cause 1: `safe_request()` in `backend/app/services/safe_http.py` was structured as `async with aiohttp.ClientSession(...) as session: response = await session.request(...); return response`. The `async with` exit closed the session before the response reached the caller; `await response.text()` then raised `Connection closed`. aiohttp session teardown is scheduled, not synchronous, so the bug appeared as a race.

Root cause 2: `_execute_node` used `raise StopIteration(error_msg)` as a control-flow sentinel. Since Python 3.7, a coroutine that raises `StopIteration` triggers PEP 479 and asyncio reports it as `RuntimeError: coroutine raised StopIteration`. Latent for years; surfaced once Root cause 1 forced the error path.

Fix:

- `safe_request`, `safe_get`, `safe_post` now return `tuple[ClientResponse, ClientSession]` and keep the session open. The caller (`_execute_http_request`) closes both in a `finally` block. Redirect loop reuses a single session across hops, so connection pooling still works.
- A new internal `_StopBranch(BaseException)` class replaces `StopIteration` as the intentional-stop sentinel. Inheriting from `BaseException` (not `Exception`) preserves the original bypass intent without triggering PEP 479.
- Regression test `test_returned_session_keeps_response_readable` in `tests/test_safe_http.py` reads the body through the returned session.

No action required for existing deployments — fix is a bug fix, not behavior change.

---

## Webhooks and CI/CD

> Source: `WEBHOOK_QUICKSTART.md`

### What you get

- A webhook URL
- A webhook token (`X-Webhook-Token` header)
- An HMAC secret (`X-Webhook-Signature`, optional hardening)

Important: token and HMAC secret are shown once at creation/regeneration time. Copy them immediately.

### Create a webhook

Webhook management is a human UI/API action. Sign in with the appropriate `webhooks:*` permission (e.g. `webhooks:create`, `webhooks:read`, `webhooks:delete`). Browser admin keys are not supported for webhook management.

1. Open APIWeave → `Webhooks` in the sidebar.
2. Click `Create`.
3. Choose resource type: `Workflow` (fully executable) or `Collection` (fully executable).
4. Select target workflow/collection.
5. Optionally select an environment.
6. Save and copy credentials from the modal.

If session expires, sign in again through SSO. Webhook management uses the same HttpOnly session and CSRF protection as the rest of the UI; CI/CD systems should never receive or reuse human session cookies.

**Partial / 1.0 status hint**: The doc says webhooks are "fully executable" for both Workflow and Collection types. Treat this as aspirational for collection webhooks — see SECURITY.md and MCP.md hints that collection execution is still being stabilized.

### Trigger a workflow webhook (curl)

```bash
curl -X POST "<WEBHOOK_URL>" \
  -H "X-Webhook-Token: <WEBHOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"buildId":"12345","branch":"main"}'
```

Expected behavior: API returns `202 Accepted`; response includes `runId` and poll URLs; run appears in workflow history/logs.

### HMAC signing scheme

Signature = HMAC-SHA256 hash over the concatenation of timestamp and the raw request body:

```python
# Message format: timestamp + body
message = timestamp.encode('utf-8') + raw_body_bytes
```

Output must be a plain lowercase hexadecimal string (64 characters, no prefix).

Required headers when `WEBHOOK_REQUIRE_HMAC=true`:

- `X-Webhook-Token`: webhook token
- `X-Webhook-Signature`: HMAC-SHA256 over `timestamp + body`
- `X-Webhook-Timestamp`: Unix epoch seconds when the request was sent

### Replay protection

APIWeave enforces a replay window of ±300 seconds (5 minutes) from the server clock. If the difference between the server time and `X-Webhook-Timestamp` exceeds 300 seconds, the request is rejected with a `401 Unauthorized` response.

### Token-only dev mode

When `WEBHOOK_REQUIRE_HMAC=false`, you can authenticate by sending only `X-Webhook-Token`. Intended for local development and compatibility testing only.

### Idempotency

Send `Idempotency-Key` header with a unique string to prevent duplicate executions.

- Deduplication scope: by `(webhookId, Idempotency-Key)`. Prevents key collisions across different webhooks.
- TTL: 24 hours.
- Behavior: same key within 24h returns original `202 Accepted` body with `200 OK` and `Idempotency-Replayed: true` header. No new run triggered.

### Rate limiting

- 100 requests per hour per webhook ID.
- Returns `429 Too Many Requests` when exceeded.
- Headers on every response:
  - `X-RateLimit-Limit`: max allowed (100)
  - `X-RateLimit-Remaining`: remaining in current window
  - `X-RateLimit-Reset`: Unix epoch timestamp when limit resets
  - `Retry-After`: seconds to wait before retrying

### CI/CD integration modes

Two modes:

1. **Fire-and-Forget** — triggers the workflow run and immediately exits. The pipeline doesn't wait for results.
2. **Blocking (Poll-and-Fail)** — triggers the run, captures the run ID, polls the status endpoint until the run completes. Pipeline fails on any test failure or polling timeout.

### GitHub Actions

**Secret setup** (in repo secrets): `APIWEAVE_BASE_URL`, `APIWEAVE_WEBHOOK_TOKEN`, `APIWEAVE_HMAC_SECRET`.

**Fire-and-Forget, token-only (development only):**

```yaml
name: Trigger APIWeave Tests
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Webhook
        run: |
          curl -X POST "${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/<WEBHOOK_ID>/execute" \
            -H "X-Webhook-Token: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"commit": "${{ github.sha }}"}'
```

**Fire-and-Forget, HMAC (production):**

```yaml
name: Trigger APIWeave Tests (HMAC)
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Webhook with HMAC
        run: |
          TIMESTAMP=$(date +%s)
          BODY='{"commit": "${{ github.sha }}"}'
          SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${{ secrets.APIWEAVE_HMAC_SECRET }}" | awk '{print $2}')
          echo "::add-mask::$SIGNATURE"
          curl -X POST "${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/<WEBHOOK_ID>/execute" \
            -H "X-Webhook-Token: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}" \
            -H "X-Webhook-Signature: $SIGNATURE" \
            -H "X-Webhook-Timestamp: $TIMESTAMP" \
            -H "Content-Type: application/json" \
            -d "$BODY"
```

**Blocking Poll-and-Fail (token-only, dev):**

Polls `/api/runs/$RUN_ID` up to 60 iterations at 5s intervals (5 minute timeout). Status values: `completed`/`success` → exit 0; `failed`/`error` → exit 1.

**Blocking Poll-and-Fail (HMAC, prod):**

Same loop with HMAC headers added to the trigger request.

### GitLab CI

Variables setup (Settings > CI/CD > Variables): `APIWEAVE_BASE_URL`, `APIWEAVE_WEBHOOK_TOKEN` (Mask + Protect), `APIWEAVE_HMAC_SECRET` (Mask + Protect).

Fire-and-Forget token-only:

```yaml
trigger_tests:
  stage: test
  script:
    - |
      curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
        -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"commit\": \"${CI_COMMIT_SHA}\"}"
```

Fire-and-Forget HMAC:

```yaml
trigger_tests_hmac:
  stage: test
  script:
    - |
      TIMESTAMP=$(date +%s)
      BODY="{\"commit\": \"${CI_COMMIT_SHA}\"}"
      SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${APIWEAVE_HMAC_SECRET}" | awk '{print $2}')
      curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
        -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
        -H "X-Webhook-Signature: ${SIGNATURE}" \
        -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
        -H "Content-Type: application/json" \
        -d "${BODY}"
```

Blocking Poll-and-Fail variants follow the same pattern as GitHub Actions (60 iterations × 5s).

### Jenkins

Credentials in Jenkins Credentials Provider as **Secret text**: `apiweave-base-url`, `apiweave-token`, `apiweave-hmac-secret`. Jenkins auto-masks these when bound via `withCredentials`.

Fire-and-Forget token-only (Groovy):

```groovy
pipeline {
    agent any
    stages {
        stage('Trigger APIWeave') {
            steps {
                withCredentials([
                    string(credentialsId: 'apiweave-base-url', variable: 'APIWEAVE_BASE_URL'),
                    string(credentialsId: 'apiweave-token', variable: 'APIWEAVE_WEBHOOK_TOKEN')
                ]) {
                    sh '''
                        curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
                          -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
                          -H "Content-Type: application/json" \
                          -d '{"build": "'${BUILD_NUMBER}'"}'
                    '''
                }
            }
        }
    }
}
```

Fire-and-Forget HMAC adds `apiweave-hmac-secret` credential, computes `TIMESTAMP=$(date +%s)` and `SIGNATURE` via openssl, sends `X-Webhook-Signature` and `X-Webhook-Timestamp`.

Blocking Poll-and-Fail variants: capture `RUN_ID` from response `.runId`, poll up to 60 iterations at 5s intervals. Same shell logic as the GitHub snippets.

### Manage existing webhooks

From the Webhooks list you can: enable/disable webhook, view execution logs, regenerate credentials, delete webhook. Regeneration invalidates old credentials immediately.

Management actions require an authenticated APIWeave user session with the matching `webhooks:*` permission. External webhook execution still uses `X-Webhook-Token` plus HMAC headers; CI/CD systems do not use browser sessions.

### HMAC migration (F9)

If you previously created webhooks without HMAC, they continue to work in local/dev. In production (`APP_ENV=production`), you'll see a WARNING log for each unauthenticated request.

To enable HMAC on an existing webhook:

1. Open the webhook in the APIWeave UI.
2. Click "Regenerate Token & HMAC Secret".
3. Update CI/CD pipeline to include new headers:
   - `X-Webhook-Token: <token>`
   - `X-Webhook-Timestamp: <unix-timestamp>`
   - `X-Webhook-Signature: HMAC-SHA256(hmac_secret, timestamp + body)`

Or set `WEBHOOK_REQUIRE_HMAC=false` in your environment to suppress the warning (not recommended for production).

### Common setup pattern

1. Create environment for your target stage.
2. Create workflow webhook bound to that environment.
3. Store token/secret in CI/CD secrets manager.
4. Trigger webhook from deployment pipeline.

### Webhook troubleshooting (from doc)

- **401 Invalid or missing token** — ensure `X-Webhook-Token` is present; confirm token is current (old tokens fail after regeneration).
- **401 Missing X-Webhook-Signature header** — production instances require HMAC when `WEBHOOK_REQUIRE_HMAC=true`; send both `X-Webhook-Signature` and `X-Webhook-Timestamp` with the webhook token.
- **403 Webhook disabled** — enable webhook from Webhooks page.
- **404 Webhook not found** — verify URL path and webhook ID; ensure webhook was not deleted.
- **Invalid JSON payload** — send valid JSON body with `Content-Type: application/json`.
- **No run appears** — check webhook logs in UI; confirm target workflow still exists; check backend logs for runtime errors.

---

## MCP Integration

> Source: `MCP.md`

Model Context Protocol (MCP) server for APIWeave — enables AI coding agents to manage workflows, environments, collections, and executions programmatically.

### Overview

APIWeave exposes an MCP server so AI agents (Claude, Cursor, VS Code, opencode, etc.) can interact with the backend without going through the REST API. Uses the official `mcp` Python SDK with FastMCP. Two transports:

| Transport | Use Case | Auth |
|-----------|----------|------|
| **stdio** | Local CLI/desktop agents launched as subprocesses | None (local only) |
| **Streamable HTTP** | IDE/browser/remote agents | API key + Origin validation |

Both transports call the same shared service layer in `backend/app/services/`, ensuring consistent behavior and secret sanitization.

### Configuration (`backend/.env`)

```env
MCP_ENABLED=true
MCP_HTTP_ENABLED=true
MCP_API_KEY=your-secret-api-key
MCP_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
MCP_REQUIRE_API_KEY=true
```

### Running the server

Stdio (local agents):

```bash
cd backend && python mcp_stdio.py
```

HTTP (mounted at `/mcp` on the FastAPI server):

```bash
cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000
```

MCP endpoint at `http://localhost:8000/mcp` when `MCP_HTTP_ENABLED=true`.

### Tool inventory

The MCP server exposes **56 tools** organized by domain, plus **5 resources** and **4 prompts**. All read/export tools redact persisted secrets. Runtime secrets are accepted only for `workflow_run` and are never persisted or echoed back.

**Server Info (1):** `server_info` — return info about the APIWeave MCP server.

**Workflow Tools (10):**

- `workflow_list` — list/search with pagination, tag, and name filters
- `workflow_get` — full workflow definition, secret-like values redacted
- `workflow_create` — create from structured nodes, edges, variables, tags
- `workflow_update` — update metadata, nodes, edges, variables, tags, templates
- `workflow_export` — sanitized bundle, secrets never returned
- `workflow_import` — import with sanitization
- `workflow_import_dry_run` — validate without persisting
- `workflow_delete` — delete permanently (destructive)
- `workflow_attach_collection` — attach/detach workflow to/from a collection
- `workflow_set_environment` — assign/clear default environment for a workflow

**Environment Tools (7):**

- `environment_list`, `environment_get_active`, `environment_create`, `environment_get`, `environment_update`, `environment_delete`, `environment_activate`, `environment_duplicate`, `mcp_get_config_summary`

(Note: doc lists 7 tools in the heading but 9 rows — `environment_duplicate` and `mcp_get_config_summary` are extra. Preserve both for the rewrite.)

**Collection Tools (11):**

- `collection_list`, `collection_list_workflows`, `collection_create`, `collection_get`, `collection_update`, `collection_delete`, `collection_export`, `collection_import`, `collection_import_dry_run`, `collection_add_workflow`, `collection_remove_workflow`

**Run Tools (7):**

- `workflow_run` — trigger execution with optional environment, resume config, runtime secrets
- `run_get_status` — poll status with compact node summaries (no full payloads)
- `run_get_results` — human-readable summary (no request/response payloads)
- `run_get_node_result` — full result for one node, including GridFS-backed payloads
- `run_latest_failed` — latest failed run metadata for resume workflows
- `run_list` — list runs with workflow/status filters and pagination
- `run_cancel` — cancel a pending or running execution

**Import Tools (6):**

- `import_openapi_url`, `import_openapi`, `import_openapi_dry_run`, `import_har`, `import_har_dry_run`, `import_curl`

**Environment Secret Tools (2) — config-gated** (require `MCP_ALLOW_SECRET_WRITES=true` in server config; shipped but disabled by default for safety):

- `environment_set_secret` — set persisted secret, write-only, never returned
- `environment_delete_secret` — delete persisted secret

**Webhook Tools (7):**

- `webhook_list`, `webhook_get`, `webhook_create` (returns one-time credentials — save immediately!), `webhook_update`, `webhook_delete`, `webhook_regenerate_credentials`, `webhook_get_logs`

**Collection-Run Read Tools (3) — read-only, deferred execution tools:**

- `collection_run_list`, `collection_run_get`, `collection_run_latest`

### Resources (5)

Read-only context for agents; do not perform actions.

- `environment://{environment_id}` — read-only snapshot, secrets redacted
- `environments://list` — list all environments
- `run://{run_id}` — read-only run status and metadata
- `workflow://{workflow_id}` — read-only workflow definition, secrets redacted

(Note: header says 5 resources but only 4 rows in the doc. Preserve as written — this is from the source doc verbatim.)

### Prompts (4)

User-invoked templates that guide agents through common workflows.

- `create_test_from_openapi` — generate a test workflow from an OpenAPI/Swagger spec
- `create_test_from_curl` — generate a test workflow from curl commands
- `debug_failed_run` — structured plan for debugging a failed run
- `resume_failed_workflow` — structured plan for resuming from failed nodes

### Setup per client (preserved for reference)

**Claude Desktop** — Developer tab → Edit Config. Stdio config example:

```json
{
  "mcpServers": {
    "apiweave": {
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "/path/to/apiweave/backend"
    }
  }
}
```

HTTP variant uses `url: "http://localhost:8000/mcp"` and `headers: { "Authorization": "Bearer YOUR_MCP_API_KEY" }`. See `mcp-configs/claude_desktop_config.json`.

**Cursor** — Settings → Features → MCP. See `mcp-configs/cursor_mcp.json`.

**VS Code** — create `.vscode/mcp.json`:

```json
{
  "servers": {
    "apiweave": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "${workspaceFolder}/backend"
    }
  }
}
```

HTTP variant: `type: "http"`, `url`, `headers`. See `mcp-configs/vscode_mcp.json`. Alternatively add `"chat.mcp.discovery.enabled": true` to VS Code `settings.json`.

**GitHub Copilot CLI** — `/mcp add apiweave`, select **Local or STDIO**, command `python mcp_stdio.py`, working directory `backend`, `Ctrl+S` to save. Or edit `~/.copilot/mcp-config.json` directly:

```json
{
  "mcpServers": {
    "apiweave": {
      "type": "local",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "/path/to/apiweave/backend",
      "tools": ["*"]
    }
  }
}
```

HTTP variant: `type: "http"`, `url`, `headers`. Manage via `/mcp show`, `/mcp show apiweave`, `/mcp edit apiweave`, `/mcp disable apiweave`, `/mcp enable apiweave`.

**GitHub Copilot (VS Code)** — same `.vscode/mcp.json` structure as VS Code section above.

**OpenAI Codex (CLI, VS Code, Desktop)** — uses TOML. Config locations:

| Scope | Windows | macOS/Linux |
|-------|---------|-------------|
| User (global) | `%USERPROFILE%\.codex\config.toml` | `~/.codex/config.toml` |
| Project | `.codex\config.toml` | `.codex/config.toml` |

CLI quick setup:

```bash
codex mcp add apiweave -- python mcp_stdio.py
codex mcp add apiweave --cwd /path/to/apiweave/backend -- python mcp_stdio.py
codex mcp add apiweave --url http://localhost:8000/mcp --bearer-token-env-var MCP_API_KEY
```

Manual `~/.codex/config.toml`:

```toml
[mcp_servers.apiweave]
command = "python"
args = ["mcp_stdio.py"]
cwd = "/path/to/apiweave/backend"
enabled = true
```

HTTP variant:

```toml
[mcp_servers.apiweave]
url = "http://localhost:8000/mcp"
bearer_token_env_var = "MCP_API_KEY"
enabled = true
```

Tool control (optional):

```toml
[mcp_servers.apiweave]
command = "python"
args = ["mcp_stdio.py"]
cwd = "/path/to/apiweave/backend"
enabled = true
enabled_tools = ["workflow_list", "workflow_run", "run_get_status"]
# disabled_tools = ["workflow_delete", "environment_delete"]
```

Codex CLI management: `codex mcp list`, `codex mcp get apiweave`, `codex mcp remove apiweave`, `codex mcp login apiweave`.

**opencode** — add to `opencode.json`/`opencode.jsonc`:

```json
{
  "mcp": {
    "apiweave": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "${workspaceFolder}/backend"
    }
  }
}
```

HTTP variant uses `type: "http"`, `url`, `headers`. See `mcp-configs/opencode_mcp.json`.

### Stdio working directory and `.env` loading

The stdio entry point (`mcp_stdio.py`) loads `.env` from the **backend** working directory:

```python
load_dotenv(backend_dir / ".env")
```

When configuring a stdio client, ensure `cwd` is set to the `backend` directory so that:

- The `.env` file is found and loaded.
- Relative paths (e.g. `ARTIFACTS_PATH`) resolve correctly.
- The Python module path includes `backend/app/`.

If a client does not support `cwd`, use an absolute path to `mcp_stdio.py` and set `PYTHONPATH` to include the backend directory.

### Streamable HTTP authentication

MCP HTTP auth is M2M key authentication. Intentionally separate from APIWeave human SSO sessions, CSRF cookies, and browser permissions. Do not use MCP keys as user login credentials, and do not expose them to frontend code.

When `MCP_HTTP_ENABLED=true` and `MCP_REQUIRE_API_KEY=true`:

- All requests to `/mcp` must include `Authorization: Bearer <MCP_API_KEY>` header.
- `Origin` header is validated against `MCP_ALLOWED_ORIGINS`.
- Requests without valid auth receive 401/403.

Production: keep `MCP_REQUIRE_API_KEY=true`, use a strong random `MCP_API_KEY`, restrict `MCP_ALLOWED_ORIGINS` to trusted agent hosts. Disabling API-key auth is only acceptable for isolated local development.

### Secret policy

| Operation | Secret Behavior |
|-----------|----------------|
| Read tools (`workflow_get`, `environment_list`, etc.) | Persisted secrets redacted to `<SECRET>` |
| Export tools (`workflow_export`, `collection_export`) | Secrets removed or replaced with placeholders |
| `workflow_run` | Runtime secrets accepted but never persisted or echoed back |
| Create/Update tools | Persisted secrets not accepted; use `runtime_secrets` on `workflow_run` |
| Import tools | Secret-like values sanitized during import |

What counts as a secret: values matching patterns like `sk-`, `key_`, `secret`, `password`, `token`, `api_key`, etc. Detection logic in `backend/app/services/secret_utils.py`.

### MCP import security (F2/F11)

MCP import tools inherit SSRF protection from the service layer. Private IP addresses (127.0.0.1, 10.x, 192.168.x, etc.) are blocked. If your MCP workflow imports an OpenAPI spec from an internal service, use a public-facing proxy or set `APPROVED_DOMAINS`.

### Agent workflow examples

**Creating and running a workflow:**

```
1. Call workflow_list to check existing workflows
2. Call import_openapi_url to discover endpoints from an API spec
3. Call workflow_create with the discovered nodes
4. Call environment_list to find an environment
5. Call workflow_run with the workflow ID and environment
6. Call run_get_status to poll (use the polling_hint interval)
7. When terminal, call run_get_results for a summary
8. Use run_get_node_result for specific node details if needed
```

**Resuming a failed workflow:**

```
1. Call run_latest_failed with the workflow ID
2. Use the returned failed_node_ids and run_id
3. Call workflow_run with resume_mode="single" or "all-failed"
   and resume_source_run_id from the failed run
```

**Importing from curl:**

```
1. Call import_curl with the curl command string
2. Review the returned nodes
3. Call workflow_create with the nodes
```

### MCP troubleshooting

- **MCP server won't start (stdio)** — No/garbled output. Cause: `print()` corrupts stdout. Fix: ensure no `print()` in execution path; all diagnostics use `logging` to stderr.
- **Tools not found** — `tools/list` empty/missing. Cause: `register_tools()` not called before starting. Fix: call `register_tools()` in stdio entry point or during FastAPI startup.
- **HTTP transport 401** — Unauthorized on `/mcp`. Cause: missing/incorrect API key. Fix: include `Authorization: Bearer <MCP_API_KEY>` header.
- **HTTP transport 403** — Forbidden. Cause: Origin not in `MCP_ALLOWED_ORIGINS`. Fix: add origin to `MCP_ALLOWED_ORIGINS` in `.env`.
- **Database connection errors** — Cause: MongoDB not running or `MONGODB_URL` incorrect. Fix: verify MongoDB accessible and `.env` has correct `MONGODB_URL`.
- **Secret values appearing in responses** — Cause: value doesn't match secret detection patterns. Fix: review `detect_secrets_in_value()` in `secret_utils.py` and add patterns if needed.

### Future/deferred capabilities

- **Collection execution trigger** — backend collection webhook execution is a placeholder; MCP exposure deferred until backend execution is stable.
- **Advanced run creation with callback URLs** — SSRF-safe callback validation needed before exposure.
- **Workflow bulk collection attachment** — requires stable service-layer atomicity guarantees.
- **Template marketplace / scheduling / notifications** — out of scope for MCP parity phase.

### Architecture (diagram from doc)

```
AI Agents
    |
    | MCP stdio or Streamable HTTP
    v
backend/app/mcp/
    server.py          FastMCP server instance and tool registration
    transport.py       stdio and Streamable HTTP helpers
    auth.py            Streamable HTTP auth and Origin checks
    schemas/           Pydantic input/output models
    tools/             Thin MCP adapters grouped by resource
    |
    | calls shared services
    v
backend/app/services/
    workflow_service.py
    run_service.py
    environment_service.py
    collection_service.py
    import_service.py
    secret_utils.py
    |
    | uses repositories/models/executor
    v
MongoDB + Beanie + WorkflowExecutor
```

FastAPI routes call the same service functions, ensuring no duplication of business logic.

---

## OpenAPI/Swagger Import

> Source: `SWAGGER_UI_BASE_URL_IMPORT.md`

### Two import paths

1. Environment-linked Swagger sync (recommended for ongoing work)
2. One-time OpenAPI file import to Add Nodes panel

### Path A: Environment-Linked Swagger Sync

Best when the API definition changes over time.

**Step 1: Set Swagger/OpenAPI URL on Environment**

1. Open `Environments`.
2. Create or edit an environment.
3. Set `Swagger / OpenAPI URL`.
4. Save.

Supported URL examples:

- Direct spec URL: `https://api.example.com/v3/api-docs`, `https://api.example.com/swagger/v1/swagger.json`
- Swagger UI landing URL: `https://api.example.com/swagger-ui/index.html`, `https://api.example.com/webjars/swagger-ui/index.html`

**Step 2: Select environment and refresh**

1. In the canvas toolbar, choose the environment.
2. Click `Refresh`.
3. APIWeave loads request templates into Add Nodes.

Imported group appears as: `Swagger: <Environment Name>`.

**Step 3: Drag imported requests**

Open Add Nodes and drag imported HTTP requests to the canvas. These requests include method, URL, and request template fields from the spec.

**Warning badge: `Check API`**

If an existing schema-linked HTTP node no longer matches the refreshed spec, APIWeave shows `Check API` on that node.

Open the badge to see: mismatch reason, last refresh timestamp, source Swagger URL.

Important: refresh does NOT overwrite existing node request body/headers/config.

### Path B: OpenAPI File Import (One-Time)

Best when you have a local spec file and want quick template generation.

1. In sidebar, open import menu.
2. Choose `OpenAPI`.
3. Upload `.json` spec file.
4. Click `Preview`.
5. Optionally choose server URL, tags, and sanitization.
6. Click `Add to Nodes`.

Imported endpoints are added as a palette group in Add Nodes.

### Multi-definition Swagger UI

If a Swagger UI page exposes multiple definitions/services:

- APIWeave discovers all available definitions.
- Endpoints from each definition are imported.
- Partial failures are reported (some definitions can fail while others still import).

### OpenAPI import troubleshooting

- "Select an environment before refreshing Swagger" — choose an environment in the toolbar first.
- "Environment has no Swagger/OpenAPI URL" — open Environment Manager and set `Swagger / OpenAPI URL`.
- "Failed to fetch Swagger URL" — verify URL starts with `http://` or `https://`; confirm the backend can reach that URL from its network; test with a direct spec URL if Swagger UI discovery fails.
- Imported templates not updating — click `Refresh` again after selecting the correct environment; confirm environment URL is the current source-of-truth spec.

---

## FAQ and Troubleshooting

> Source: `FAQ_TROUBLESHOOTING.md`

### FAQ

**Why are "Run from last failed" options disabled?** — Resume actions are shown only when the latest run for the workflow is failed. If your latest run succeeded, start a normal run and reproduce the failure first.

**Which failed node does "Run from last failed node" use?** — It uses the first failed node from the latest failed run. Use the per-node entries in the Run dropdown to pick a specific failed node.

**Why does my placeholder show up as plain text?** — Common causes: typo in variable namespace (`{{variable.x}}` instead of `{{variables.x}}`), variable not defined yet, extractor path is incorrect.

**What is the difference between `env`, `variables`, `prev`, and `secrets`?** — `env.*`: environment-level values; `variables.*`: workflow values created manually or via extractors; `prev.*`: previous node result (or `prev[index]` after merge); `secrets.*`: runtime secret values entered before run.

**Does Swagger refresh overwrite my HTTP node configs?** — No. Refresh updates import templates and warning metadata. Existing node request details remain yours.

**Can I use collections for execution order?** — Yes. Collection webhooks create a collection run and execute enabled workflows sequentially by collection order.

### Setup and startup issues

**Frontend does not load:** confirm frontend dev server is running on `http://localhost:3000`; check `frontend/.env` and `VITE_API_URL`; verify backend is reachable from browser.

**Backend does not start:** verify Python version (`3.13+`); verify MongoDB is running; check `backend/.env`.

**API calls fail from workflow runs:** verify URL and auth headers; verify selected environment values; confirm target API is reachable from backend runtime.

### Variables and extractors

**Extractor did not set value:** inspect node response body first; update extractor path to match real response shape; rerun workflow and check Variables panel.

**Old variable value persists:** update/delete value in Variables panel; rerun from the first relevant node in flow.

**Repeated failed resumes lose context:**

Symptoms: first resume fails (e.g. typo), second resume fails, after fixing config a later resume errors with missing/invalid variable-derived values.

Checks: confirm the failing placeholder exists exactly as expected (`{{variables.catID}}` vs typo variants); verify the variable is present in Variables panel after the source request succeeds; open Run History and confirm upstream request nodes have successful stored results.

Current behavior: resume hydration follows the resume lineage, not just the immediately previous failed attempt; failed runs persist variables and failed node metadata for follow-up resumes.

If an upstream value still cannot be resolved, run the full workflow once to refresh all context, then resume from failed nodes again.

**Merge branch variable lookup fails:** use branch index placeholders `{{prev[0].response...}}`, `{{prev[1].response...}}`; confirm merge strategy and available branch count from run results.

### Swagger/OpenAPI import and refresh

**Refresh button reports missing environment** — select environment in toolbar first.

**Refresh reports missing Swagger URL** — set `Swagger / OpenAPI URL` in Environment Manager.

**Import works for direct JSON URL but not Swagger UI URL** — try the direct OpenAPI endpoint first to confirm source is valid; ensure backend has network access to the same host/path.

**Some endpoints import, some fail** — this can happen with multi-definition Swagger sources; keep successful imports, then fix failing definition URLs upstream.

### Webhooks

**Webhook returns 401** — token missing or invalid; credentials may have been regenerated.

**Webhook returns 403** — webhook is disabled.

**Webhook returns 404** — webhook deleted or URL incorrect.

**Logs are empty** — no execution has occurred yet; verify trigger call and status code.

**Webhook returns 429** — rate limit exceeded (100 requests per hour per webhook); check `Retry-After` response header for seconds to wait; check `X-RateLimit-Reset` for the Unix timestamp when the window resets; reduce trigger frequency or spread calls across multiple webhooks.

**Webhook returns 401 — stale timestamp** — `X-Webhook-Timestamp` is outside the ±300 second replay window; ensure the system clock on your CI/CD runner is accurate (use NTP); generate the timestamp immediately before sending the request, not earlier in the pipeline.

**Webhook returns 401 — invalid signature** — HMAC-SHA256 signature does not match; verify the signing scheme `HMAC-SHA256(timestamp + raw_body_bytes)` using the HMAC secret; output must be a plain lowercase hex string (64 characters, no `sha256=` prefix in the hash value itself); confirm you are using the current HMAC secret (regeneration invalidates the old one); ensure the body used for signing matches the body sent exactly (no extra whitespace).

**Idempotency-Key returns 200 instead of 202** — this is expected behavior, not an error; a request with the same `Idempotency-Key` was already processed within the last 24 hours; the response includes `Idempotency-Replayed: true` header and the original response body; no new run was triggered; use the `runId` from the original response to check status; use a unique key per pipeline run (e.g. commit SHA + job ID) to avoid collisions.

### If you still need help

1. Reproduce with a minimal workflow.
2. Capture request/response details from the failing node.
3. Check backend logs and run history IDs.
4. Re-run with simplified inputs to isolate one failing step.

---

## Other (Navigation and Hub)

> Sources: `NAVIGATION.md`, `README.md`

### Three navigation paths (from NAVIGATION.md)

**Path A: Build and Run Your First Workflow**

1. [README](../README.md) - local setup and first run.
2. [Workflows and Nodes Guide](WORKFLOWS_AND_NODES.md) - canvas and node behavior.
3. [Variables, Extractors, and JSON Editor](VARIABLES_EXTRACTORS_JSON_EDITOR.md) - data passing.
4. [Environments, Secrets, and Collections](ENVIRONMENTS_COLLECTIONS.md) - reusable configuration.

**Path B: Import Existing API Definitions**

1. [Swagger and OpenAPI Import Guide](SWAGGER_UI_BASE_URL_IMPORT.md)
2. [Workflows and Nodes Guide](WORKFLOWS_AND_NODES.md) - drag imported requests to canvas.
3. [FAQ and Troubleshooting](FAQ_TROUBLESHOOTING.md) - resolve import and refresh issues.

**Path C: Trigger from CI/CD**

1. [Webhook Quick Start](WEBHOOK_QUICKSTART.md)
2. [Environments, Secrets, and Collections](ENVIRONMENTS_COLLECTIONS.md)
3. [FAQ and Troubleshooting](FAQ_TROUBLESHOOTING.md)

**Quick Links:** docs hub at `docs/README.md`, root project guide at `../README.md`, local API explorer at `http://localhost:8000/docs`.

### Doc hub structure (from README.md)

**Start Here:** New user path → Navigation Guide; Build flows quickly → Workflows and Nodes Guide; Pass data between steps → Variables, Extractors, and JSON Editor.

**Core Guides (9):**

- Authentication Setup
- Security and Deployment Checklist
- Workflows and Nodes Guide
- Variables, Extractors, and JSON Editor
- Environments, Secrets, and Collections
- MCP Integration Guide
- Swagger and OpenAPI Import Guide
- Webhook Quick Start
- FAQ and Troubleshooting

**Using these docs:** follow task-based guides in order from the navigation page; if something fails during setup or execution, use the troubleshooting guide.

---

## Noteworthy patterns for the rewrite

(notes from extraction — feed into rewrite planning)

- **Three separate credential systems** (SSO cookies for humans, webhook token+HMAC for CI, MCP API key for agents). Rewrites should not blur them.
- **Two webhook resource types** (Workflow, Collection) — both labeled "fully executable" in the webhook doc, but `MCP.md` and the apiweave-context Known Gaps suggest collection execution is still in flux. New docs should likely use a "Not yet supported in 1.0" callout for collection webhook execution, or at minimum call out the deferred status.
- **Environment secret runtime flow** — `ENVIRONMENTS_COLLECTIONS.md` describes a prompt-at-runtime model with browser session storage. `SECURITY.md` Migration Notes (F4/F10/F15/F19) tighten masking. Rewrite should reconcile the two views.
- **Two transport modes for MCP** (stdio and Streamable HTTP) with shared service layer. Streamable HTTP requires API key + Origin validation in production.
- **Two CI/CD patterns** (fire-and-forget vs blocking poll-and-fail) replicated for GitHub Actions, GitLab CI, and Jenkins. The same 60-iteration / 5s polling loop is copy-pasted in all three blocking snippets.
- **HMAC signing format** — `timestamp + body` (concatenated, no separator), HMAC-SHA256, lowercase hex output, no `sha256=` prefix. Replay window ±300s.
- **Idempotency** — `Idempotency-Key` header, 24h TTL, dedup by `(webhookId, Idempotency-Key)`. Returns 200 + `Idempotency-Replayed: true` on replay (not 202).
- **Rate limiting** — 100 req/hour per webhook ID; headers `X-RateLimit-Limit/Remaining/Reset` + `Retry-After`.
- **Worker exposure caveat** — anyone who can write `runs` collection with `status: "pending"` triggers arbitrary workflow execution. MongoDB must not be public.
- **MCP doc has small count mismatches** (Environment Tools header says 7, rows list 9; Resources header says 5, rows list 4). Either intentional in the original or a typo — flag for the rewrite to either correct or preserve.
- **OAuth providers in `AUTH_SETUP.md`**: GitHub (non-OIDC, requires `/user/emails`), GitLab (verified email), Google (OIDC), Microsoft (OIDC, multi-tenant via `common`).
- **Session defaults** (verbatim, useful for security page): idle 720 min (12h), absolute 10080 min (7d), SameSite=Lax, HttpOnly, Secure (in prod).
- **Trigger flow uses these headers**: `X-Webhook-Token`, `X-Webhook-Signature`, `X-Webhook-Timestamp`, optionally `Idempotency-Key`. Response includes `X-RateLimit-*` and `Retry-After`.
- **The "build" sequence most new users will hit** (Path A): setup → create workflow → add HTTP request → add assertion → run. Don't bury the lede in the rewrite.
