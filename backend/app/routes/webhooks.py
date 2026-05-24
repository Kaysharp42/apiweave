"""
Webhook management API endpoints
Handles CRUD operations for CI/CD webhooks
"""
from fastapi import APIRouter, HTTPException, status, Depends, Header, Request
from fastapi.responses import JSONResponse
from typing import List, Optional
from datetime import datetime, UTC
import secrets
import uuid
import asyncio
import json
import hashlib
import hmac as hmac_lib

from app.models import (
    Webhook,
    WebhookCreate,
    WebhookUpdate,
    WebhookLog,
    RunCreate,
    Run
)
from app.repositories import WebhookRepository, WorkflowRepository, CollectionRepository, RunRepository
from app.config import settings
from app.runner.executor import WorkflowExecutor
from app.database import get_database
from app.middleware.webhook_auth import (
    validate_hmac_signature,
    InvalidSignatureError,
    ReplayAttackError,
)
from app.middleware.rate_limiter import check_webhook_rate_limit, get_rate_limit_headers
from app.idempotency import get_idempotency_entry, store_idempotency_entry


router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _run_workflow_and_update_webhook(
    executor: "WorkflowExecutor",
    webhook_id: str,
    log_doc: "WebhookLog",
    triggered_at: datetime,
) -> None:
    terminal_status = "failure"
    run_id: Optional[str] = executor.run_id
    error_message: Optional[str] = None

    try:
        await executor.execute()

        if executor.has_failures:
            terminal_status = "failure"
            error_message = executor.first_error_message
        else:
            terminal_status = "success"

    except Exception as exc:  # noqa: BLE001
        terminal_status = "failure"
        error_message = str(exc)

    finally:
        duration_ms = int(
            (datetime.now(UTC) - triggered_at).total_seconds() * 1000
        )

        try:
            await WebhookRepository.update_usage(webhook_id, terminal_status)
        except Exception:  # noqa: BLE001
            pass

        try:
            log_doc = await WebhookLog.find_one(WebhookLog.logId == log_id)
            if log_doc:
                log_doc.status = terminal_status  # type: ignore[assignment]
                log_doc.duration = duration_ms
                log_doc.runId = run_id
                if error_message:
                    log_doc.errorMessage = error_message
                await log_doc.save()
        except Exception:  # noqa: BLE001
            pass

        try:
            log_doc.status = terminal_status  # type: ignore[assignment]
            log_doc.duration = duration_ms
            log_doc.runId = run_id
            if error_message:
                log_doc.errorMessage = error_message
            await log_doc.save()
        except Exception:  # noqa: BLE001
            pass


async def verify_admin_key(authorization: Optional[str] = Header(None)) -> None:
    admin_key = settings.APIWEAVE_ADMIN_KEY
    if not admin_key or not admin_key.strip():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access is not configured"
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin key"
        )

    provided_key = authorization.removeprefix("Bearer ").strip()
    if provided_key != admin_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin key"
        )


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_admin_key)])
async def create_webhook(webhook_data: WebhookCreate):
    """
    Create a new webhook for CI/CD integration
    
    **Important:** Token and HMAC secret are shown ONLY ONCE!
    Save them immediately - they cannot be retrieved later.
    
    Args:
        webhook_data: Webhook creation data
        
    Returns:
        Webhook details with token and hmacSecret (shown only once!)
    """
    # Verify resource exists
    if webhook_data.resourceType == "workflow":
        resource = await WorkflowRepository.get_by_id(webhook_data.resourceId)
        if not resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workflow not found: {webhook_data.resourceId}"
            )
    else:  # collection
        resource = await CollectionRepository.get_by_id(webhook_data.resourceId)
        if not resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection not found: {webhook_data.resourceId}"
            )
    
    # Generate webhook ID, token, and HMAC secret
    webhook_id = f"wh-{uuid.uuid4().hex[:12]}"
    token = f"secret_{secrets.token_urlsafe(32)}"
    hmac_secret = f"hmac_{secrets.token_urlsafe(32)}"
    
    # Create webhook
    webhook = await WebhookRepository.create({
        "webhookId": webhook_id,
        "resourceType": webhook_data.resourceType,
        "resourceId": webhook_data.resourceId,
        "environmentId": webhook_data.environmentId,
        "token": token,
        "hmacSecret": hmac_secret,
        "enabled": True,
        "description": webhook_data.description,
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
        "usageCount": 0
    })
    
    # Build webhook URL
    webhook_url = f"{settings.BASE_URL}/api/webhooks/{webhook_data.resourceType}s/{webhook_id}/execute"
    
    # Return webhook details with credentials (SHOWN ONLY ONCE!)
    return {
        "webhookId": webhook.webhookId,
        "url": webhook_url,
        "token": token,  # ⚠️ SHOWN ONLY ONCE!
        "hmacSecret": hmac_secret,  # ⚠️ SHOWN ONLY ONCE!
        "resourceType": webhook.resourceType,
        "resourceId": webhook.resourceId,
        "environmentId": webhook.environmentId,
        "enabled": webhook.enabled,
        "description": webhook.description,
        "createdAt": webhook.createdAt.isoformat(),
        "warning": "⚠️ Save these credentials now! They won't be shown again."
    }


@router.get("/workflows/{workflow_id}", response_model=List[dict], dependencies=[Depends(verify_admin_key)])
async def list_workflow_webhooks(workflow_id: str):
    """
    List all webhooks for a specific workflow
    
    Note: Token and hmacSecret are never returned after creation
    
    Args:
        workflow_id: The workflow ID
        
    Returns:
        List of webhooks (without sensitive credentials)
    """
    webhooks = await WebhookRepository.get_by_resource("workflow", workflow_id)
    
    return [
        {
            "webhookId": wh.webhookId,
            "url": f"{settings.BASE_URL}/api/webhooks/workflows/{wh.webhookId}/execute",
            "resourceType": wh.resourceType,
            "resourceId": wh.resourceId,
            "environmentId": wh.environmentId,
            "enabled": wh.enabled,
            "description": wh.description,
            "createdAt": wh.createdAt.isoformat() if wh.createdAt else None,
            "lastUsed": wh.lastUsed.isoformat() if wh.lastUsed else None,
            "usageCount": wh.usageCount,
            "lastStatus": wh.lastStatus
        }
        for wh in webhooks
    ]


@router.get("/collections/{collection_id}", response_model=List[dict], dependencies=[Depends(verify_admin_key)])
async def list_collection_webhooks(collection_id: str):
    """
    List all webhooks for a specific collection
    
    Note: Token and hmacSecret are never returned after creation
    
    Args:
        collection_id: The collection ID
        
    Returns:
        List of webhooks (without sensitive credentials)
    """
    webhooks = await WebhookRepository.get_by_resource("collection", collection_id)
    
    return [
        {
            "webhookId": wh.webhookId,
            "url": f"{settings.BASE_URL}/api/webhooks/collections/{wh.webhookId}/execute",
            "resourceType": wh.resourceType,
            "resourceId": wh.resourceId,
            "environmentId": wh.environmentId,
            "enabled": wh.enabled,
            "description": wh.description,
            "createdAt": wh.createdAt.isoformat() if wh.createdAt else None,
            "lastUsed": wh.lastUsed.isoformat() if wh.lastUsed else None,
            "usageCount": wh.usageCount,
            "lastStatus": wh.lastStatus
        }
        for wh in webhooks
    ]


@router.get("/{webhook_id}", response_model=dict, dependencies=[Depends(verify_admin_key)])
async def get_webhook(webhook_id: str):
    """
    Get webhook details by ID
    
    Note: Token and hmacSecret are never returned after creation
    
    Args:
        webhook_id: The webhook ID
        
    Returns:
        Webhook details (without sensitive credentials)
    """
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    resource_type_path = "workflows" if webhook.resourceType == "workflow" else "collections"
    
    return {
        "webhookId": webhook.webhookId,
        "url": f"{settings.BASE_URL}/api/webhooks/{resource_type_path}/{webhook.webhookId}/execute",
        "resourceType": webhook.resourceType,
        "resourceId": webhook.resourceId,
        "environmentId": webhook.environmentId,
        "enabled": webhook.enabled,
        "description": webhook.description,
        "createdAt": webhook.createdAt.isoformat() if webhook.createdAt else None,
        "updatedAt": webhook.updatedAt.isoformat() if webhook.updatedAt else None,
        "lastUsed": webhook.lastUsed.isoformat() if webhook.lastUsed else None,
        "usageCount": webhook.usageCount,
        "lastStatus": webhook.lastStatus
    }


@router.patch("/{webhook_id}", response_model=dict, dependencies=[Depends(verify_admin_key)])
async def update_webhook(webhook_id: str, webhook_data: WebhookUpdate):
    """
    Update webhook configuration
    
    Can update: environmentId, enabled status, description
    Cannot update: token, hmacSecret (use regenerate endpoint)
    
    Args:
        webhook_id: The webhook ID
        webhook_data: Update data
        
    Returns:
        Updated webhook details
    """
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    # Build update dictionary (only non-None values)
    update_data = {}
    if webhook_data.environmentId is not None:
        update_data["environmentId"] = webhook_data.environmentId
    if webhook_data.enabled is not None:
        update_data["enabled"] = webhook_data.enabled
    if webhook_data.description is not None:
        update_data["description"] = webhook_data.description
    
    # Update webhook
    updated_webhook = await WebhookRepository.update(webhook_id, update_data)
    if not updated_webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    resource_type_path = "workflows" if updated_webhook.resourceType == "workflow" else "collections"
    
    return {
        "webhookId": updated_webhook.webhookId,
        "url": f"{settings.BASE_URL}/api/webhooks/{resource_type_path}/{updated_webhook.webhookId}/execute",
        "resourceType": updated_webhook.resourceType,
        "resourceId": updated_webhook.resourceId,
        "environmentId": updated_webhook.environmentId,
        "enabled": updated_webhook.enabled,
        "description": updated_webhook.description,
        "updatedAt": updated_webhook.updatedAt.isoformat()
    }


@router.post("/{webhook_id}/regenerate-token", response_model=dict, dependencies=[Depends(verify_admin_key)])
async def regenerate_webhook_token(webhook_id: str):
    """
    Regenerate webhook token and HMAC secret
    
    **Warning:** This invalidates the old token immediately!
    Update your CI/CD configuration before regenerating.
    
    **Important:** New credentials are shown ONLY ONCE!
    
    Args:
        webhook_id: The webhook ID
        
    Returns:
        New token and hmacSecret (shown only once!)
    """
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    # Generate new token and HMAC secret
    new_token = f"secret_{secrets.token_urlsafe(32)}"
    new_hmac_secret = f"hmac_{secrets.token_urlsafe(32)}"
    
    # Update webhook
    updated_webhook = await WebhookRepository.update(webhook_id, {
        "token": new_token,
        "hmacSecret": new_hmac_secret
    })
    if not updated_webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    resource_type_path = "workflows" if updated_webhook.resourceType == "workflow" else "collections"
    
    return {
        "webhookId": updated_webhook.webhookId,
        "url": f"{settings.BASE_URL}/api/webhooks/{resource_type_path}/{updated_webhook.webhookId}/execute",
        "token": new_token,  # ⚠️ SHOWN ONLY ONCE!
        "hmacSecret": new_hmac_secret,  # ⚠️ SHOWN ONLY ONCE!
        "updatedAt": updated_webhook.updatedAt.isoformat(),
        "warning": "⚠️ Old token is now invalid! Update your CI/CD configuration immediately."
    }


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_admin_key)])
async def delete_webhook(webhook_id: str):
    """
    Delete a webhook
    
    This will immediately invalidate the webhook URL.
    Any CI/CD pipelines using this webhook will fail.
    
    Args:
        webhook_id: The webhook ID
        
    Returns:
        No content (204)
    """
    deleted = await WebhookRepository.delete(webhook_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    return None


@router.get("/{webhook_id}/logs", response_model=dict, dependencies=[Depends(verify_admin_key)])
async def get_webhook_logs(
    webhook_id: str,
    limit: int = 50,
    offset: int = 0
):
    """
    Get execution logs for a webhook
    
    Args:
        webhook_id: The webhook ID
        limit: Maximum number of logs to return (default 50, max 100)
        offset: Number of logs to skip for pagination
        
    Returns:
        Paginated webhook logs
    """
    # Verify webhook exists
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Webhook not found: {webhook_id}"
        )
    
    # Limit max to 100
    limit = min(limit, 100)
    
    # Get logs from database
    logs = await WebhookLog.find(
        WebhookLog.webhookId == webhook_id
    ).sort("-timestamp").skip(offset).limit(limit).to_list()
    
    # Count total logs
    total = await WebhookLog.find(
        WebhookLog.webhookId == webhook_id
    ).count()
    
    return {
        "webhookId": webhook_id,
        "total": total,
        "offset": offset,
        "limit": limit,
        "logs": [
            {
                "logId": log.logId,
                "timestamp": log.timestamp.isoformat(),
                "status": log.status,
                "duration": log.duration,
                "responseStatus": log.responseStatus,
                "errorMessage": log.errorMessage,
                "runId": log.runId,
                "collectionRunId": log.collectionRunId,
                "ipAddress": log.ipAddress
            }
            for log in logs
        ]
    }


# ============================================================================
# WEBHOOK EXECUTION ENDPOINTS
# ============================================================================

async def _validate_hmac_or_raise(
    webhook_id: str,
    signature: str,
    timestamp: Optional[str],
    body: bytes,
) -> None:
    """
    Validate HMAC signature + timestamp using the canonical `timestamp + body` scheme.
    Raises HTTPException 401 on any failure.
    """
    if not timestamp:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=401,
            errorMessage="Missing X-Webhook-Timestamp header for signed request",
        ).insert()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Webhook-Timestamp header for signed request",
        )

    try:
        await validate_hmac_signature(webhook_id, signature, timestamp, body)
    except ReplayAttackError as exc:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=401,
            errorMessage=str(exc),
        ).insert()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Replay attack detected: {exc}",
        )
    except InvalidSignatureError as exc:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=401,
            errorMessage=str(exc),
        ).insert()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )


@router.post("/workflows/{webhook_id}/execute", status_code=202)
async def execute_workflow_webhook(
    webhook_id: str,
    request: Request,
    _rate_limit: None = Depends(check_webhook_rate_limit),
    x_webhook_token: Optional[str] = Header(None),
    x_webhook_signature: Optional[str] = Header(None),
    x_webhook_timestamp: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None),
):
    """
    Execute a workflow triggered by webhook.

    - `X-Webhook-Token` is always required.
    - `X-Webhook-Signature` + `X-Webhook-Timestamp` are optional (HMAC replay protection).
    - `Idempotency-Key` is optional; duplicate keys return the original run without re-executing.

    Returns 202 Accepted with run ID and poll URL.
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

    # ── 2. Token check (always required) ─────────────────────────────────────
    if not x_webhook_token or x_webhook_token != webhook.token:
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

    # ── 5. HMAC / replay protection (only when signature header is present) ───
    if x_webhook_signature:
        await _validate_hmac_or_raise(webhook_id, x_webhook_signature, x_webhook_timestamp, body)

    # ── 6. Idempotency check ──────────────────────────────────────────────────
    if idempotency_key:
        cached = get_idempotency_entry(webhook_id, idempotency_key)
        if cached is not None:
            rl_headers = get_rate_limit_headers(webhook_id)
            return JSONResponse(
                status_code=200,
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

    # ── 8. Fetch workflow ─────────────────────────────────────────────────────
    workflow = await WorkflowRepository.get_by_id(webhook.resourceId)
    if not workflow:
        await WebhookLog(
            logId=f"log-{uuid.uuid4().hex[:12]}",
            webhookId=webhook_id,
            timestamp=datetime.now(UTC),
            status="validation_error",
            duration=0,
            httpMethod="POST",
            responseStatus=404,
            errorMessage="Workflow not found",
        ).insert()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")

    # ── 9. Create run ─────────────────────────────────────────────────────────
    from app.models import Run
    run = Run(
        runId=f"run-{uuid.uuid4().hex[:12]}",
        workflowId=webhook.resourceId,
        environmentId=webhook.environmentId,  # CRITICAL: Pass environment from webhook
        status="pending",
        trigger="webhook",
        variables=payload if isinstance(payload, dict) else {},
        results=[],
        createdAt=datetime.now(UTC),
    )
    await run.insert()

    # ── 10. Build response body ───────────────────────────────────────────────
    response_body = {
        "status": "accepted",
        "runId": run.runId,
        "workflowId": webhook.resourceId,
        "pollUrl": f"{settings.BASE_URL}/api/runs/{run.runId}",
        "resultsUrl": f"{settings.BASE_URL}/api/runs/{run.runId}/results",
    }

    # ── 11. Store idempotency entry ───────────────────────────────────────────
    if idempotency_key:
        store_idempotency_entry(
            webhook_id=webhook_id,
            idempotency_key=idempotency_key,
            run_id=run.runId,
            collection_run_id=None,
            status_code=202,
            response_body=response_body,
        )

    # ── 12. Log success ───────────────────────────────────────────────────────
    triggered_at = datetime.now(UTC)
    log_id = f"log-{uuid.uuid4().hex[:12]}"
    payload_str = json.dumps(payload)
    await WebhookLog(
        logId=log_id,
        webhookId=webhook_id,
        timestamp=triggered_at,
        status="success",
        duration=0,
        httpMethod="POST",
        responseStatus=202,
        runId=run.runId,
        requestBody=payload_str if len(payload_str) < 10000 else '{"_truncated": true}',
    ).insert()

    # ── 13. Fire background execution ─────────────────────────────────────────
    executor = WorkflowExecutor(run.runId, webhook.resourceId)
    asyncio.create_task(
        _run_workflow_and_update_webhook(executor, webhook_id, log_id, triggered_at)
    )

    # ── 14. Update usage stats ────────────────────────────────────────────────
    webhook.usageCount = (webhook.usageCount or 0) + 1
    webhook.lastUsed = datetime.now(UTC)
    await WebhookRepository.update(webhook_id, {
        "usageCount": webhook.usageCount,
        "lastUsed": webhook.lastUsed,
    })

    # ── 15. Return 202 with rate-limit headers ────────────────────────────────
    rl_headers = get_rate_limit_headers(webhook_id)
    return JSONResponse(status_code=202, content=response_body, headers=rl_headers)


@router.post("/collections/{webhook_id}/execute", status_code=202)
async def execute_collection_webhook(
    webhook_id: str,
    request: Request,
    _rate_limit: None = Depends(check_webhook_rate_limit),
    x_webhook_token: Optional[str] = Header(None),
    x_webhook_signature: Optional[str] = Header(None),
    x_webhook_timestamp: Optional[str] = Header(None),
    idempotency_key: Optional[str] = Header(None),
):
    """
    Execute a collection (test suite) triggered by webhook.

    - `X-Webhook-Token` is always required.
    - `X-Webhook-Signature` + `X-Webhook-Timestamp` are optional (HMAC replay protection).
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
    if not x_webhook_token or x_webhook_token != webhook.token:
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

    # ── 5. HMAC / replay protection ───────────────────────────────────────────
    if x_webhook_signature:
        await _validate_hmac_or_raise(webhook_id, x_webhook_signature, x_webhook_timestamp, body)

    # ── 6. Idempotency check ──────────────────────────────────────────────────
    if idempotency_key:
        cached = get_idempotency_entry(webhook_id, idempotency_key)
        if cached is not None:
            rl_headers = get_rate_limit_headers(webhook_id)
            return JSONResponse(
                status_code=200,
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

    # ── 9. Create placeholder collection run ──────────────────────────────────
    # TODO: Implement full collection execution
    collection_run_id = f"crun-{uuid.uuid4().hex[:12]}"

    # ── 10. Build response body ───────────────────────────────────────────────
    response_body = {
        "status": "accepted",
        "collectionRunId": collection_run_id,
        "collectionId": webhook.resourceId,
        "message": "Collection execution not yet implemented",
    }

    # ── 11. Store idempotency entry ───────────────────────────────────────────
    if idempotency_key:
        store_idempotency_entry(
            webhook_id=webhook_id,
            idempotency_key=idempotency_key,
            run_id=collection_run_id,
            collection_run_id=collection_run_id,
            status_code=202,
            response_body=response_body,
        )

    # ── 12. Log success ───────────────────────────────────────────────────────
    payload_str = json.dumps(payload)
    await WebhookLog(
        logId=f"log-{uuid.uuid4().hex[:12]}",
        webhookId=webhook_id,
        timestamp=datetime.now(UTC),
        status="success",
        duration=0,
        httpMethod="POST",
        responseStatus=202,
        requestBody=payload_str if len(payload_str) < 10000 else '{"_truncated": true}',
    ).insert()

    # ── 13. Update usage stats ────────────────────────────────────────────────
    webhook.usageCount = (webhook.usageCount or 0) + 1
    webhook.lastUsed = datetime.now(UTC)
    await WebhookRepository.update(webhook_id, {
        "usageCount": webhook.usageCount,
        "lastUsed": webhook.lastUsed,
    })

    # ── 14. Return 202 with rate-limit headers ────────────────────────────────
    rl_headers = get_rate_limit_headers(webhook_id)
    return JSONResponse(status_code=202, content=response_body, headers=rl_headers)
