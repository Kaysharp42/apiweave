"""
Webhook validation helpers: HMAC signature verification, environment protection lookup.
"""

import logging
import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status

from app.config import settings
from app.middleware.webhook_auth import (
    InvalidSignatureError,
    ReplayAttackError,
    validate_hmac_signature,
)
from app.models import WebhookLog

logger = logging.getLogger(__name__)


async def _get_protection(environment_id: str):
    """Fetch environment protection config, returning None if not found."""
    from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository

    return await ScopedEnvironmentRepository.get_protection(environment_id)


async def _validate_hmac_or_raise(
    webhook_id: str,
    signature: str,
    timestamp: str | None,
    body: bytes,
):
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
        logger.warning(f"Replay attack details: {exc}")
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
            detail="Replay attack detected",
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


async def _require_hmac_when_configured(
    webhook_id: str,
    signature: str | None,
    timestamp: str | None,
    body: bytes,
):
    if signature:
        await _validate_hmac_or_raise(webhook_id, signature, timestamp, body)
        return

    if not settings.WEBHOOK_REQUIRE_HMAC:
        if settings.APP_ENV.lower() in {"production", "prod"}:
            logger.warning(
                "PRODUCTION WARNING: Webhook %s called without HMAC signature. "
                "WEBHOOK_REQUIRE_HMAC=false is insecure for production.",
                webhook_id,
            )
        return

    await WebhookLog(
        logId=f"log-{uuid.uuid4().hex[:12]}",
        webhookId=webhook_id,
        timestamp=datetime.now(UTC),
        status="validation_error",
        duration=0,
        httpMethod="POST",
        responseStatus=401,
        errorMessage="Missing X-Webhook-Signature header",
    ).insert()
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing X-Webhook-Signature header",
    )
