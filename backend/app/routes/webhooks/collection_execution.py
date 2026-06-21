"""
Webhook collection execution endpoint: trigger collections via incoming webhook calls.
"""

import hmac
import json
import logging
import uuid
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.idempotency import (
    get_idempotency_entry,
)
from app.middleware.rate_limiter import check_webhook_rate_limit, get_rate_limit_headers
from app.middleware.webhook_auth import (
    resolve_webhook_actor,
)
from app.models import (
    WebhookLog,
)
from app.repositories import (
    CollectionRepository,
    WebhookRepository,
)
from app.routes.webhooks import validation
from app.routes.webhooks._router import router
from app.services import audit_service
from app.services.environment_protection_service import (
    BypassNotAllowedError,
    bypass_protection,
    check_protection_and_maybe_gate,
)
from app.services.webhook_runner import QueueFull, WebhookDelivery, webhook_runner

logger = logging.getLogger(__name__)


@router.post("/collections/{webhook_id}/execute", status_code=202)
async def execute_collection_webhook(
    webhook_id: str,
    request: Request,
    _rate_limit: int = Depends(check_webhook_rate_limit),
    x_webhook_token: str | None = Header(None),
    x_webhook_signature: str | None = Header(None),
    x_webhook_timestamp: str | None = Header(None),
    idempotency_key: str | None = Header(None),
):
    """
    Execute a collection (test suite) triggered by webhook.

    - `X-Webhook-Token` is always required.
    - `X-Webhook-Signature` + `X-Webhook-Timestamp` are required when WEBHOOK_REQUIRE_HMAC=true.
    - `Idempotency-Key` is optional; duplicate keys return the original run without re-executing.

    Returns 202 Accepted with collection run ID and poll URL.
    """
    # ── 1. Fetch webhook ──────────────────────────────────────────────────────
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=404,
            errorMessage="Webhook not found",
        ).insert()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook not found")

    # ── 2. Token check ────────────────────────────────────────────────────────
    if not x_webhook_token or not hmac.compare_digest(x_webhook_token or "", webhook.token):
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=401,
            errorMessage="Invalid or missing webhook token",
        ).insert()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing webhook token",
        )

    # ── 3. Enabled check ─────────────────────────────────────────────────────
    if not webhook.enabled:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=403,
            errorMessage="Webhook is disabled",
        ).insert()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook is disabled")

    # ── 4. Read body ──────────────────────────────────────────────────────────
    body = await request.body()

    # ── 4b. Enforce body size limit ────────────────────────────────────────────
    if len(body) > settings.MAX_WEBHOOK_BODY_SIZE:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=413,
            errorMessage=(
                f"Request body too large: {len(body)} bytes (max: {settings.MAX_WEBHOOK_BODY_SIZE})"
            ),
        ).insert()
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Request body too large. Max size: {settings.MAX_WEBHOOK_BODY_SIZE} bytes",
        )

    # ── 5. HMAC / replay protection ───────────────────────────────────────────
    await validation._require_hmac_when_configured(
        webhook_id, x_webhook_signature, x_webhook_timestamp, body
    )

    # ── 6. Idempotency check ──────────────────────────────────────────────────
    if idempotency_key:
        cached = await get_idempotency_entry(webhook_id, idempotency_key)
        if cached is not None:
            rl_headers = get_rate_limit_headers(webhook_id, remaining=_rate_limit)
            return JSONResponse(
                status_code=202,
                content=cached.response_body,
                headers={**rl_headers, "Idempotency-Replayed": "true"},
            )

    # ── 7. Parse payload ──────────────────────────────────────────────────────
    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=400,
            errorMessage="Invalid JSON payload",
        ).insert()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON payload")

    # ── 8. Fetch collection ───────────────────────────────────────────────────
    collection = await CollectionRepository.get_by_id(webhook.resourceId)
    if not collection:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=404,
            errorMessage="Collection not found",
        ).insert()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    # ── 8b. Resolve webhook actor and enforce scope ───────────────────────────
    actor = await resolve_webhook_actor(webhook_id)
    webhook_workspace = getattr(webhook, "workspaceId", None) or getattr(webhook, "scopeId", None)
    collection_workspace = getattr(collection, "workspaceId", None)

    if webhook_workspace and collection_workspace and webhook_workspace != collection_workspace:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=403,
            errorMessage="Webhook scope does not match collection workspace",
        ).insert()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Webhook token scope does not match target workspace",
        )

    # ── 8c. Environment protection bypass check ───────────────────────────────
    bypass_reason: str | None = None
    gate_result, gate_record = await check_protection_and_maybe_gate(
        run_id=f"crun-pending-{webhook_id}",
        environment_id=webhook.environmentId,
        workspace_id=webhook_workspace or "",
        actor_type="webhook_token",
        actor_id=actor.tokenId,
    )
    if gate_result == "pending_approval" and gate_record:
        protection = await validation._get_protection(webhook.environmentId)
        if protection and actor.tokenId in (protection.bypassAllowlist or []):
            try:
                await bypass_protection(
                    approval_id=gate_record.approvalId,
                    token_id=actor.tokenId,
                    reason=f"Webhook {webhook_id} automated bypass",
                )
                bypass_reason = f"Webhook {webhook_id} automated bypass"
            except BypassNotAllowedError:
                pass

    # ── 8d. Audit webhook execution ───────────────────────────────────────────
    try:
        await audit_service.append_event(
            actor="webhook_token",
            actor_id=actor.tokenId,
            action="webhook_executed",
            scope="workspace",
            scope_id=webhook_workspace or "",
            resource_type="webhook",
            resource_id=webhook_id,
            context={
                "resourceType": webhook.resourceType,
                "resourceId": webhook.resourceId,
                "environmentId": webhook.environmentId,
                "bypassReason": bypass_reason,
            },
        )
    except Exception:
        logger.warning("Audit write failed for webhook %s — proceeding", webhook_id)

    # ── 9. Create webhook log (runner updates on completion) ──────────────────
    triggered_at = datetime.now(UTC)
    payload_str = json.dumps(payload)
    log_id = f"log-{uuid.uuid4().hex[:12]}"
    webhook_log = WebhookLog(
        logId=log_id,
        webhookId=webhook_id,
        timestamp=triggered_at,
        status="accepted",
        duration=0,
        httpMethod="POST",
        responseStatus=202,
        requestBody=payload_str if len(payload_str) < 10000 else '{"_truncated": true}',
    )
    await webhook_log.insert()

    # ── 10. Enqueue via WebhookRunner ─────────────────────────────────────────
    delivery = WebhookDelivery(
        webhook_id=webhook_id,
        resource_type="collection",
        resource_id=webhook.resourceId,
        environment_id=webhook.environmentId,
        payload=payload if isinstance(payload, dict) else {},
        idempotency_key=idempotency_key,
        webhook_log_id=log_id,
        actor_type="webhook_token",
        actor_id=actor.tokenId,
        workspace_id=webhook_workspace,
        bypass_reason=bypass_reason,
    )

    try:
        collection_run_id = await webhook_runner.enqueue(delivery)
    except QueueFull as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
            headers={"Retry-After": "30"},
        )

    # ── 11. Build response body ───────────────────────────────────────────────
    response_body = {
        "status": "accepted",
        "collectionRunId": collection_run_id,
        "collectionId": webhook.resourceId,
        "pollUrl": (
            f"{settings.BASE_URL}/api/collections/{webhook.resourceId}/runs/{collection_run_id}"
        ),
    }

    # ── 12. Return 202 with rate-limit headers ────────────────────────────────
    rl_headers = get_rate_limit_headers(webhook_id, remaining=_rate_limit)
    return JSONResponse(status_code=202, content=response_body, headers=rl_headers)
