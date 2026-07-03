# Webhooks

*Trigger workflow and project runs from external systems using scoped service tokens. Covers workspace-scoped webhook management, machine-to-machine authentication, idempotency, rate limiting, and CI/CD integration snippets for GitHub Actions, GitLab CI, and Jenkins.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the run, workflow, project, workspace, and service token definitions used in this guide.
- A running APIWeave 2.0 instance with a saved workflow or project to bind the webhook to.
- A scoped service token for the calling CI/CD system. See the workspace or organization settings to create one with the right permission set.
- For CI/CD snippets: shell access (`bash`), `curl`, and `openssl` on the agent that runs the pipeline.

## Table of Contents

- [What Is a Webhook](#what-is-a-webhook)
- [Webhook Management](#webhook-management)
- [Token and HMAC Authentication](#token-and-hmac-authentication)
- [Idempotency](#idempotency)
- [Rate Limiting](#rate-limiting)
- [CI/CD Integration](#cicd-integration)
- [GitHub Actions](#github-actions)
- [GitLab CI](#gitlab-ci)
- [Jenkins](#jenkins)
- [Execution Logs](#execution-logs)
- [Troubleshooting](#troubleshooting)
- [Related](#related)

## What Is a Webhook

A webhook is a workspace-scoped credential pair that lets an external system (a CI/CD pipeline, a deploy bot, a scheduler) start a workflow or project run on demand. The external system calls `POST /api/webhooks/workflows/{webhookId}/execute` or `POST /api/webhooks/collections/{webhookId}/execute` with the right headers, and APIWeave starts the run. The trigger is **machine-to-machine**: the caller authenticates with the workspace's scoped service token plus the webhook's HMAC signature, not with a human session.

Webhooks are bound to a workspace. An organization-scoped webhook does not exist in 2.0; a webhook always lives in the workspace that owns the workflow or project the trigger fires. If you need cross-workspace triggers, create a webhook in each workspace.

## Webhook Management

Webhook management is a human action done in the UI or through the scope-bound `/api/webhooks` CRUD API. You need an APIWeave SSO session with the workspace's `webhooks:create`, `webhooks:read`, or `webhooks:delete` permission, and the standard CSRF token for state-changing browser calls. CI/CD systems do **not** use these management endpoints; they use the execution endpoint with the machine token.

### Create a webhook (UI)

1. Sign in to APIWeave and navigate to the workspace.
2. Open the workspace settings and switch to **Webhooks**.
3. Click **Create**.
4. Pick a resource type: `Workflow` or `Project`.
5. Select the target workflow or project in this workspace.
6. Save. The modal shows the **token** and the **HMAC secret** once. Copy both immediately. They are not shown again.

### Create a webhook (API)

```bash
curl -X POST "$BASE_URL/api/webhooks" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Cookie: session=$SESSION_COOKIE" \
  -d '{
    "name": "ci-main-trigger",
    "resourceType": "Workflow",
    "resourceId": "wf_abc123"
  }'
```

The response includes `webhookId`, `token` (one-time), and `hmacSecret` (one-time). Persist them in your secret store right away.

### Manage existing webhooks

From the Webhooks list, you can:

- Enable or disable a webhook (a disabled webhook rejects all execution calls with `403`).
- View execution logs (the last 30 days are kept on the workspace, see [Execution Logs](#execution-logs)).
- Regenerate credentials (issues a new token and HMAC secret, invalidates the old pair immediately).
- Delete a webhook (irreversible; subsequent calls return `404`).

The `service_token` you used to call the management API is recorded in the audit log for every action. See [Audit Log](../operations/audit.md).

## Token and HMAC Authentication

Each webhook has two credentials: a **token** (identity) and an **HMAC secret** (payload integrity). The token is always required. HMAC is required in production.

### Required headers

| Header | Required | Purpose |
|--------|----------|---------|
| `X-Webhook-Token` | Always | Identifies which webhook the call belongs to. |
| `X-Webhook-Signature` | Production | HMAC-SHA256 over `timestamp + raw_body`. Lowercase hex, 64 characters. |
| `X-Webhook-Timestamp` | Production | Unix epoch seconds the request was prepared. |
| `Content-Type` | When sending a body | Must be `application/json` for JSON payloads. |

### HMAC signing recipe

The signature is computed over the timestamp string and the raw request body, concatenated **without any separator**:

```python
import hmac, hashlib

def sign(secret: str, timestamp: str, body: bytes) -> str:
    message = timestamp.encode("utf-8") + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
```

In `bash`, the same thing with `openssl`:

```bash
TIMESTAMP=$(date +%s)
BODY='{"buildId":"12345","branch":"main"}'
SIGNATURE=$(printf '%s%s' "$TIMESTAMP" "$BODY" \
  | openssl dgst -sha256 -hmac "$APIWEAVE_HMAC_SECRET" \
  | awk '{print $2}')
```

### Replay protection

The server enforces a plus or minus 300 second (5 minute) window between `X-Webhook-Timestamp` and its own clock. Calls outside that window are rejected with `401`. Always read the timestamp from the local clock at the moment you build the body, not at the moment you build the signature alone.

### Token-only mode (development)

With `WEBHOOK_REQUIRE_HMAC=false`, you can call the execute endpoint with only `X-Webhook-Token`. Use this for local development and integration tests. Production deployments must keep `WEBHOOK_REQUIRE_HMAC=true`; setting it to `false` in production logs a per-request warning.

## Idempotency

A retried CI/CD call must not start a second run. Send a unique `Idempotency-Key` header:

```bash
curl -X POST "$BASE_URL/api/webhooks/workflows/$WEBHOOK_ID/execute" \
  -H "X-Webhook-Token: $TOKEN" \
  -H "Idempotency-Key: $CI_PIPELINE_ID-$BUILD_NUMBER" \
  -H "Content-Type: application/json" \
  -d '{"buildId":"12345"}'
```

Rules:

- **Scope**: deduplication is scoped by `(webhookId, Idempotency-Key)`. The same key against a different webhook is a different request.
- **TTL**: 24 hours. After that the key is forgotten and the next call with the same key starts a new run.
- **Replay response**: a repeat call inside the TTL returns `200 OK` with the original `202` body, plus the header `Idempotency-Replayed: true`. No second run is triggered.

Use a deterministic key per build (`$CI_PIPELINE_ID-$BUILD_NUMBER`, `$GITHUB_RUN_ID`, `$BUILD_TAG`) so retries collapse cleanly.

## Rate Limiting

Each webhook is limited to **100 requests per hour**, counted per webhook ID. When the limit is exceeded, the server returns `429 Too Many Requests` and refuses the call.

Response headers on every execution call:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Maximum allowed in the current window (`100`). |
| `X-RateLimit-Remaining` | Requests left in the current window. |
| `X-RateLimit-Reset` | Unix epoch timestamp when the window resets. |
| `Retry-After` | Seconds to wait before retrying (present on `429`). |

Memory-backed limiting is per process and is intended for local or single-instance deployments. Public multi-instance hosts should set `RATE_LIMITER_BACKEND=mongodb` so every API process shares one atomic per-webhook counter.

## CI/CD Integration

Two patterns work for every platform:

- **Fire-and-Forget**: POST to the webhook, exit immediately. The pipeline does not wait for results.
- **Blocking Poll-and-Fail**: POST, capture the returned `runId`, poll until the run reaches a terminal state, exit non-zero on failure. Useful for gates that must pass before the pipeline continues.

## GitHub Actions

Store `APIWEAVE_BASE_URL`, `APIWEAVE_WEBHOOK_TOKEN`, and `APIWEAVE_HMAC_SECRET` in repo or environment secrets. Fire-and-Forget with HMAC:

```yaml
name: Trigger APIWeave Tests
on: [push]
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Webhook (HMAC)
        env:
          BASE_URL: ${{ secrets.APIWEAVE_BASE_URL }}
          TOKEN: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}
          SECRET: ${{ secrets.APIWEAVE_HMAC_SECRET }}
          KEY: ${{ github.run_id }}-${{ github.run_number }}
        run: |
          TIMESTAMP=$(date +%s)
          BODY="{\"commit\":\"${{ github.sha }}\"}"
          SIGNATURE=$(printf '%s%s' "$TIMESTAMP" "$BODY" \
            | openssl dgst -sha256 -hmac "$SECRET" \
            | awk '{print $2}')
          echo "::add-mask::$SIGNATURE"
          curl -X POST "$BASE_URL/api/webhooks/workflows/${{ secrets.APIWEAVE_WEBHOOK_ID }}/execute" \
            -H "X-Webhook-Token: $TOKEN" \
            -H "X-Webhook-Signature: $SIGNATURE" \
            -H "X-Webhook-Timestamp: $TIMESTAMP" \
            -H "Idempotency-Key: $KEY" \
            -H "Content-Type: application/json" \
            -d "$BODY"
```

## GitLab CI

Set the same variables in `Settings > CI/CD > Variables`. Mark `APIWEAVE_WEBHOOK_TOKEN` and `APIWEAVE_HMAC_SECRET` as **Masked** and **Protected**. Fire-and-Forget with HMAC:

```yaml
trigger_tests:
  stage: test
  script:
    - |
      TIMESTAMP=$(date +%s)
      BODY="{\"commit\":\"${CI_COMMIT_SHA}\"}"
      SIGNATURE=$(printf '%s%s' "$TIMESTAMP" "$BODY" \
        | openssl dgst -sha256 -hmac "${APIWEAVE_HMAC_SECRET}" \
        | awk '{print $2}')
      curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/workflows/${APIWEAVE_WEBHOOK_ID}/execute" \
        -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
        -H "X-Webhook-Signature: ${SIGNATURE}" \
        -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
        -H "Idempotency-Key: ${CI_PIPELINE_ID}-${CI_PIPELINE_IID}" \
        -H "Content-Type: application/json" \
        -d "${BODY}"
```

## Jenkins

Add five **Secret text** credentials in the Jenkins Credentials Provider: `apiweave-base-url`, `apiweave-org-slug`, `apiweave-workspace-slug`, `apiweave-token`, `apiweave-hmac-secret`. Bind them with `withCredentials` so they are auto-masked in the build log. Fire-and-Forget with HMAC (Groovy):

```groovy
pipeline {
    agent any
    stages {
        stage('Trigger APIWeave') {
            steps {
                withCredentials([
                    string(credentialsId: 'apiweave-base-url',     variable: 'APIWEAVE_BASE_URL'),
                    string(credentialsId: 'apiweave-token',         variable: 'APIWEAVE_WEBHOOK_TOKEN'),
                    string(credentialsId: 'apiweave-hmac-secret',  variable: 'APIWEAVE_HMAC_SECRET')
                ]) {
                    sh '''
                        TIMESTAMP=$(date +%s)
                        BODY="{\\"build\\":\\"${BUILD_NUMBER}\\",\\"job\\":\\"${JOB_NAME}\\"}"
                        SIGNATURE=$(printf "%s%s" "$TIMESTAMP" "$BODY" \
                          | openssl dgst -sha256 -hmac "$APIWEAVE_HMAC_SECRET" \
                          | awk "{print \$2}")
                        curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/workflows/${APIWEAVE_WEBHOOK_ID}/execute" \
                          -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
                          -H "X-Webhook-Signature: ${SIGNATURE}" \
                          -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
                          -H "Idempotency-Key: ${BUILD_TAG}" \
                          -H "Content-Type: application/json" \
                          -d "${BODY}"
                    '''
                }
            }
        }
    }
}
```

## Execution Logs

Each `/execute` call writes a `WebhookLog` document scoped to the workspace, with the webhook id, the caller's IP, the headers, the response status, and the idempotency key. Logs are retained for 30 days.

View logs from the UI by opening the webhook and clicking `Logs`, or fetch them through the workspace API:

```bash
curl "$BASE_URL/api/webhooks/$WEBHOOK_ID/logs?limit=50" \
  -H "Cookie: session=$SESSION_COOKIE"
```

The `result` field is `accepted` for a successful run start, or `rejected_*` for failed auth, idempotency, or rate-limit decisions. Sensitive headers and bodies are redacted in the stored log.

## Troubleshooting

- **If you get `401 Invalid or missing token`**, the `X-Webhook-Token` header is missing, mistyped, or from a webhook that was regenerated. Copy the current token from the Webhooks page (you may need to regenerate) and update the CI/CD secret store.
- **If you get `401 Missing X-Webhook-Signature header`**, the server has `WEBHOOK_REQUIRE_HMAC=true` and the request did not include `X-Webhook-Signature` and `X-Webhook-Timestamp`. Compute the signature over `timestamp + body`, send all three headers, and re-run.
- **If you get `403 Webhook disabled`**, the webhook was disabled in the UI. Re-enable it from the Webhooks page, or call the management API to flip the `enabled` flag.
- **If you get `404 Webhook not found`**, the webhook id in the URL is wrong, the webhook was deleted, or your session cannot see the workspace that owns it. Check `GET /api/webhooks/workflows/{workflowId}` or `GET /api/webhooks/collections/{projectId}` for the list of ids bound to the target resource.
- **If you get `429 Too Many Requests`**, you hit the 100/hour limit for that webhook. Read the `Retry-After` and `X-RateLimit-Reset` headers, wait, and retry. Lower the trigger frequency, or split work across multiple webhooks.
- **If the signature never verifies**, the most common cause is a `printf` vs `echo` mismatch. Use `printf '%s%s' "$TIMESTAMP" "$BODY"` so the trailing newline from `echo` does not contaminate the HMAC input. Also confirm the body you sign is byte-identical to the body you send.
- **If a retried CI build starts a second run**, you did not send an `Idempotency-Key`, or the key differs between retries. Use a deterministic key tied to the build (`$CI_PIPELINE_ID-$BUILD_NUMBER`, `${{ github.run_id }}-${{ github.run_number }}`, `$BUILD_TAG`).
- **If the webhook lives in a different workspace than the workflow or project you expected to fire**, the trigger will return `404` or `403` because the webhook is bound to the workspace that owns its target resource. Create a webhook in the same workspace as the target resource.

## Related

- [Concepts](../getting-started/concepts.md) for run, workflow, project, and workspace definitions.
- [Variables and Extractors](variables-and-extractors.md) for the placeholder syntax used in webhook-triggered runs.
- [Architecture Reference](../reference/architecture.md) for the request lifecycle that a webhook-triggered run follows.
- [Audit Log](../operations/audit.md) for the events that webhook deliveries write.
