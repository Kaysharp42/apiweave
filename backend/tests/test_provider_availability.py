"""Tests for provider availability endpoint and provider registry.

Covers:
- GET /api/auth/providers returns correct enabled/disabled flags
- GET /api/auth/login/{provider} returns 302 when configured, 404 when not
- No secrets leaked from /api/auth/providers
- Regression: GitHub login succeeds even when GitLab env vars are absent
"""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import app.auth.router as auth_router
from app.auth.provider_registry import (
    _check_provider_enabled,
    get_configured_providers,
    get_provider_config,
)
from app.config import settings
from app.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# Unit tests: _check_provider_enabled
# ---------------------------------------------------------------------------


def test_check_provider_enabled_github_both_set(monkeypatch: pytest.MonkeyPatch) -> None:
    """_check_provider_enabled returns True when both GitHub vars are set."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    assert _check_provider_enabled("github") is True


def test_check_provider_enabled_github_global_oauth_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", False)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    assert _check_provider_enabled("github") is False


def test_check_provider_enabled_github_missing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    """_check_provider_enabled returns False when GitHub secret is missing."""
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", None)
    assert _check_provider_enabled("github") is False


def test_check_provider_enabled_github_missing_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """_check_provider_enabled returns False when GitHub client_id is missing."""
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    assert _check_provider_enabled("github") is False


def test_check_provider_enabled_gitlab_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """_check_provider_enabled returns False when GitLab vars are absent."""
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    assert _check_provider_enabled("gitlab") is False


def test_check_provider_enabled_unknown_provider() -> None:
    """_check_provider_enabled returns False for an unknown provider name."""
    assert _check_provider_enabled("unknown-provider") is False


# ---------------------------------------------------------------------------
# Unit tests: get_configured_providers
# ---------------------------------------------------------------------------


def test_get_configured_providers_structure(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_configured_providers returns a list with id and enabled keys for all providers."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    result = get_configured_providers()

    assert isinstance(result, list)
    assert len(result) == 4
    for item in result:
        assert "id" in item
        assert "enabled" in item
        assert isinstance(item["enabled"], bool)


def test_get_configured_providers_github_enabled_gitlab_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_configured_providers correctly marks GitHub enabled and GitLab disabled."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    result = get_configured_providers()
    by_id = {item["id"]: item["enabled"] for item in result}

    assert by_id["github"] is True
    assert by_id["gitlab"] is False
    assert by_id["google"] is False
    assert by_id["microsoft"] is False


def test_get_configured_providers_respects_global_oauth_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", False)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    result = get_configured_providers()

    assert all(item["enabled"] is False for item in result)


def test_get_configured_providers_no_secrets_in_output(monkeypatch: pytest.MonkeyPatch) -> None:
    """get_configured_providers must never expose client_id or client_secret values."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "super-secret-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "super-secret-value")
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    result = get_configured_providers()
    output_str = str(result)

    assert "super-secret-id" not in output_str
    assert "super-secret-value" not in output_str
    # Only allowed keys are 'id' and 'enabled'
    for item in result:
        assert set(item.keys()) == {"id", "enabled"}


# ---------------------------------------------------------------------------
# Unit tests: get_provider_config
# ---------------------------------------------------------------------------


def test_get_provider_config_unknown_provider_raises() -> None:
    """get_provider_config raises ValueError for an unknown provider name."""
    with pytest.raises(ValueError, match="Unsupported OAuth provider"):
        get_provider_config("unknown-provider")


def test_get_provider_config_github_only_validates_github_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: get_provider_config('github') succeeds with only GitHub env vars set.

    This is the original bug: GitHub login raised ValueError about GitLab being
    unconfigured when GitLab env vars were absent.
    """
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    # Deliberately do NOT set any GITLAB_* vars — they should be irrelevant
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)

    config = get_provider_config("github")

    assert config.name == "github"
    assert config.client_id == "gh-id"
    assert config.client_secret == "gh-secret"


def test_get_provider_config_gitlab_raises_when_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """get_provider_config('gitlab') raises ValueError when GitLab vars are absent."""
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)

    with pytest.raises(ValueError, match="not available or not configured"):
        get_provider_config("gitlab")


# ---------------------------------------------------------------------------
# Router tests: GET /api/auth/providers
# ---------------------------------------------------------------------------


def test_providers_endpoint_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/providers returns HTTP 200."""
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    response = client.get("/api/auth/providers")
    assert response.status_code == 200


def test_providers_endpoint_returns_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/providers returns a JSON array."""
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    response = client.get("/api/auth/providers")
    data = response.json()

    assert isinstance(data, list)
    assert len(data) == 4


def test_providers_endpoint_correct_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/providers items have exactly 'id' and 'enabled' keys."""
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    response = client.get("/api/auth/providers")
    data = response.json()

    for item in data:
        assert set(item.keys()) == {"id", "enabled"}
        assert isinstance(item["id"], str)
        assert isinstance(item["enabled"], bool)


def test_providers_endpoint_github_enabled_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """GET /api/auth/providers shows github enabled=True when GitHub vars are set."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    response = client.get("/api/auth/providers")
    data = response.json()
    by_id = {item["id"]: item["enabled"] for item in data}

    assert by_id["github"] is True
    assert by_id["gitlab"] is False


def test_providers_endpoint_does_not_leak_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/providers must not expose client_id or client_secret values."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "leaked-client-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "leaked-client-secret")
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GOOGLE_CLIENT_SECRET", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_ID", None)
    monkeypatch.setattr(settings, "MICROSOFT_CLIENT_SECRET", None)

    response = client.get("/api/auth/providers")
    body = response.text

    assert "leaked-client-id" not in body
    assert "leaked-client-secret" not in body


# ---------------------------------------------------------------------------
# Router tests: GET /api/auth/login/{provider}
# ---------------------------------------------------------------------------


def test_login_unknown_provider_returns_404() -> None:
    """GET /api/auth/login/unknown-provider returns 404 with unsupported detail."""
    response = client.get("/api/auth/login/unknown-provider", follow_redirects=False)
    assert response.status_code == 404
    assert "Unsupported OAuth provider" in response.text


def test_login_gitlab_returns_404_when_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/login/gitlab returns 404 when GitLab env vars are absent.

    Must NOT leak env var names (e.g. 'GITLAB_CLIENT_ID') in the response body.
    """
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)

    response = client.get("/api/auth/login/gitlab", follow_redirects=False)
    assert response.status_code == 404
    # Assert sanitized message without env var names
    assert "not available or not configured" in response.text
    assert "GITLAB_CLIENT_ID" not in response.text


def test_login_github_returns_302_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/login/github returns 302 redirect when GitHub is configured."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setattr(auth_router.OAuthStateRepository, "create", AsyncMock())

    response = client.get("/api/auth/login/github", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers.get("location", "")
    assert "github.com" in location


def test_login_github_redirect_contains_state(monkeypatch: pytest.MonkeyPatch) -> None:
    """GET /api/auth/login/github redirect URL must include a state parameter."""
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "http://localhost:8000")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    monkeypatch.setattr(auth_router.OAuthStateRepository, "create", AsyncMock())

    response = client.get("/api/auth/login/github", follow_redirects=False)
    location = response.headers.get("location", "")
    assert "state=" in location
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fauth%2Fcallback%2Fgithub" in location


# ---------------------------------------------------------------------------
# Regression test: original bug
# ---------------------------------------------------------------------------


def test_regression_github_login_succeeds_when_gitlab_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: GitHub login must not fail because GitLab env vars are absent.

    Original bug: get_provider_config('github') raised ValueError about GitLab
    being unconfigured, blocking GitHub OAuth entirely.
    """
    monkeypatch.setattr(settings, "OAUTH_LOGIN_ENABLED", True)
    monkeypatch.setattr(settings, "GITHUB_CLIENT_ID", "gh-id")
    monkeypatch.setattr(settings, "GITHUB_CLIENT_SECRET", "gh-secret")
    # GitLab deliberately unconfigured
    monkeypatch.setattr(settings, "GITLAB_CLIENT_ID", None)
    monkeypatch.setattr(settings, "GITLAB_CLIENT_SECRET", None)
    monkeypatch.setattr(auth_router.OAuthStateRepository, "create", AsyncMock())

    # Must not raise — should redirect to GitHub
    response = client.get("/api/auth/login/github", follow_redirects=False)
    assert response.status_code == 302, (
        f"Expected 302 redirect but got {response.status_code}. "
        "GitHub login is broken when GitLab is unconfigured (regression)."
    )
