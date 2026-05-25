import pytest
from pydantic import ValidationError

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


def test_provider_missing_secret_is_invalid_in_prod() -> None:
    with pytest.raises(ValidationError) as exc_info:
        Settings(
            **_base_settings_kwargs(),
            APP_ENV="production",
            SETUP_MODE_ENABLED=False,
            GOOGLE_CLIENT_ID="google-client-id",
        )

    assert "GOOGLE_CLIENT_SECRET" in str(exc_info.value)


def test_dev_cookie_security_overrides_are_explicit() -> None:
    settings = Settings(**_base_settings_kwargs(), APP_ENV="development")

    assert settings.get_session_cookie_secure() is False
    assert settings.get_session_cookie_samesite() == "lax"


def test_session_timeout_defaults_are_balanced() -> None:
    settings = Settings(**_base_settings_kwargs())

    assert settings.SESSION_MAX_IDLE_MINUTES == 720
    assert settings.SESSION_MAX_ABSOLUTE_MINUTES == 10080


def test_setup_mode_enabled_by_default() -> None:
    settings = Settings(**_base_settings_kwargs())

    assert settings.SETUP_MODE_ENABLED is True


def test_approved_domains_list_parser() -> None:
    settings = Settings(**_base_settings_kwargs(), APPROVED_DOMAINS="foo.com,bar.com")

    assert settings.get_approved_domains_list() == ["foo.com", "bar.com"]
