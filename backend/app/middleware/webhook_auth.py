"""
Webhook Authentication Middleware
Provides HMAC signature validation and token authentication for webhook endpoints
"""

import hashlib
import hmac
import time

from fastapi import HTTPException, Request, status

from app.repositories.webhook_repository import WebhookRepository


class WebhookAuthError(Exception):
    """Base exception for webhook authentication errors"""

    pass


class InvalidTokenError(WebhookAuthError):
    """Token validation failed"""

    pass


class InvalidSignatureError(WebhookAuthError):
    """HMAC signature validation failed"""

    pass


class ReplayAttackError(WebhookAuthError):
    """Timestamp indicates possible replay attack"""

    pass


async def validate_webhook_token(webhook_id: str, token: str) -> bool:
    """
    Validate webhook token

    Args:
        webhook_id: The webhook ID from URL path
        token: Token from X-Webhook-Token header

    Returns:
        True if valid

    Raises:
        InvalidTokenError: If token is invalid
    """
    webhook = await WebhookRepository.get_by_id(webhook_id)

    if not webhook:
        raise InvalidTokenError(f"Webhook not found: {webhook_id}")

    if not webhook.enabled:
        raise InvalidTokenError(f"Webhook is disabled: {webhook_id}")

    if webhook.token != token:
        raise InvalidTokenError("Invalid webhook token")

    return True


def generate_hmac_signature(secret: str, timestamp: str, body: bytes) -> str:
    """
    Generate HMAC-SHA256 signature

    Signature format: HMAC-SHA256(secret, timestamp + body)

    Args:
        secret: HMAC secret key
        timestamp: Unix timestamp string
        body: Raw request body bytes

    Returns:
        Hex-encoded HMAC signature
    """
    message = timestamp.encode("utf-8") + body
    signature = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return signature


async def validate_hmac_signature(
    webhook_id: str,
    signature: str,
    timestamp: str,
    body: bytes,
    max_age_seconds: int = 300,  # 5 minutes
) -> bool:
    """
    Validate HMAC signature and timestamp

    Prevents replay attacks by checking timestamp freshness.

    Args:
        webhook_id: The webhook ID from URL path
        signature: Signature from X-Webhook-Signature header
        timestamp: Timestamp from X-Webhook-Timestamp header (Unix timestamp)
        body: Raw request body bytes
        max_age_seconds: Maximum age of timestamp (default 5 minutes)

    Returns:
        True if valid

    Raises:
        InvalidSignatureError: If signature is invalid
        ReplayAttackError: If timestamp is too old/new
    """
    # Get webhook to retrieve HMAC secret
    webhook = await WebhookRepository.get_by_id(webhook_id)

    if not webhook:
        raise InvalidSignatureError(f"Webhook not found: {webhook_id}")

    if not webhook.enabled:
        raise InvalidSignatureError(f"Webhook is disabled: {webhook_id}")

    # Validate timestamp to prevent replay attacks
    try:
        request_time = int(timestamp)
    except (ValueError, TypeError):
        raise ReplayAttackError("Invalid timestamp format")

    current_time = int(time.time())
    time_diff = abs(current_time - request_time)

    if time_diff > max_age_seconds:
        raise ReplayAttackError(
            f"Timestamp too old/new. Difference: {time_diff}s (max: {max_age_seconds}s)"
        )

    # Generate expected signature
    expected_signature = generate_hmac_signature(webhook.hmacSecret, timestamp, body)

    # Constant-time comparison to prevent timing attacks
    if not hmac.compare_digest(signature, expected_signature):
        raise InvalidSignatureError("Invalid HMAC signature")

    return True


async def authenticate_webhook_request(
    request: Request, webhook_id: str
) -> tuple[bool, str | None]:
    """
    Authenticate webhook request using token and HMAC signature

    Validates both:
    1. X-Webhook-Token header (webhook token)
    2. X-Webhook-Signature header (HMAC signature with timestamp)

    Args:
        request: FastAPI request object
        webhook_id: Webhook ID from URL path

    Returns:
        Tuple of (success: bool, error_message: Optional[str])

    Example Headers:
        X-Webhook-Token: wht_abc123xyz789...
        X-Webhook-Timestamp: 1699123456
        X-Webhook-Signature: a1b2c3d4e5f6...
    """
    try:
        # Extract headers
        token = request.headers.get("X-Webhook-Token")
        signature = request.headers.get("X-Webhook-Signature")
        timestamp = request.headers.get("X-Webhook-Timestamp")

        # Validate presence of required headers
        if not token:
            return False, "Missing X-Webhook-Token header"

        if not signature:
            return False, "Missing X-Webhook-Signature header"

        if not timestamp:
            return False, "Missing X-Webhook-Timestamp header"

        # Read request body for HMAC validation
        body = await request.body()

        # Validate token
        await validate_webhook_token(webhook_id, token)

        # Validate HMAC signature
        await validate_hmac_signature(webhook_id, signature, timestamp, body)

        return True, None

    except InvalidTokenError as e:
        return False, f"Token validation failed: {str(e)}"

    except InvalidSignatureError as e:
        return False, f"Signature validation failed: {str(e)}"

    except ReplayAttackError as e:
        return False, f"Replay attack detected: {str(e)}"

    except Exception as e:
        return False, f"Authentication error: {str(e)}"


async def require_webhook_auth(request: Request, webhook_id: str):
    """
    FastAPI dependency for webhook authentication

    Raises HTTPException if authentication fails.

    Usage:
        @router.post("/api/webhooks/workflows/{webhook_id}/execute")
        async def execute_workflow_webhook(
            webhook_id: str,
            request: Request,
            _: None = Depends(require_webhook_auth)
        ):
            # Authenticated request
            pass

    Args:
        request: FastAPI request object
        webhook_id: Webhook ID from URL path

    Raises:
        HTTPException: 401 if authentication fails
    """
    success, error_message = await authenticate_webhook_request(request, webhook_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_message,
            headers={"WWW-Authenticate": "Webhook"},
        )
