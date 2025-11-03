"""
Middleware package for APIWeave
Provides authentication and rate limiting for webhook endpoints
"""
from app.middleware.webhook_auth import (
    authenticate_webhook_request,
    require_webhook_auth,
    validate_webhook_token,
    validate_hmac_signature,
    generate_hmac_signature,
    WebhookAuthError,
    InvalidTokenError,
    InvalidSignatureError,
    ReplayAttackError
)
from app.middleware.rate_limiter import (
    check_webhook_rate_limit,
    get_rate_limit_headers,
    RateLimiter
)

__all__ = [
    # Authentication
    "authenticate_webhook_request",
    "require_webhook_auth",
    "validate_webhook_token",
    "validate_hmac_signature",
    "generate_hmac_signature",
    "WebhookAuthError",
    "InvalidTokenError",
    "InvalidSignatureError",
    "ReplayAttackError",
    # Rate limiting
    "check_webhook_rate_limit",
    "get_rate_limit_headers",
    "RateLimiter",
]
