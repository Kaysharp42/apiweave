"""T8 acceptance tests for OAuth callback handlers.

Covers:
- Happy path (user created, session set, redirect)
- State mismatch → 401
- OAUTH_LOGIN_ENABLED=False → 503
- Provider not configured → 503
- Unapproved domain → 403
- Unverified email → 403
- Account linking blocked → 409
- GET /api/auth/providers returns enabled list
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

import app.auth.provider_registry as provider_registry
import app.auth.router as auth_router
from app.auth.exceptions import OAuthLinkingBlockedError
from app.auth.provider_registry import ProviderConfig, ProviderUserInfo
from app.main import app
from app.models import OAuthState, User, Workspace

pytest_plugins = ("tests.fixtures.oauth_mocks",)

client = pytest.importorskip("fastapi.testclient").TestClient(app)


def _provider_config(provider: str) -> ProviderConfig:
    return ProviderConfig(
        name=provider,
        client_id=f"{provider}-client-id",
        client_secret=f"{provider}-client-secret",
        authorize_url=f"https://{provider}.example.test/oauth/authorize",
        token_url=f"https://{provider}.example.test/oauth/token",
        userinfo_url=f"https://{provider}.example.test/userinfo",
        oidc=provider in {"google", "microsoft"},
        scopes=(
            ("openid", "profile", "email")
            if provider in {"google", "microsoft"}
            else ("read_user",)
        ),
    )


def _oauth_state(provider: str) -> OAuthState:
    now = datetime.now(UTC)
    return OAuthState.model_construct(
        stateId=f"ost-{provider}",
        state="valid-state",
        code_verifier="verifier",
        nonce="nonce",
        provider=provider,
        redirect_uri=f"http://testserver/api/auth/callback/{provider}",
        invite_token=None,
        expires_at=now + timedelta(minutes=10),
    )


def _user(email: str) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId="usr-test",
        verified_email=email,
        display_name="Test User",
        avatar_url=None,
        roles=["viewer"],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
        oauth_accounts=[],
    )


def _workspace(slug: str = "personal") -> Workspace:
    now = datetime.now(UTC)
    return Workspace.model_construct(
        workspaceId="ws-test",
        slug=slug,
        name="My Workspace",
        ownerType="user",
        ownerUserId="usr-test",
        orgId=None,
        isPersonal=True,
        createdAt=now,
        updatedAt=now,
    )


def _userinfo(
    provider: str, *, verified: bool = True, email: str | None = None
) -> ProviderUserInfo:
    addr = email or f"testuser@{provider}.example.com"
    return ProviderUserInfo(
        provider=provider,
        subject=f"{provider}-subject",
        email=addr if verified else None,
        email_verified=verified,
        name="Test User",
        avatar_url=None,
        claims={"nonce": "nonce"} if provider in {"google", "microsoft"} else None,
    )


def _patch_all(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    *,
    state: OAuthState | None,
    verified: bool = True,
    email: str | None = None,
    oauth_enabled: bool = True,
    enabled_providers: list[str] | None = None,
) -> User:
    user = _user(email or f"testuser@{provider}.example.com")
    monkeypatch.setattr(auth_router.settings, "FRONTEND_URL", "http://localhost:3000")
    monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", True)
    monkeypatch.setattr(auth_router.settings, "OAUTH_LOGIN_ENABLED", oauth_enabled)
    monkeypatch.setattr(auth_router.settings, "APPROVED_DOMAINS_ENABLED", False)
    monkeypatch.setattr(
        provider_registry,
        "get_provider_config",
        lambda name: _provider_config(name),
    )
    monkeypatch.setattr(
        provider_registry,
        "get_enabled_providers",
        lambda: enabled_providers or ["github", "gitlab", "google", "microsoft"],
    )
    monkeypatch.setattr(
        auth_router.OAuthStateRepository, "consume", AsyncMock(return_value=state)
    )
    monkeypatch.setattr(
        provider_registry,
        "exchange_code_for_token",
        AsyncMock(return_value={"access_token": "token", "id_token": "header.payload.sig"}),
    )
    monkeypatch.setattr(
        provider_registry,
        "fetch_userinfo",
        AsyncMock(return_value=_userinfo(provider, verified=verified, email=email)),
    )
    monkeypatch.setattr(
        auth_router.ProviderIdentityRepository,
        "get_by_provider_subject",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(auth_router.ProviderIdentityRepository, "create", AsyncMock())
    monkeypatch.setattr(
        auth_router.UserRepository, "get_by_email", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=0))
    monkeypatch.setattr(
        auth_router.UserRepository, "create", AsyncMock(return_value=user)
    )
    monkeypatch.setattr(
        auth_router.UserRepository, "update", AsyncMock(return_value=user)
    )
    monkeypatch.setattr(
        auth_router.UserRepository,
        "add_oauth_account",
        AsyncMock(return_value=user),
    )
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "get_valid_by_email",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "find_active_by_email",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        auth_router.ApprovedDomainRepository,
        "is_domain_approved",
        AsyncMock(return_value=False),
    )
    monkeypatch.setattr(auth_router.SessionRepository, "create", AsyncMock())
    monkeypatch.setattr(
        auth_router,
        "ensure_personal_workspace",
        AsyncMock(return_value=_workspace()),
    )
    return user


class TestGitHubCallbackHappyPath:
    def test_github_callback_happy_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "github"
        _patch_all(monkeypatch, provider, state=_oauth_state(provider), verified=True)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert response.headers["location"] == "http://localhost:3000/personal/workflows"
        auth_router.ensure_personal_workspace.assert_awaited_once()
        assert "session" in response.cookies or any(
            "session" in k.lower() for k in response.cookies
        )
        assert "csrftoken" in response.cookies or any(
            "csrftoken" in k.lower() for k in response.cookies
        )


class TestStateMismatch:
    def test_state_mismatch_returns_400(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "github"
        _patch_all(monkeypatch, provider, state=None, verified=True)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "legit-code", "state": "tampered-state"},
        )
        assert response.status_code == 400
        detail = response.json().get("detail", "").lower()
        assert "state" in detail or "invalid" in detail


class TestDisabledFlag:
    def test_disabled_flag_returns_503(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "github"
        _patch_all(
            monkeypatch,
            provider,
            state=_oauth_state(provider),
            verified=True,
            oauth_enabled=False,
        )
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
        )
        assert response.status_code == 503
        assert "disabled" in response.json()["detail"].lower()


class TestProviderNotConfigured:
    def test_provider_not_configured_returns_503(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "github"
        _patch_all(
            monkeypatch,
            provider,
            state=_oauth_state(provider),
            verified=True,
            enabled_providers=["google"],
        )
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
        )
        assert response.status_code == 503
        assert "not configured" in response.json()["detail"].lower()


class TestUnapprovedDomain:
    def test_unapproved_domain_returns_403(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "github"
        _patch_all(
            monkeypatch,
            provider,
            state=_oauth_state(provider),
            verified=True,
            email="user@blocked-domain.com",
        )
        monkeypatch.setattr(
            auth_router, "enforce_approved_domain", lambda email: False
        )
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
        )
        assert response.status_code == 403
        detail = response.json().get("detail", "").lower()
        assert "domain" in detail


class TestUnverifiedEmail:
    def test_unverified_email_returns_403(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "github"
        _patch_all(monkeypatch, provider, state=_oauth_state(provider), verified=False)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "unverified-code", "state": "valid-state"},
        )
        assert response.status_code == 403
        detail = response.json().get("detail", "").lower()
        assert "verif" in detail or "email" in detail


class TestLinkingBlocked:
    def test_linking_blocked_returns_409(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "github"
        _patch_all(monkeypatch, provider, state=_oauth_state(provider), verified=True)

        async def _raise_linking_blocked(*_args: object, **_kwargs: object) -> User:
            raise OAuthLinkingBlockedError(
                detail="Account linking is blocked. Use a different sign-in method."
            )

        monkeypatch.setattr(auth_router, "_create_or_link_user", _raise_linking_blocked)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
        )
        assert response.status_code == 409
        detail = response.json().get("detail", "").lower()
        assert "linking" in detail


class TestGitLabCallbackHappyPath:
    """E3: GitLab happy path — user created, session set, redirect."""

    def test_gitlab_callback_happy_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "gitlab"
        _patch_all(monkeypatch, provider, state=_oauth_state(provider), verified=True)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert response.headers["location"] == "http://localhost:3000/personal/workflows"
        assert "session" in response.cookies or any(
            "session" in k.lower() for k in response.cookies
        )


class TestGoogleCallbackHappyPath:
    """E3: Google OIDC happy path — nonce validated, user created, redirect."""

    def test_google_callback_happy_path(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "google"
        _patch_all(monkeypatch, provider, state=_oauth_state(provider), verified=True)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert response.headers["location"] == "http://localhost:3000/personal/workflows"
        assert "csrftoken" in response.cookies or any(
            "csrftoken" in k.lower() for k in response.cookies
        )


class TestMicrosoftCallbackHappyPath:
    """E3: Microsoft OIDC happy path — nonce validated, user created, redirect."""

    def test_microsoft_callback_happy_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "microsoft"
        _patch_all(monkeypatch, provider, state=_oauth_state(provider), verified=True)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        assert response.headers["location"] == "http://localhost:3000/personal/workflows"
        assert "session" in response.cookies or any(
            "session" in k.lower() for k in response.cookies
        )


class TestExpiredState:
    """State exists but is expired → 400."""

    def test_expired_state_returns_400(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "github"
        expired_state = OAuthState.model_construct(
            stateId="ost-expired",
            state="valid-state",
            code_verifier="verifier",
            nonce="nonce",
            provider=provider,
            redirect_uri=f"http://testserver/api/auth/callback/{provider}",
            invite_token=None,
            expires_at=datetime.now(UTC) - timedelta(minutes=5),
        )
        _patch_all(monkeypatch, provider, state=expired_state, verified=True)
        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
        )
        assert response.status_code == 400
        detail = response.json().get("detail", "").lower()
        assert "state" in detail or "expired" in detail


class TestStateProviderMismatch:
    """State was created for 'github' but callback hits '/callback/gitlab' → 400."""

    def test_state_provider_mismatch_returns_400(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # State was created for github
        state_for_github = _oauth_state("github")
        # But the callback is for gitlab
        _patch_all(monkeypatch, "gitlab", state=state_for_github, verified=True)
        response = client.get(
            "/api/auth/callback/gitlab",
            params={"code": "valid-code", "state": "valid-state"},
        )
        assert response.status_code == 400
        detail = response.json().get("detail", "").lower()
        assert "mismatch" in detail or "state" in detail


class TestProvidersEndpoint:
    def test_providers_endpoint_returns_list(self) -> None:
        response = client.get("/api/auth/providers")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 4
        provider_ids = {item["id"] for item in data}
        assert provider_ids == {"github", "gitlab", "google", "microsoft"}
        for item in data:
            assert "enabled" in item
            assert isinstance(item["enabled"], bool)
