"""Tests for the rate limiter backend configuration flag.

The RATE_LIMITER_BACKEND setting selects which storage backend the webhook
rate limiter uses. The in-memory backend is the only currently implemented
option and must remain the default so single-process deployments work
out of the box.
"""

from app.config import Settings


def _base_settings_kwargs() -> dict[str, str]:
    return {
        "BASE_URL": "http://localhost:8000",
        "MONGODB_URL": "mongodb://localhost:27017",
        "MONGODB_DB_NAME": "apiweave",
        "ALLOWED_ORIGINS": "http://localhost:3000",
        "SECRET_KEY": "test-secret-key",
        "SESSION_SECRET_KEY": "test-session-secret-key",
    }


def test_rate_limiter_backend_default_is_memory() -> None:
    """Settings.RATE_LIMITER_BACKEND must default to 'memory'."""
    settings = Settings(**_base_settings_kwargs())

    assert settings.RATE_LIMITER_BACKEND == "memory"
