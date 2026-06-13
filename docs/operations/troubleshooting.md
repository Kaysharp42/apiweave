# Central FAQ and Troubleshooting

*Conceptual answers to the "why" questions you hit while building and running workflows. This page explains how the system behaves, not how to fix a specific failure. For "if X happens, do Y" guidance, jump straight to the Troubleshooting section in the relevant feature doc.*

## Prerequisites

- [Installation](../getting-started/installation.md) and a working dev stack.
- [Concepts](../getting-started/concepts.md) for the workflow, run, environment, variable, and extractor vocabulary used below.

## Table of Contents

- [Conceptual Questions](#conceptual-questions)
- [Setup and Startup](#setup-and-startup)
- [Workflows and Runs](#workflows-and-runs)
- [Variables and Extractors](#variables-and-extractors)
- [Swagger / OpenAPI Import](#swagger--openapi-import)
- [Webhooks](#webhooks)
- [MCP](#mcp)
- [Security](#security)
- [Escalating](#escalating)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## Conceptual Questions

These are the "why does it work this way" questions that come up regardless of which feature you are touching. They are answered in depth in the per-feature docs; the short version lives here.

### How does placeholder substitution decide which namespace to read?

The runner resolves `{{...}}` in a fixed order: workflow variables first, then environment variables, then the previous node result, then dynamic functions. The first match wins, so `{{BASE_URL}}` defined in both a workflow variable and an environment variable will always use the workflow value. If the runner finds nothing, it leaves the literal `{{...}}` text in the field, which is the most common reason a "placeholder shows up as plain text". The full resolution rules are in the [Placeholders Reference](../reference/placeholders.md).

```text
{{variables.token}}   # workflow variable (manual or extracted)
{{env.BASE_URL}}      # environment variable
{{prev.response.body.id}}  # previous node result
{{uuid()}}            # dynamic function call
```

### What is the secrets model in 1.0?

The data model for secrets exists, and you can declare secret keys on an environment today. Runtime resolution of `{{secrets.NAME}}` is **not yet implemented in APIWeave 1.0**. Treat the secret namespace as a known gap. Use an environment variable in the meantime and follow the release notes for the runtime flow. See the [Secrets and Environments](environments-and-secrets.md) doc for the full status and the [Concepts](../getting-started/concepts.md) glossary for the distinction.

### How do webhooks authenticate, and why both token and HMAC?

A webhook has two independent guards. The `X-Webhook-Token` header is a long-lived shared secret that proves the caller knows the webhook ID. The `X-Webhook-Signature` and `X-Webhook-Timestamp` headers prove the request body was not tampered with: the server re-computes `HMAC-SHA256(timestamp + body)` and rejects mismatches. `WEBHOOK_REQUIRE_HMAC=true` makes the signature check mandatory. You can run with token-only on a trusted internal network, but anything reachable from the public internet should send both. The full signing scheme and example payloads are in [Webhooks](webhooks.md).

## Setup and Startup

### Why does the frontend not load?

The frontend dev server binds to port 3000, but it does not start the backend. If the page renders but API calls hang, the backend is down or `VITE_API_URL` points at the wrong host. Cross-origin failures show up in the browser console as CORS or network errors, never as a blank page. For the operational checklist, see the Troubleshooting section in the per-feature docs and the [Architecture](../reference/architecture.md) page for the canonical local URLs.

### Why does the backend fail to start?

Three checks catch most startup failures: Python 3.13 or newer on `PATH`, a reachable MongoDB instance, and a populated `backend/.env` copied from `backend/.env.example`. The backend refuses to boot in production mode until `SETUP_MODE_ENABLED` is turned off and at least one admin account exists, which is a startup guard rather than a runtime warning. The exact env vars and their roles are in the [Environment Variables Reference](../reference/environment-variables.md).

## Workflows and Runs

### Why does a run fail without an obvious error?

A run fails for one of three reasons: a node threw, an assertion failed, or a placeholder could not be resolved. The first two show up in the per-node result panel with the captured status and error. The third looks like a "the request was wrong" failure but is really "the request was never sent", because the unsubstituted text went on the wire. Always check the node's `effective request` view in the run history, not just the status.

### Why does a placeholder resolve to empty rather than failing?

Some fields are explicitly allowed to be empty: optional headers, optional query parameters, and extractor targets. The runner strips an empty placeholder rather than leaving the literal `{{...}}` text, so a missing variable looks identical to a variable that resolved to `""`. The Variables panel is the source of truth: if the name is not there, the placeholder had nothing to read.

### Why are "Run from last failed" options disabled?

Resume actions are only shown when the latest run for the workflow actually failed. If the latest run succeeded, the controls stay hidden because there is nothing to resume from. Start a normal run, reproduce the failure, and the resume options will appear. Per-node resume entries are also disabled until a failed run exists. For the full control states, see the operational checklist in the per-feature troubleshooting sections.

## Variables and Extractors

### Why does an old variable value persist after I update the extractor?

A workflow variable is only overwritten when the extractor that writes it actually runs and matches a value. If the upstream request short-circuits (for example, because `continueOnFail` skipped the node) or the JSONPath matches nothing, the previous value stays. The Variables panel always reflects the most recent successful write per variable, not the value in your current canvas configuration. Re-run the workflow from the first node that produces the variable to refresh it.

### Why does a merge branch variable lookup fail?

After a Merge node, `prev` refers to a list, not a single node. Use `{{prev[0].response.body.x}}` and `{{prev[1].response.body.x}}` to address each incoming branch by index. The branch index in the placeholder must match the order the branches arrived, which you can confirm in the merge node's run result. Plain `{{prev.response.body.x}}` resolves against the first branch only and silently returns whatever that branch has, which masks the real bug.

### Why did the extractor set nothing?

Extractors read from the response body that the runner actually received, not the body you expect. If the response is an error page, a redirect HTML body, or an empty 204, the JSONPath has nothing to walk and the variable is left at its previous value (or absent). Inspect the node's stored response in the run history first, then update the path to match the real shape.

## Swagger / OpenAPI Import

### Will refresh overwrite my HTTP node configs?

No. The Refresh action updates the import templates in the Add Nodes palette and the warning metadata for nodes whose source endpoint changed, but it never rewrites the URL, method, headers, or body of a node already on the canvas. The canvas is yours. The "Check API" badge appears on nodes whose request shape has drifted from the spec; click it to see the diff and accept or revert.

### Why does import work for the direct JSON URL but not the Swagger UI URL?

A Swagger UI URL renders HTML and the importer needs the raw spec. The two URL shapes that work are the direct OpenAPI endpoint (often `/v3/api-docs` or `/openapi.json`) and a static `.json`/`.yaml` file. If you have access to the same spec file the UI loads, paste the static URL. If only the UI is reachable, fetch the spec from the UI's network tab and import the file once. The full import paths are in the [Swagger and OpenAPI Import](swagger-import.md) doc.

## Webhooks

### Why 401 vs 403 vs 404?

Each status code points at a different layer. `401` means the token or signature did not validate, which usually means a regeneration, a typo, or a clock skew outside the ±300s replay window. `403` means the webhook exists and authenticated, but is disabled. `404` means the webhook ID in the URL does not exist, either because it was deleted or the path is wrong. The webhook logs page shows the exact reason and the headers the server received.

### What is idempotency, and why does it return 200 instead of 202?

Sending the same `Idempotency-Key` within 24 hours replays the original response. The server returns `200`, adds an `Idempotency-Replayed: true` header, and re-sends the original body. No new run starts. Use a deterministic key tied to the build, like `commit SHA + job ID`, so retries collapse but unrelated triggers do not. The replay window, the header names, and the exact response shape are documented in [Webhooks](webhooks.md).

### Why does the HMAC signature not verify?

Three causes account for almost every signature failure. First, the body you sign is not byte-identical to the body you send: a trailing newline from `echo` is the classic culprit, use `printf '%s%s'`. Second, the timestamp is outside the ±300s window, which the server enforces to block replay attacks. Third, the secret was rotated and the caller is still using the old one. The signing recipe and a copy-paste shell snippet are in the [Webhooks](webhooks.md) doc.

### Why 429, and what do the headers mean?

A `429` means the webhook hit the 100 requests per hour limit. The server returns two useful headers: `Retry-After` in seconds and `X-RateLimit-Reset` as a Unix timestamp. Read either one, wait, and retry. If you need higher throughput, split the work across multiple webhooks or back off the trigger frequency. The full rate-limit contract is in the [Webhooks](webhooks.md) doc.

## MCP

### Why does the stdio server print nothing and the agent times out?

The stdio transport uses stdout for protocol frames and stderr for logs. A missing `.env` does not crash the process, it just leaves the server with no MongoDB target. The agent then waits forever for a `tools/list` response that never comes. Point the agent's `cwd` at the `backend` directory, or set `PYTHONPATH` to include it, and confirm `MCP_ENABLED=true`. The full launch recipe is in [MCP Integration](mcp-integration.md).

### Why does the HTTP MCP return 401 or 403?

`401` means the `Authorization: Bearer <key>` header is missing or the value does not match `MCP_API_KEY` byte for byte. Trailing whitespace from a password manager copy is a common culprit. `403` means the request authenticated but the `Origin` header is not in `MCP_ALLOWED_ORIGINS`. Add the exact origin the agent calls from and restart the backend. The header contract and a working HTTP example are in [MCP Integration](mcp-integration.md).

### How does MCP prevent secret leakage in tool responses?

Every tool response runs through a redaction layer that scans for known secret patterns and replaces matches with a placeholder before the response leaves the backend. If a secret slips through, the detection patterns are missing the shape, not the redaction. Add the pattern that catches it in `secret_utils.py` and avoid pasting the secret into public channels. The detection surface and update path are documented in [MCP Integration](mcp-integration.md).

## Security

### Why does the session log me out immediately in production?

The session cookie drops the moment the browser sees a mismatch between `SESSION_COOKIE_SECURE` and the request scheme. In production over HTTPS, `SESSION_COOKIE_SECURE` must be `true`, otherwise the browser refuses to send the cookie on the next request. Idle and absolute timeouts in `SESSION_MAX_IDLE_MINUTES` and `SESSION_MAX_ABSOLUTE_MINUTES` are independent: idle re-authenticates, absolute forces a full re-login. The full cookie model is in the [Environment Variables Reference](../reference/environment-variables.md).

### Why do I see CORS errors in the browser console after switching to HTTPS?

`ALLOWED_ORIGINS` is an exact-match list. The browser sends an `Origin` header that includes the scheme, so an `http://` origin in the list will not match an `https://` request from the same host. Update the list to the new HTTPS origin and restart the backend. Wildcard origins are intentionally rejected for credentialed requests. See the [Security and Deployment Checklist](../SECURITY.md) for the full pre-launch checklist.

### How does CSRF protection work?

CSRF tokens are tied to the session and required on every state-changing request when `CSRF_ENABLED=true`. The browser must read the token from a same-origin endpoint and echo it back in the request header, which a cross-origin attacker cannot do. Disabling CSRF in APIWeave is not a supported configuration, even for "internal" deployments. The full token model and the header name are in the [Security and Deployment Checklist](../SECURITY.md).

## Escalating

### How do I get unstuck when none of the above matches?

1. Reproduce with a minimal workflow that has one node and no extractors. If the issue survives the minimal case, it is not your workflow.
2. Capture the exact request and response for the failing node from the run history, including headers.
3. Pull the run log (`backend/logs/run_<runId>.log`) and the backend stderr output. The log has the variable substitutions the runner actually applied.
4. Check the open issues and discussions for the same symptom. A second report of the same bug usually narrows the cause.

If the issue is reproducible and the per-feature troubleshooting did not resolve it, include the four items above plus the workflow JSON export and your `backend/.env` (with secrets redacted) when you ask for help.

## Troubleshooting

Operational "if X happens, do Y" guidance lives in the Troubleshooting section of each feature doc. Cross-reference them by symptom:

- [Webhooks Troubleshooting](webhooks.md#troubleshooting) for 401/403/404/429 and signature failures.
- [MCP Integration Troubleshooting](mcp-integration.md#troubleshooting) for stdio silence, HTTP 401/403, and secret leakage.
- [Environment Variables Troubleshooting](../reference/environment-variables.md#troubleshooting) for startup guards, CORS, and HMAC.
- [Variables and Extractors Troubleshooting](variables-and-extractors.md#troubleshooting) for empty values and merge branch lookup.
- [Workflows and Nodes Troubleshooting](workflows-and-nodes.md#troubleshooting) for run failures and resume options.
- [Swagger Import Troubleshooting](swagger-import.md#troubleshooting) for URL and refresh issues.
- [Environments and Secrets Troubleshooting](environments-and-secrets.md#troubleshooting) for active-environment and secret-key issues.

## Related

- [Concepts](../getting-started/concepts.md) for the vocabulary used throughout this page.
- [Architecture Reference](../reference/architecture.md) for the request lifecycle and where each guard sits.
- [Security and Deployment Checklist](../SECURITY.md) for the pre-launch hardening steps referenced in the Security section.
- [Webhooks](webhooks.md) for the full signing and rate-limit contract.
- [MCP Integration](mcp-integration.md) for the full transport and redaction contract.
