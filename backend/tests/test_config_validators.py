import base64
from typing import Any

import pytest
from app.config import Settings
from pydantic import ValidationError


def _base_settings_kwargs(**overrides: Any) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
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


def _build_settings(**overrides: Any) -> Settings:
    """Instantiate Settings ignoring the developer's local .env so tests
    behave the same on every machine. Without ``_env_file=None`` a local
    BLOCK_PRIVATE_NETWORKS=false (or any other override) would silently
    change the test outcome.
    """
    return Settings(**_base_settings_kwargs(**overrides), _env_file=None)


def test_local_dev_loads() -> None:
    """All security defaults work in APP_ENV=development without errors."""
    settings = _build_settings(APP_ENV="development")

    assert settings.BLOCK_PRIVATE_NETWORKS is True
    assert settings.MAX_WEBHOOK_BODY_SIZE == 65536
    assert settings.UPLOADS_BASE_DIR == "uploads"
    assert settings.RATE_LIMITER_BACKEND == "memory"


def test_production_wildcard_origins_rejected() -> None:
    with pytest.raises(ValidationError) as exc_info:
        _build_settings(
            ALLOWED_ORIGINS="*",
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
        )

    assert "ALLOWED_ORIGINS=* is not allowed in production" in str(exc_info.value)


def test_production_hmac_required() -> None:
    with pytest.raises(ValidationError) as exc_info:
        _build_settings(
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            WEBHOOK_REQUIRE_HMAC=False,
        )

    assert "WEBHOOK_REQUIRE_HMAC must be True in production" in str(exc_info.value)


def test_production_block_private_required() -> None:
    with pytest.raises(ValidationError) as exc_info:
        _build_settings(
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            WEBHOOK_REQUIRE_HMAC=True,
            BLOCK_PRIVATE_NETWORKS=False,
        )

    assert "BLOCK_PRIVATE_NETWORKS must be True in production" in str(exc_info.value)


def test_production_max_webhook_body_size_warns() -> None:
    with pytest.raises(ValidationError) as exc_info:
        _build_settings(
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            WEBHOOK_REQUIRE_HMAC=True,
            BLOCK_PRIVATE_NETWORKS=True,
            MAX_WEBHOOK_BODY_SIZE=2_097_152,
        )

    assert "MAX_WEBHOOK_BODY_SIZE must not exceed 1MB" in str(exc_info.value)


def test_mcp_allowed_hosts_derived_includes_every_origin_host() -> None:
    """All origin hostnames are added to the derived Host allowlist, not just loopback."""
    settings = _build_settings(
        MCP_ALLOWED_ORIGINS=(
            "http://localhost:3000,https://app.example.com,http://[::1]:8080"
        ),
    )

    hosts = settings.get_mcp_allowed_hosts_list()

    assert "localhost:*" in hosts
    assert "app.example.com:*" in hosts
    assert "[::1]:*" in hosts
    # Loopback defaults are always merged in even if origins don't list them.
    assert "127.0.0.1:*" in hosts


def test_mcp_allowed_hosts_explicit_override_wins() -> None:
    """When MCP_ALLOWED_HOSTS is set, MCP_ALLOWED_ORIGINS is ignored entirely."""
    settings = _build_settings(
        MCP_ALLOWED_ORIGINS="http://localhost:3000",
        MCP_ALLOWED_HOSTS="api.example.com:443",
    )

    assert settings.get_mcp_allowed_hosts_list() == ["api.example.com:443"]
