import base64

import pytest
from pydantic import ValidationError

from app.config import Settings


def _base_settings_kwargs(**overrides: str) -> dict[str, str]:
    kwargs: dict[str, str] = {
        "BASE_URL": "http://localhost:8000",
        "MONGODB_URL": "mongodb://localhost:27017",
        "MONGODB_DB_NAME": "apiweave",
        "ALLOWED_ORIGINS": "http://localhost:3000",
        "SECRET_KEY": "test-secret-key",
        "SESSION_SECRET_KEY": "test-session-secret-key",
        "SECRET_ENCRYPTION_KEY": base64.urlsafe_b64encode(b"\x00" * 32).decode("ascii"),
    }
    kwargs.update(overrides)
    return kwargs


def test_local_dev_loads() -> None:
    """All security defaults work in APP_ENV=development without errors."""
    settings = Settings(**_base_settings_kwargs(), APP_ENV="development")

    assert settings.BLOCK_PRIVATE_NETWORKS is True
    assert settings.MAX_WEBHOOK_BODY_SIZE == 65536
    assert settings.UPLOADS_BASE_DIR == "uploads"
    assert settings.RATE_LIMITER_BACKEND == "memory"


def test_production_wildcard_origins_rejected() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            **_base_settings_kwargs(
                ALLOWED_ORIGINS="*",
            ),
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
        )

    assert "ALLOWED_ORIGINS=* is not allowed in production" in str(exc_info.value)


def test_production_hmac_required() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            **_base_settings_kwargs(),
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            WEBHOOK_REQUIRE_HMAC=False,
        )

    assert "WEBHOOK_REQUIRE_HMAC must be True in production" in str(exc_info.value)


def test_production_block_private_required() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            **_base_settings_kwargs(),
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            BLOCK_PRIVATE_NETWORKS=False,
        )

    assert "BLOCK_PRIVATE_NETWORKS must be True in production" in str(exc_info.value)


def test_production_max_webhook_body_size_warns() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            **_base_settings_kwargs(),
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            MAX_WEBHOOK_BODY_SIZE=2_097_152,
        )

    assert "MAX_WEBHOOK_BODY_SIZE must not exceed 1MB" in str(exc_info.value)
