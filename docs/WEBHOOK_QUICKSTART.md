# Webhook Quick Start

Use webhooks to trigger workflow runs from CI/CD or any external system.

## What You Get

- A webhook URL
- A webhook token (`X-Webhook-Token` header)
- An HMAC secret (`X-Webhook-Signature`, optional hardening)

Important: token and HMAC secret are shown once at creation/regeneration time. Copy them immediately.

## Create a Webhook

1. Open APIWeave and go to `Webhooks` in the sidebar.
2. Click `Create`.
3. Choose resource type:
   - `Workflow` (fully executable)
   - `Collection` (management exists; execution endpoint currently returns a placeholder response)
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

## Optional HMAC Signature

For stronger verification, sign the raw payload with HMAC-SHA256 and send:

- `X-Webhook-Signature: <hex-signature>`

If signature is provided but invalid, request is rejected.

## Manage Existing Webhooks

From the Webhooks list you can:

- enable/disable webhook
- view execution logs
- regenerate credentials
- delete webhook

Regeneration invalidates old credentials immediately.

## Common Setup Pattern

1. Create environment for your target stage.
2. Create workflow webhook bound to that environment.
3. Store token/secret in CI/CD secrets manager.
4. Trigger webhook from deployment pipeline.

## Troubleshooting

## 401 Invalid or missing token

- Ensure `X-Webhook-Token` is present.
- Confirm token is current (old tokens fail after regeneration).

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
