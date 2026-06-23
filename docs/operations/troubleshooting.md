# Central FAQ and Troubleshooting

*Conceptual answers to the "why" questions you hit while building and running workflows in APIWeave 2.0. This page explains how the system behaves, not how to fix a specific failure. For "if X happens, do Y" guidance, jump straight to the Troubleshooting section in the relevant feature doc.*

## Prerequisites

- [Installation](../getting-started/installation.md) and a working dev stack.
- [Concepts](../getting-started/concepts.md) for the organization, workspace, project, environment, secret, service token, and audit event vocabulary used below.

## Table of Contents

- [Conceptual Questions](#conceptual-questions)
- [Setup and Startup](#setup-and-startup)
- [Workspaces and Resources](#workspaces-and-resources)
- [Workflows and Runs](#workflows-and-runs)
- [Variables and Extractors](#variables-and-extractors)
- [Secrets and Environments](#secrets-and-environments)
- [Environment Protection](#environment-protection)
- [Webhooks](#webhooks)
- [MCP](#mcp)
- [Audit](#audit)
- [Security](#security)
- [Escalating](#escalating)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Conceptual Questions

These are the "why does it work this way" questions that come up regardless of which feature you are touching. They are answered in depth in the per-feature docs; the short version lives here.

### How does placeholder substitution decide which namespace to read?

The runner resolves `{{...}}` in a fixed order: workflow variables first, then the selected environment's variables, then the previous node result, then dynamic functions. The first match wins, so `{{BASE_URL}}` defined in both a workflow variable and an environment variable will always use the workflow value. If the runner finds nothing, it leaves the literal `{{...}}` text in the field, which is the most common reason a "placeholder shows up as plain text". The full resolution rules are in the [Placeholders Reference](../reference/placeholders.md).

```text
{{variables.token}}   # workflow variable (manual or extracted)
{{env.BASE_URL}}      # selected environment variable
{{prev.response.body.id}}  # previous node result
{{uuid()}}            # dynamic function call
```

### What is the secrets model in 2.0?

Secrets are declared as named keys at user, organization, workspace, or environment scope. The browser or agent encrypts the value with a Libsodium sealed box against the scope's public key before the request leaves. The backend never accepts a plaintext value, and the read APIs return metadata only. At run time, the executor resolves `{{secrets.NAME}}` through the [override chain](../reference/placeholders.md#secret-override-chain) (env > workspace > org), substitutes the plaintext into the request field, and the masking layer scrubs the value before any result is persisted. The full declaration and resolution flow lives in [Environments and Secrets](../features/environments-and-secrets.md), and the term itself is defined in [Concepts](../getting-started/concepts.md).

### Why is there no "active environment" flag in 2.0?

A run selects one environment explicitly. The same environment can be active for one run and inactive for another. The 1.0 `Environment.isActive` flag is gone because it forced a single shared "current" across every workflow, which does not scale to multiple workspaces or to environments that should be protected. The 2.0 model is: the canvas toolbar shows the environments visible to the current workspace, the user picks one, the run uses that one.

### How do scoped webhooks authenticate, and why both token and HMAC?

A scoped webhook has two independent guards. The `X-Webhook-Token` header is a long-lived shared secret that proves the caller knows the webhook id and the workspace. The `X-Webhook-Signature` and `X-Webhook-Timestamp` headers prove the request body was not tampered with: the server re-computes `HMAC-SHA256(timestamp + body)` and rejects mismatches. `WEBHOOK_REQUIRE_HMAC=true` makes the signature check mandatory. You can run with token-only on a trusted internal network, but anything reachable from the public internet should send both. The full signing scheme and example payloads are in [Webhooks](../features/webhooks.md).

## Setup and Startup

### Why does the frontend not load?

The frontend dev server binds to port 3000, but it does not start the backend. If the page renders but API calls hang, the backend is down or `VITE_API_URL` points at the wrong host. Cross-origin failures show up in the browser console as CORS or network errors, never as a blank page. For the operational checklist, see the Troubleshooting section in the per-feature docs and the [Architecture](../reference/architecture.md) page for the canonical local URLs.

### Why does the backend fail to start?

Three checks catch most startup failures: Python 3.13 or newer on `PATH`, a reachable MongoDB instance, and a populated `backend/.env` copied from `backend/.env.example`. The backend refuses to boot in production mode until the destructive database reset has run, the master `SECRET_ENCRYPTION_KEY` is set, and the first-owner sign-in has not yet occurred. The exact env vars and their roles are in the [Environment Variables Reference](../reference/environment-variables.md).

### Why does the first sign-in 404 on `/personal/workflows`?

The database was not wiped before the first sign-in. The 1.0 collections (or a prior 2.0 install) are still there, the personal workspace was not created, and the redirect to `/personal/workflows` lands on nothing. Run the destructive reset in [Installation](../getting-started/installation.md#destructive-database-reset) and try again.

## Workspaces and Resources

### Why does a workflow not appear in a workspace I just joined?

The workflow belongs to a different workspace. Use the org and workspace switcher in the header to navigate to the right `org/workspace` pair. The URL pattern is the source of truth: `/personal/workflows/{id}` is the personal workspace, `/<orgSlug>/<workspaceSlug>/workflows/{id}` is an organization-owned workspace.

### Why does an organization environment not show up in the workspace's environment selector?

The environment's `allowedWorkspaceIds` does not include the current workspace. Open the environment settings on the organization scope and add the workspace to the allowlist. Organization environments are invisible to workspaces that are not on the list.

### Why does a slug I want to reuse say "already taken"?

Slug reuse after soft delete is blocked. Once a slug is retired, no future resource can claim it. The check applies to organization slugs, workspace slugs, team slugs, and environment names. Pick a new slug.

## Workflows and Runs

### Why does a run fail without an obvious error?

A run fails for one of three reasons: a node threw, an assertion failed, or a placeholder could not be resolved. The first two show up in the per-node result panel with the captured status and error. The third looks like a "the request was wrong" failure but is really "the request was never sent", because the unsubstituted text went on the wire. Always check the node's `effective request` view in the run history, not just the status.

### Why does a placeholder resolve to empty rather than failing?

Some fields are explicitly allowed to be empty: optional headers, optional query parameters, and extractor targets. The runner strips an empty placeholder rather than leaving the literal `{{...}}` text, so a missing variable looks identical to a variable that resolved to `""`. The Variables panel is the source of truth: if the name is not there, the placeholder had nothing to read.

### Why are "Run from last failed" options disabled?

Resume actions are only shown when the latest run for the workflow actually failed. If the latest run succeeded, the controls stay hidden because there is nothing to resume from. Start a normal run, reproduce the failure, and the resume options will appear. Per-node resume entries are also disabled until a failed run exists.

### Why is my run stuck in `pending approval`?

The selected environment is protected. Open the environment's protection settings, see the [Environment Protection guide](environment-protection.md), and either collect approvals or add a service token to the bypass allowlist.

## Variables and Extractors

### Why does an old variable value persist after I update the extractor?

A workflow variable is only overwritten when the extractor that writes it actually runs and matches a value. If the upstream request short-circuits (for example, because `continueOnFail` skipped the node) or the JSONPath matches nothing, the previous value stays. The Variables panel always reflects the most recent successful write per variable, not the value in your current canvas configuration. Re-run the workflow from the first node that produces the variable to refresh it.

### Why does a merge branch variable lookup fail?

After a Merge node, `prev` refers to a list, not a single node. Use `{{prev[0].response.body.x}}` and `{{prev[1].response.body.x}}` to address each incoming branch by index. The branch index in the placeholder must match the order the branches arrived, which you can confirm in the merge node's run result.

### Why did the extractor set nothing?

Extractors read from the response body that the runner actually received, not the body you expect. If the response is an error page, a redirect HTML body, or an empty 204, the JSONPath has nothing to walk and the variable is left at its previous value (or absent). Inspect the node's stored response in the run history first, then update the path to match the real shape.

## Secrets and Environments

### Why does `{{secrets.NAME}}` resolve to empty?

No scope in the [override chain](../reference/placeholders.md#secret-override-chain) declared the key, or the stored ciphertext could not be decrypted. Open Secrets for the selected environment, the workspace, and the organization (in that order), and confirm the key exists on at least one scope. A personal secret participates only when the workspace or environment has a binding record for that user.

### Why is the secret write failing with a key-mismatch error?

The scope's public key rotated between the call to fetch it and the call to write. The UI retries automatically; if the failure persists, reload the Secrets page to fetch the fresh public key. The error response carries the new public key for an automatic retry.

### Why is the secret list empty after I imported a project bundle?

The `.awecollection` v2 bundle carries references only. It references the secret names and the scopes they should live in, but the values are not in the bundle. Re-create the values on the destination workspace through the Libsodium write flow.

### Why is my environment marked protected even though I never set a policy?

A workspace environment's protection policy defaults to no required reviewers, `allowSelfApproval = true`, and `bypassPolicy = none`. The protection is effectively off, but the policy is in place. If you want the environment to be unprotected, delete the policy from the protection settings page; if you want it locked down, add required reviewers.

## Environment Protection

### Why is a self-approval rejected?

`allowSelfApproval` is `false` for the environment. The run initiator cannot count as a reviewer. Either flip the policy (workspace owner action) or wait for another reviewer.

### Why is the service-token bypass not skipping the gate?

The token is not on the `bypassAllowlist` or `bypassPolicy` is `none`. Add the token id to the allowlist and confirm the policy is `trusted_token_only`. The audit log records the failed bypass attempt.

### Why is a required reviewer removed from a queue?

The protection policy's reviewer list changed after the run was queued. The run continues with the remaining reviewers; the audit log shows the removal and the new queue.

## Webhooks

### Why 401 vs 403 vs 404?

Each status code points at a different layer. `401` means the token or signature did not validate, which usually means a regeneration, a typo, or a clock skew outside the plus or minus 300s replay window. `403` means the webhook exists and authenticated, but is disabled. `404` means the webhook id in the URL does not exist, either because it was deleted, the path's `workspaceSlug` does not match the workspace that owns the webhook, or the path is wrong. The webhook logs page shows the exact reason and the headers the server received.

### What is idempotency, and why does it return 200 instead of 202?

Sending the same `Idempotency-Key` within 24 hours replays the original response. The server returns `200`, adds an `Idempotency-Replayed: true` header, and re-sends the original body. No new run starts. Use a deterministic key tied to the build, like `commit SHA + job ID`, so retries collapse but unrelated triggers do not. The replay window, the header names, and the exact response shape are documented in [Webhooks](../features/webhooks.md).

### Why does the HMAC signature not verify?

Three causes account for almost every signature failure. First, the body you sign is not byte-identical to the body you send: a trailing newline from `echo` is the classic culprit, use `printf '%s%s'`. Second, the timestamp is outside the plus or minus 300s window, which the server enforces to block replay attacks. Third, the secret was rotated and the caller is still using the old one. The signing recipe and a copy-paste shell snippet are in the [Webhooks](../features/webhooks.md) doc.

### Why 429, and what do the headers mean?

A `429` means the webhook hit the 100 requests per hour limit. The server returns two useful headers: `Retry-After` in seconds and `X-RateLimit-Reset` as a Unix timestamp. Read either one, wait, and retry. If you need higher throughput, split the work across multiple webhooks or back off the trigger frequency.

## MCP

### Why does the stdio server print nothing and the agent times out?

The stdio transport uses stdout for protocol frames and stderr for logs. A missing `.env` does not crash the process, it just leaves the server with no MongoDB target. The agent then waits forever for a `tools/list` response that never comes. Point the agent's `cwd` at the `backend` directory, or set `PYTHONPATH` to include it, and confirm `MCP_ENABLED=true`. The full launch recipe is in [MCP Integration](../features/mcp-integration.md).

### Why does the HTTP MCP return 401 or 403?

`401` means the `Authorization: Bearer <token>` header is missing, the value does not match a current scoped service token, the token is expired, or the token is revoked. Trailing whitespace from a password manager copy is a common culprit. `403` means the request authenticated but the `Origin` header is not in `MCP_ALLOWED_ORIGINS`, or the token's permission set does not include the called tool. Add the exact origin the agent calls from, narrow or widen the token's permission set, and restart the backend if you changed the allowlist. The header contract and a working HTTP example are in [MCP Integration](../features/mcp-integration.md).

### Why does the HTTP MCP return 421 "Invalid Host header"?

The MCP Python SDK has built-in DNS rebinding protection. It validates the `Host` header on every request. If the `Host` header (e.g. `127.0.0.2:8000`) doesn't match the allowlist, the SDK returns 421 before any application code runs. By default the Host allowlist is derived from `MCP_ALLOWED_ORIGINS` (scheme stripped, port wildcarded), so setting `MCP_ALLOWED_ORIGINS` to the correct frontend origin usually fixes this. If the backend is bound to a host that doesn't appear in the origins (e.g. a reverse proxy), set `MCP_ALLOWED_HOSTS` explicitly in `backend/.env` and restart.

### How does MCP prevent secret leakage in tool responses?

Every tool response runs through a redaction layer that scans for known secret patterns and replaces matches with a placeholder before the response leaves the backend. If a secret slips through, the detection patterns are missing the shape, not the redaction. Add the pattern that catches it in the secret detection service and avoid pasting the secret into public channels. Read and export tools also redact persisted secrets at the response layer; the secret service has no read API for stored values.

## Audit

### Why does the audit page return 403?

You do not have the `audit:read` permission on the requested scope. Ask an owner to grant the permission or visit the audit page for a scope you do have access to.

### Why is the JSON export empty?

The filter set matched zero events. Clear the filters and retry. The export is a snapshot of the current filter set in `createdAt` ascending order.

### Why is the audit log gone after the 2.0 install?

The destructive database reset wipes the audit log with the rest of the database. Take a JSON export before the reset if you need to preserve history. The [Audit Log guide](audit.md) has the export flow.

## Security

### Why does the session log me out immediately in production?

The session cookie drops the moment the browser sees a mismatch between `SESSION_COOKIE_SECURE` and the request scheme. In production over HTTPS, `SESSION_COOKIE_SECURE` must be `true`, otherwise the browser refuses to send the cookie on the next request. Idle and absolute timeouts in `SESSION_MAX_IDLE_MINUTES` and `SESSION_MAX_ABSOLUTE_MINUTES` are independent: idle re-authenticates, absolute forces a full re-login.

### Why do I see CORS errors in the browser console after switching to HTTPS?

`ALLOWED_ORIGINS` is an exact-match list. The browser sends an `Origin` header that includes the scheme, so an `http://` origin in the list will not match an `https://` request from the same host. Update the list to the new HTTPS origin and restart the backend. Wildcard origins are intentionally rejected for credentialed requests. See the [Security and Deployment Checklist](security.md) for the full pre-launch checklist.

### How does CSRF protection work?

CSRF tokens are tied to the session and required on every state-changing request when `CSRF_ENABLED=true`. The browser must read the token from a same-origin endpoint and echo it back in the request header, which a cross-origin attacker cannot do. Disabling CSRF in APIWeave is not a supported configuration, even for "internal" deployments.

## Escalating

### How do I get unstuck when none of the above matches?

1. Reproduce with a minimal workflow that has one node and no extractors. If the issue survives the minimal case, it is not your workflow.
2. Capture the exact request and response for the failing node from the run history, including headers.
3. Pull the run log (`backend/logs/run_<runId>.log`) and the backend stderr output. The log has the variable substitutions the runner actually applied.
4. Open the audit log and filter to the actor, action, and time of the failure. The audit event often points at the exact permission or scope that blocked the action.
5. Check the open issues and discussions for the same symptom. A second report of the same bug usually narrows the cause.

If the issue is reproducible and the per-feature troubleshooting did not resolve it, include the four items above plus the workflow or project JSON export and your `backend/.env` (with secrets redacted) when you ask for help.

## Troubleshooting

Operational "if X happens, do Y" guidance lives in the Troubleshooting section of each feature doc. Cross-reference them by symptom:

- [Webhooks Troubleshooting](../features/webhooks.md#troubleshooting) for 401/403/404/429 and signature failures.
- [MCP Integration Troubleshooting](../features/mcp-integration.md#troubleshooting) for stdio silence, HTTP 401/403, and secret leakage.
- [Environment Variables Troubleshooting](../reference/environment-variables.md#troubleshooting) for startup guards, CORS, and HMAC.
- [Variables and Extractors Troubleshooting](../features/variables-and-extractors.md#troubleshooting) for empty values and merge branch lookup.
- [Workflows and Nodes Troubleshooting](../features/workflows-and-nodes.md#troubleshooting) for run failures and resume options.
- [Projects Troubleshooting](../features/projects.md#troubleshooting) for project runs, `.awecollection` v2 import, and bundle references.
- [Environments and Secrets Troubleshooting](../features/environments-and-secrets.md#troubleshooting) for environment selection and secret resolution.
- [Environment Protection Troubleshooting](environment-protection.md#troubleshooting) for the approval queue and the trusted-token bypass.
- [Audit Log Troubleshooting](audit.md#troubleshooting) for missing events, filter sets, and the export.

## Related

- [Concepts](../getting-started/concepts.md) for the vocabulary used throughout this page.
- [Architecture Reference](../reference/architecture.md) for the request lifecycle and where each guard sits.
- [Security and Deployment Checklist](security.md) for the pre-launch hardening steps referenced in the Security section.
- [Webhooks](../features/webhooks.md) for the full signing and rate-limit contract.
- [MCP Integration](../features/mcp-integration.md) for the full transport and redaction contract.
- [Encryption Guide](encryption.md) for the per-scope Libsodium keypair model.
- [Audit Log](audit.md) for the append-only event log.
