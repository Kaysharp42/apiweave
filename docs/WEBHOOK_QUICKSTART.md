# Webhook Quick Start

Use webhooks to trigger workflow runs from CI/CD or any external system.

## What You Get

- A webhook URL
- A webhook token (`X-Webhook-Token` header)
- An HMAC secret (`X-Webhook-Signature`, optional hardening)

Important: token and HMAC secret are shown once at creation/regeneration time. Copy them immediately.

## Create a Webhook

Webhook management is a human UI/API action. You must be signed in to APIWeave with the appropriate `webhooks:*` permission (for example, `webhooks:create` to create, `webhooks:read` to list/read, and `webhooks:delete` to delete). Browser admin keys are not supported for webhook management.

If your session expires, sign in again through SSO. Webhook management uses the same HttpOnly session and CSRF protection as the rest of the APIWeave UI; CI/CD systems should never receive or reuse human session cookies.

1. Open APIWeave and go to `Webhooks` in the sidebar.
2. Click `Create`.
3. Choose resource type:
   - `Workflow` (fully executable)
   - `Collection` (fully executable)
4. Select target workflow/collection.
5. Optionally select an environment.
6. Save and copy credentials from the modal.

## Trigger a Workflow Webhook

Use the credentials you copied.

```bash
curl -X POST "<WEBHOOK_URL>" \
  -H "X-Webhook-Token: <WEBHOOK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"buildId":"12345","branch":"main"}'
```

Expected behavior:

- API returns `202 Accepted`
- Response includes `runId` and poll URLs
- Run appears in workflow history/logs

## Security

Webhook execution is machine-to-machine authentication. Keep these execution credentials in your CI/CD secret manager; they are separate from human login sessions.

For production hardening, see [Security](SECURITY.md). For SSO and user permission setup, see [Authentication Setup](AUTH_SETUP.md).

### Token-Only Development Compatibility

When `WEBHOOK_REQUIRE_HMAC=false`, you can authenticate by sending only the `X-Webhook-Token` header. This is intended for local development and compatibility testing only.

### HMAC Signature Verification

Production deployments should set `WEBHOOK_REQUIRE_HMAC=true`. When enabled, APIWeave rejects token-only execution requests with `401 Unauthorized`; callers must send both signature headers. HMAC prevents replay attacks and ensures payload integrity.

To use HMAC, send these headers:
- `X-Webhook-Token`: Your webhook token.
- `X-Webhook-Signature`: The HMAC-SHA256 signature of the payload.
- `X-Webhook-Timestamp`: The Unix epoch timestamp (in seconds) when the request was sent.

#### Signing Scheme

The signature is calculated as an HMAC-SHA256 hash over the concatenation of the timestamp and the raw request body.
```python
# Message format: timestamp + body
message = timestamp.encode('utf-8') + raw_body_bytes
```
The output must be a plain lowercase hexadecimal string (64 characters, no prefix).

#### Replay Protection

APIWeave enforces a replay window of ±300 seconds (5 minutes) from the server clock. If the difference between the server time and `X-Webhook-Timestamp` exceeds 300 seconds, the request is rejected with a `401 Unauthorized` response.

## Idempotency

To prevent duplicate executions from network retries or CI/CD double-triggers, send an `Idempotency-Key` header with a unique string.

- **Deduplication Scope**: Scoped by the combination of `(webhookId, Idempotency-Key)`. This prevents key collisions across different webhooks.
- **TTL**: 24 hours.
- **Behavior**: If a request with the same key is received within 24 hours, APIWeave returns the original `202 Accepted` response body with a `200 OK` status code and the `Idempotency-Replayed: true` header. It doesn't trigger a new run.

## Rate Limiting

To protect system resources, webhooks are rate limited.

- **Limit**: 100 requests per hour per webhook ID.
- **Throttled Response**: Returns `429 Too Many Requests` when the limit is exceeded.
- **Headers**: Every response includes rate limit metadata:
  - `X-RateLimit-Limit`: The maximum allowed requests per hour (100).
  - `X-RateLimit-Remaining`: The number of remaining requests in the current window.
  - `X-RateLimit-Reset`: The Unix epoch timestamp when the limit resets.
  - `Retry-After`: The number of seconds to wait before retrying.

## CI/CD Integration

You can integrate APIWeave webhooks into your deployment pipelines using two execution modes:
1. **Fire-and-Forget**: Triggers the workflow run and immediately exits. The pipeline doesn't wait for the test results.
2. **Blocking (Poll-and-Fail)**: Triggers the workflow run, captures the run ID, and polls the status endpoint until the run completes. If any test fails or the polling times out, the pipeline fails.

### GitHub Actions

#### Secret Setup
Store your credentials in your GitHub repository secrets:
- `APIWEAVE_BASE_URL`: The base URL of your APIWeave instance (e.g., `https://apiweave.example.com`).
- `APIWEAVE_WEBHOOK_TOKEN`: The secret token for the webhook.
- `APIWEAVE_HMAC_SECRET`: The secret key for HMAC signing.

#### Fire-and-Forget Snippet

##### Token-Only Minimal (development only)
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

##### HMAC-Required in Production
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
          
          # Generate HMAC-SHA256 signature
          SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${{ secrets.APIWEAVE_HMAC_SECRET }}" | awk '{print $2}')
          
          # Mask the signature in runner logs
          echo "::add-mask::$SIGNATURE"
          
          curl -X POST "${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/<WEBHOOK_ID>/execute" \
            -H "X-Webhook-Token: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}" \
            -H "X-Webhook-Signature: $SIGNATURE" \
            -H "X-Webhook-Timestamp: $TIMESTAMP" \
            -H "Content-Type: application/json" \
            -d "$BODY"
```

#### Blocking Poll-and-Fail Snippet

##### Token-Only Minimal (development only)
```yaml
name: Run APIWeave Tests and Wait
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger and Poll
        run: |
          RESPONSE=$(curl -s -X POST "${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/<WEBHOOK_ID>/execute" \
            -H "X-Webhook-Token: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{"commit": "${{ github.sha }}"}')
          
          RUN_ID=$(echo "$RESPONSE" | jq -r '.runId')
          if [ "$RUN_ID" = "null" ] || [ -z "$RUN_ID" ]; then
            echo "Failed to trigger workflow run: $RESPONSE"
            exit 1
          fi
          
          echo "Triggered run: $RUN_ID"
          
          # Poll status endpoint (max 60 iterations, 5s interval)
          for i in {1..60}; do
            STATUS_RESP=$(curl -s "${{ secrets.APIWEAVE_BASE_URL }}/api/runs/$RUN_ID")
            STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
            echo "Current status: $STATUS"
            
            if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
              echo "Workflow run completed successfully."
              exit 0
            elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
              echo "Workflow run failed."
              exit 1
            fi
            sleep 5
          done
          
          echo "Polling timed out after 5 minutes."
          exit 1
```

##### HMAC-Required in Production
```yaml
name: Run APIWeave Tests and Wait (HMAC)
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger and Poll with HMAC
        run: |
          TIMESTAMP=$(date +%s)
          BODY='{"commit": "${{ github.sha }}"}'
          
          SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${{ secrets.APIWEAVE_HMAC_SECRET }}" | awk '{print $2}')
          echo "::add-mask::$SIGNATURE"
          
          RESPONSE=$(curl -s -X POST "${{ secrets.APIWEAVE_BASE_URL }}/api/webhooks/<WEBHOOK_ID>/execute" \
            -H "X-Webhook-Token: ${{ secrets.APIWEAVE_WEBHOOK_TOKEN }}" \
            -H "X-Webhook-Signature: $SIGNATURE" \
            -H "X-Webhook-Timestamp: $TIMESTAMP" \
            -H "Content-Type: application/json" \
            -d "$BODY")
          
          RUN_ID=$(echo "$RESPONSE" | jq -r '.runId')
          if [ "$RUN_ID" = "null" ] || [ -z "$RUN_ID" ]; then
            echo "Failed to trigger workflow run: $RESPONSE"
            exit 1
          fi
          
          echo "Triggered run: $RUN_ID"
          
          for i in {1..60}; do
            STATUS_RESP=$(curl -s "${{ secrets.APIWEAVE_BASE_URL }}/api/runs/$RUN_ID")
            STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
            echo "Current status: $STATUS"
            
            if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
              echo "Workflow run completed successfully."
              exit 0
            elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
              echo "Workflow run failed."
              exit 1
            fi
            sleep 5
          done
          
          echo "Polling timed out after 5 minutes."
          exit 1
```

### GitLab CI

#### Variable Setup
Define these variables in your GitLab project under **Settings > CI/CD > Variables**:
- `APIWEAVE_BASE_URL`: The base URL of your APIWeave instance.
- `APIWEAVE_WEBHOOK_TOKEN`: The secret token for the webhook. Enable **Mask variable** and **Protect variable** in the GitLab UI.
- `APIWEAVE_HMAC_SECRET`: The secret key for HMAC signing. Enable **Mask variable** and **Protect variable** in the GitLab UI.

#### Fire-and-Forget Snippet

##### Token-Only Minimal (development only)
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

##### HMAC-Required in Production
```yaml
trigger_tests_hmac:
  stage: test
  script:
    - |
      TIMESTAMP=$(date +%s)
      BODY="{\"commit\": \"${CI_COMMIT_SHA}\"}"
      
      # Generate HMAC-SHA256 signature
      SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${APIWEAVE_HMAC_SECRET}" | awk '{print $2}')
      
      curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
        -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
        -H "X-Webhook-Signature: ${SIGNATURE}" \
        -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
        -H "Content-Type: application/json" \
        -d "${BODY}"
```

#### Blocking Poll-and-Fail Snippet

##### Token-Only Minimal (development only)
```yaml
run_tests_blocking:
  stage: test
  script:
    - |
      RESPONSE=$(curl -s -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
        -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"commit\": \"${CI_COMMIT_SHA}\"}")
      
      RUN_ID=$(echo "$RESPONSE" | jq -r '.runId')
      if [ "$RUN_ID" = "null" ] || [ -z "$RUN_ID" ]; then
        echo "Failed to trigger workflow run: $RESPONSE"
        exit 1
      fi
      
      echo "Triggered run: $RUN_ID"
      
      for i in {1..60}; do
        STATUS_RESP=$(curl -s "${APIWEAVE_BASE_URL}/api/runs/$RUN_ID")
        STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
        echo "Current status: $STATUS"
        
        if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
          echo "Workflow run completed successfully."
          exit 0
        elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
          echo "Workflow run failed."
          exit 1
        fi
        sleep 5
      done
      
      echo "Polling timed out after 5 minutes."
      exit 1
```

##### HMAC-Required in Production
```yaml
run_tests_blocking_hmac:
  stage: test
  script:
    - |
      TIMESTAMP=$(date +%s)
      BODY="{\"commit\": \"${CI_COMMIT_SHA}\"}"
      
      SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${APIWEAVE_HMAC_SECRET}" | awk '{print $2}')
      
      RESPONSE=$(curl -s -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
        -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
        -H "X-Webhook-Signature: ${SIGNATURE}" \
        -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
        -H "Content-Type: application/json" \
        -d "${BODY}")
      
      RUN_ID=$(echo "$RESPONSE" | jq -r '.runId')
      if [ "$RUN_ID" = "null" ] || [ -z "$RUN_ID" ]; then
        echo "Failed to trigger workflow run: $RESPONSE"
        exit 1
      fi
      
      echo "Triggered run: $RUN_ID"
      
      for i in {1..60}; do
        STATUS_RESP=$(curl -s "${APIWEAVE_BASE_URL}/api/runs/$RUN_ID")
        STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
        echo "Current status: $STATUS"
        
        if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
          echo "Workflow run completed successfully."
          exit 0
        elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
          echo "Workflow run failed."
          exit 1
        fi
        sleep 5
      done
      
      echo "Polling timed out after 5 minutes."
      exit 1
```

### Jenkins

#### Credentials Setup
Store your credentials in the Jenkins Credentials Provider as **Secret text**:
- `apiweave-base-url`: The base URL of your APIWeave instance.
- `apiweave-token`: The secret token for the webhook.
- `apiweave-hmac-secret`: The secret key for HMAC signing.

Jenkins automatically masks these variables in the console output when bound using `withCredentials`.

#### Fire-and-Forget Snippet

##### Token-Only Minimal (development only)
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

##### HMAC-Required in Production
```groovy
pipeline {
    agent any
    stages {
        stage('Trigger APIWeave (HMAC)') {
            steps {
                withCredentials([
                    string(credentialsId: 'apiweave-base-url', variable: 'APIWEAVE_BASE_URL'),
                    string(credentialsId: 'apiweave-token', variable: 'APIWEAVE_WEBHOOK_TOKEN'),
                    string(credentialsId: 'apiweave-hmac-secret', variable: 'APIWEAVE_HMAC_SECRET')
                ]) {
                    sh '''
                        TIMESTAMP=$(date +%s)
                        BODY='{"build": "'${BUILD_NUMBER}'"}'
                        
                        # Generate HMAC-SHA256 signature
                        SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${APIWEAVE_HMAC_SECRET}" | awk '{print $2}')
                        
                        curl -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
                          -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
                          -H "X-Webhook-Signature: ${SIGNATURE}" \
                          -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
                          -H "Content-Type: application/json" \
                          -d "${BODY}"
                    '''
                }
            }
        }
    }
}
```

#### Blocking Poll-and-Fail Snippet

##### Token-Only Minimal (development only)
```groovy
pipeline {
    agent any
    stages {
        stage('Run APIWeave and Wait') {
            steps {
                withCredentials([
                    string(credentialsId: 'apiweave-base-url', variable: 'APIWEAVE_BASE_URL'),
                    string(credentialsId: 'apiweave-token', variable: 'APIWEAVE_WEBHOOK_TOKEN')
                ]) {
                    sh '''
                        RESPONSE=$(curl -s -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
                          -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
                          -H "Content-Type: application/json" \
                          -d '{"build": "'${BUILD_NUMBER}'"}')
                        
                        RUN_ID=$(echo "$RESPONSE" | jq -r '.runId')
                        if [ "$RUN_ID" = "null" ] || [ -z "$RUN_ID" ]; then
                          echo "Failed to trigger workflow run: $RESPONSE"
                          exit 1
                        fi
                        
                        echo "Triggered run: $RUN_ID"
                        
                        for i in {1..60}; do
                          STATUS_RESP=$(curl -s "${APIWEAVE_BASE_URL}/api/runs/$RUN_ID")
                          STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
                          echo "Current status: $STATUS"
                          
                          if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
                            echo "Workflow run completed successfully."
                            exit 0
                          elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
                            echo "Workflow run failed."
                            exit 1
                          fi
                          sleep 5
                        done
                        
                        echo "Polling timed out after 5 minutes."
                        exit 1
                    '''
                }
            }
        }
    }
}
```

##### HMAC-Required in Production
```groovy
pipeline {
    agent any
    stages {
        stage('Run APIWeave and Wait (HMAC)') {
            steps {
                withCredentials([
                    string(credentialsId: 'apiweave-base-url', variable: 'APIWEAVE_BASE_URL'),
                    string(credentialsId: 'apiweave-token', variable: 'APIWEAVE_WEBHOOK_TOKEN'),
                    string(credentialsId: 'apiweave-hmac-secret', variable: 'APIWEAVE_HMAC_SECRET')
                ]) {
                    sh '''
                        TIMESTAMP=$(date +%s)
                        BODY='{"build": "'${BUILD_NUMBER}'"}'
                        
                        SIGNATURE=$(echo -n "${TIMESTAMP}${BODY}" | openssl dgst -sha256 -hmac "${APIWEAVE_HMAC_SECRET}" | awk '{print $2}')
                        
                        RESPONSE=$(curl -s -X POST "${APIWEAVE_BASE_URL}/api/webhooks/<WEBHOOK_ID>/execute" \
                          -H "X-Webhook-Token: ${APIWEAVE_WEBHOOK_TOKEN}" \
                          -H "X-Webhook-Signature: ${SIGNATURE}" \
                          -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
                          -H "Content-Type: application/json" \
                          -d "${BODY}")
                        
                        RUN_ID=$(echo "$RESPONSE" | jq -r '.runId')
                        if [ "$RUN_ID" = "null" ] || [ -z "$RUN_ID" ]; then
                          echo "Failed to trigger workflow run: $RESPONSE"
                          exit 1
                        fi
                        
                        echo "Triggered run: $RUN_ID"
                        
                        for i in {1..60}; do
                          STATUS_RESP=$(curl -s "${APIWEAVE_BASE_URL}/api/runs/$RUN_ID")
                          STATUS=$(echo "$STATUS_RESP" | jq -r '.status')
                          echo "Current status: $STATUS"
                          
                          if [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
                            echo "Workflow run completed successfully."
                            exit 0
                          elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "error" ]; then
                            echo "Workflow run failed."
                            exit 1
                          fi
                          sleep 5
                        done
                        
                        echo "Polling timed out after 5 minutes."
                        exit 1
                    '''
                }
            }
        }
    }
}
```

## Manage Existing Webhooks

From the Webhooks list you can:

- enable/disable webhook
- view execution logs
- regenerate credentials
- delete webhook

Regeneration invalidates old credentials immediately.

Management actions require an authenticated APIWeave user session with the matching `webhooks:*` permission. External webhook execution still uses `X-Webhook-Token` plus HMAC headers; CI/CD systems do not use browser sessions.

## HMAC Authentication Migration (F9)

If you previously created webhooks without HMAC, they will continue to work in local/dev. In production (APP_ENV=production), you'll see a WARNING log for each unauthenticated request. To enable HMAC on an existing webhook:

1. Open the webhook in the APIWeave UI
2. Click "Regenerate Token & HMAC Secret" 
3. Update your CI/CD pipeline to include the new headers:
   - `X-Webhook-Token: <token>`
   - `X-Webhook-Timestamp: <unix-timestamp>`
   - `X-Webhook-Signature: HMAC-SHA256(hmac_secret, timestamp + body)`

Or set `WEBHOOK_REQUIRE_HMAC=false` in your environment to suppress the warning (not recommended for production).

## Common Setup Pattern

1. Create environment for your target stage.
2. Create workflow webhook bound to that environment.
3. Store token/secret in CI/CD secrets manager.
4. Trigger webhook from deployment pipeline.

## Troubleshooting

## 401 Invalid or missing token

- Ensure `X-Webhook-Token` is present.
- Confirm token is current (old tokens fail after regeneration).

## 401 Missing X-Webhook-Signature header

- Production instances require HMAC when `WEBHOOK_REQUIRE_HMAC=true`.
- Send both `X-Webhook-Signature` and `X-Webhook-Timestamp` with the webhook token.

## 403 Webhook disabled

- Enable webhook from Webhooks page.

## 404 Webhook not found

- Verify URL path and webhook ID.
- Ensure webhook was not deleted.

## Invalid JSON payload

- Send valid JSON body with `Content-Type: application/json`.

## No run appears

- Check webhook logs in UI.
- Confirm target workflow still exists.
- Check backend logs for runtime errors.
