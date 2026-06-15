"""Tests for OAuth provider registry get_enabled_providers() and startup validation."""

from __future__ import annotations

import logging

import pytest

from app.auth.provider_registry import get_enabled_providers
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


def test_get_enabled_providers_all_four_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """When all 4 providers are configured and OAUTH_LOGIN_ENABLED=True, return all 4."""
    settings = Settings(
        **_base_settings_kwargs(),
        OAUTH_LOGIN_ENABLED=True,
        GITHUB_CLIENT_ID="github-id",
        GITHUB_CLIENT_SECRET="github-secret",
        GITLAB_CLIENT_ID="gitlab-id",
        GITLAB_CLIENT_SECRET="gitlab-secret",
        GOOGLE_CLIENT_ID="google-id",
        GOOGLE_CLIENT_SECRET="google-secret",
        MICROSOFT_CLIENT_ID="microsoft-id",
        MICROSOFT_CLIENT_SECRET="microsoft-secret",
    )
    monkeypatch.setattr("app.auth.provider_registry.settings", settings)
    
    result = get_enabled_providers()
    
    assert sorted(result) == ["github", "gitlab", "google", "microsoft"]


def test_get_enabled_providers_none_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """When no providers are configured, return empty list."""
    settings = Settings(
        **_base_settings_kwargs(),
        OAUTH_LOGIN_ENABLED=True,
        GITHUB_CLIENT_ID=None,
        GITHUB_CLIENT_SECRET=None,
        GITLAB_CLIENT_ID=None,
        GITLAB_CLIENT_SECRET=None,
        GOOGLE_CLIENT_ID=None,
        GOOGLE_CLIENT_SECRET=None,
        MICROSOFT_CLIENT_ID=None,
        MICROSOFT_CLIENT_SECRET=None,
    )
    monkeypatch.setattr("app.auth.provider_registry.settings", settings)
    
    result = get_enabled_providers()
    
    assert result == []


def test_get_enabled_providers_only_github_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """When only GitHub is configured, return only github."""
    settings = Settings(
        **_base_settings_kwargs(),
        OAUTH_LOGIN_ENABLED=True,
        GITHUB_CLIENT_ID="github-id",
        GITHUB_CLIENT_SECRET="github-secret",
    )
    monkeypatch.setattr("app.auth.provider_registry.settings", settings)
    
    result = get_enabled_providers()
    
    assert result == ["github"]


def test_get_enabled_providers_github_and_google_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When GitHub and Google are configured, return both."""
    settings = Settings(
        **_base_settings_kwargs(),
        OAUTH_LOGIN_ENABLED=True,
        GITHUB_CLIENT_ID="github-id",
        GITHUB_CLIENT_SECRET="github-secret",
        GOOGLE_CLIENT_ID="google-id",
        GOOGLE_CLIENT_SECRET="google-secret",
    )
    monkeypatch.setattr("app.auth.provider_registry.settings", settings)
    
    result = get_enabled_providers()
    
    assert sorted(result) == ["github", "google"]


def test_get_enabled_providers_oauth_disabled_with_all_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When OAUTH_LOGIN_ENABLED=False, return empty even if all providers are set."""
    settings = Settings(
        **_base_settings_kwargs(),
        OAUTH_LOGIN_ENABLED=False,
        GITHUB_CLIENT_ID="github-id",
        GITHUB_CLIENT_SECRET="github-secret",
        GITLAB_CLIENT_ID="gitlab-id",
        GITLAB_CLIENT_SECRET="gitlab-secret",
        GOOGLE_CLIENT_ID="google-id",
        GOOGLE_CLIENT_SECRET="google-secret",
        MICROSOFT_CLIENT_ID="microsoft-id",
        MICROSOFT_CLIENT_SECRET="microsoft-secret",
    )
    monkeypatch.setattr("app.auth.provider_registry.settings", settings)
    
    result = get_enabled_providers()
    
    assert result == []


def test_startup_warning_mismatched_oauth_credentials(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When OAUTH_LOGIN_ENABLED=True but GitHub has ID without secret, emit WARNING."""
    with caplog.at_level(logging.WARNING):
        Settings(
            **_base_settings_kwargs(),
            OAUTH_LOGIN_ENABLED=True,
            GITHUB_CLIENT_ID="github-id",
            GITHUB_CLIENT_SECRET="",
        )
    
    warning_messages = [record.message for record in caplog.records if record.levelno == logging.WARNING]
    assert any("github" in msg.lower() and "mismatched" in msg.lower() for msg in warning_messages)


def test_startup_warning_no_mismatch_when_both_set(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When both ID and secret are set, no mismatch warning."""
    with caplog.at_level(logging.WARNING):
        Settings(
            **_base_settings_kwargs(),
            OAUTH_LOGIN_ENABLED=True,
            GITHUB_CLIENT_ID="github-id",
            GITHUB_CLIENT_SECRET="github-secret",
        )
    
    warning_messages = [record.message for record in caplog.records if record.levelno == logging.WARNING]
    assert not any("mismatched" in msg.lower() for msg in warning_messages)
