"""
Middleware package for APIWeave
Provides authentication and rate limiting for webhook endpoints
"""

from app.middleware.rate_limiter import (
    RateLimiter,
    check_webhook_rate_limit,
    get_rate_limit_headers,
)
from app.middleware.webhook_auth import (
    InvalidSignatureError,
    InvalidTokenError,
    ReplayAttackError,
    WebhookAuthError,
    authenticate_webhook_request,
    generate_hmac_signature,
    require_webhook_auth,
    validate_hmac_signature,
    validate_webhook_token,
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
