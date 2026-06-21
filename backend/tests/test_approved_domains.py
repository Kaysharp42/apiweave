"""Tests for enforce_approved_domain() helper in auth router."""

from __future__ import annotations

import pytest

from app.auth.router import enforce_approved_domain
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


def test_enforce_approved_domain_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """When APPROVED_DOMAINS_ENABLED=False, all domains pass."""
    settings = Settings(
        **_base_settings_kwargs(),
        APPROVED_DOMAINS_ENABLED=False,
        APPROVED_DOMAINS="",
    )
    monkeypatch.setattr("app.auth.router.settings", settings)

    assert enforce_approved_domain("user@anything.com") is True


def test_enforce_approved_domain_matching(monkeypatch: pytest.MonkeyPatch) -> None:
    """When enabled and domain matches, return True."""
    settings = Settings(
        **_base_settings_kwargs(),
        APPROVED_DOMAINS_ENABLED=True,
        APPROVED_DOMAINS="example.com,mycompany.com",
    )
    monkeypatch.setattr("app.auth.router.settings", settings)

    assert enforce_approved_domain("user@example.com") is True
    assert enforce_approved_domain("user@mycompany.com") is True


def test_enforce_approved_domain_case_insensitive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Domain matching is case-insensitive."""
    settings = Settings(
        **_base_settings_kwargs(),
        APPROVED_DOMAINS_ENABLED=True,
        APPROVED_DOMAINS="Example.COM,MyCompany.com",
    )
    monkeypatch.setattr("app.auth.router.settings", settings)

    assert enforce_approved_domain("user@example.com") is True
    assert enforce_approved_domain("user@EXAMPLE.COM") is True
    assert enforce_approved_domain("user@mycompany.com") is True


def test_enforce_approved_domain_non_matching(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When enabled and domain doesn't match, return False."""
    settings = Settings(
        **_base_settings_kwargs(),
        APPROVED_DOMAINS_ENABLED=True,
        APPROVED_DOMAINS="example.com,mycompany.com",
    )
    monkeypatch.setattr("app.auth.router.settings", settings)

    assert enforce_approved_domain("user@other.com") is False
    assert enforce_approved_domain("user@notallowed.org") is False
