"""T9 acceptance tests for invite acceptance flow.

Covers:
1. POST /api/invites/accept/{token} — valid token returns email, role, providers
2. POST /api/invites/accept/{token} — expired token returns 404
3. POST /api/invites/accept/{token} — consumed token returns 404
4. OAuth signup with matching email applies invite role
5. OAuth signup with non-matching email does NOT consume invite
6. Role-elevation check: viewer cannot invite admin
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import app.auth.provider_registry as provider_registry
import app.auth.router as auth_router
import pytest
from app.auth.permissions import PRESET_VIEWER
from app.auth.provider_registry import ProviderConfig, ProviderUserInfo
from app.main import app
from app.models import Invite, OAuthState, Session, User, Workspace
from app.repositories.auth_repositories import (
    SessionRepository,
    UserRepository,
)
from app.services import invite_service
from fastapi.testclient import TestClient

pytest_plugins = ("tests.fixtures.oauth_mocks",)

client = TestClient(app)

RAW_TOKEN = "test-raw-invite-token"
TOKEN_HASH = hashlib.sha256(RAW_TOKEN.encode("utf-8")).hexdigest()


def _make_invite(
    email: str = "invited@example.com",
    role_preset: str = "editor",
    consumed: bool = False,
    expires_at: datetime | None = None,
) -> Invite:
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId="inv-test9",
        email=email,
        token_hash=TOKEN_HASH,
        role_preset=role_preset,
        created_by="usr-admin",
        created_at=now,
        expires_at=expires_at or (now + timedelta(days=7)),
        consumed=consumed,
        consumed_at=now if consumed else None,
        invite_url=f"http://localhost:3000/invite/{RAW_TOKEN}",
    )


def _make_session(token: str = "tok", user_id: str = "u1") -> Session:
    now = datetime.now(UTC)
    return Session.model_construct(
        sessionId=f"ses-{user_id}",
        userId=user_id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=7),
        revoked=False,
    )


def _make_user(
    user_id: str = "u1",
    roles: list[str] | None = None,
    email: str | None = None,
) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=email or f"{user_id}@example.com",
        display_name="Test",
        avatar_url=None,
        roles=roles or [],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


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


def _oauth_state(provider: str, invite_token: str | None = None) -> OAuthState:
    now = datetime.now(UTC)
    return OAuthState.model_construct(
        stateId=f"ost-{provider}",
        state="valid-state",
        code_verifier="verifier",
        nonce="nonce",
        provider=provider,
        redirect_uri=f"http://testserver/api/auth/callback/{provider}",
        invite_token=invite_token,
        expires_at=now + timedelta(minutes=10),
    )


def _user(email: str, roles: list[str] | None = None) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId="usr-new",
        verified_email=email,
        display_name="Test User",
        avatar_url=None,
        roles=roles or ["editor"],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
        oauth_accounts=[],
    )


def _workspace(slug: str = "personal") -> Workspace:
    now = datetime.now(UTC)
    return Workspace.model_construct(
        workspaceId="ws-test9",
        slug=slug,
        name="My Workspace",
        ownerType="user",
        ownerUserId="usr-new",
        orgId=None,
        isPersonal=True,
        createdAt=now,
        updatedAt=now,
    )


@pytest.fixture(autouse=True)
def _oauth_callback_workspace_patch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth_router.settings, "FRONTEND_URL", "http://localhost:3000")
    monkeypatch.setattr(
        auth_router,
        "ensure_personal_workspace",
        AsyncMock(return_value=_workspace()),
    )


def _userinfo(provider: str, email: str) -> ProviderUserInfo:
    return ProviderUserInfo(
        provider=provider,
        subject=f"{provider}-subject",
        email=email,
        email_verified=True,
        name="Test User",
        avatar_url=None,
        claims={"nonce": "nonce"} if provider in {"google", "microsoft"} else None,
    )


def _auth_patches(user: User, token: str = "tok"):
    session = _make_session(token=token, user_id=user.userId)
    return (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    )


class TestAcceptValidToken:
    def test_valid_token_returns_details_and_providers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        invite = _make_invite()
        monkeypatch.setattr(
            invite_service,
            "validate_invite_token",
            AsyncMock(return_value=invite),
        )
        monkeypatch.setattr(
            "app.routes.invites.get_enabled_providers",
            lambda: ["github", "google"],
        )
        response = client.post(f"/api/invites/accept/{RAW_TOKEN}")
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "invited@example.com"
        assert data["role"] == "editor"
        assert data["providers"] == ["github", "google"]
        assert "invite_token" in response.cookies


class TestAcceptExpiredToken:
    def test_expired_token_returns_404(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            invite_service,
            "validate_invite_token",
            AsyncMock(return_value=None),
        )
        response = client.post(f"/api/invites/accept/{RAW_TOKEN}")
        assert response.status_code == 404


class TestAcceptConsumedToken:
    def test_consumed_token_returns_404(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            invite_service,
            "validate_invite_token",
            AsyncMock(return_value=None),
        )
        response = client.post(f"/api/invites/accept/{RAW_TOKEN}")
        assert response.status_code == 404


class TestRoleAppliedOnMatchingEmail:
    def test_oauth_signup_matching_email_applies_invite_role(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "github"
        invite_email = "invited@example.com"
        invite = _make_invite(email=invite_email, role_preset="editor")
        created_user = _user(invite_email, roles=["editor"])

        monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", False)
        monkeypatch.setattr(auth_router.settings, "OAUTH_LOGIN_ENABLED", True)
        monkeypatch.setattr(auth_router.settings, "APPROVED_DOMAINS_ENABLED", False)
        monkeypatch.setattr(
            provider_registry,
            "get_provider_config",
            lambda name: _provider_config(name),
        )
        monkeypatch.setattr(
            provider_registry,
            "get_enabled_providers",
            lambda: ["github"],
        )
        monkeypatch.setattr(
            auth_router.OAuthStateRepository,
            "consume",
            AsyncMock(return_value=_oauth_state(provider, invite_token=RAW_TOKEN)),
        )
        monkeypatch.setattr(
            provider_registry,
            "exchange_code_for_token",
            AsyncMock(return_value={"access_token": "token", "id_token": "h.p.s"}),
        )
        monkeypatch.setattr(
            provider_registry,
            "fetch_userinfo",
            AsyncMock(return_value=_userinfo(provider, invite_email)),
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
        monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=5))
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_by_token_hash",
            AsyncMock(return_value=invite),
        )
        monkeypatch.setattr(auth_router.InviteRepository, "consume", AsyncMock(return_value=True))
        monkeypatch.setattr(
            auth_router.UserRepository, "create", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository, "update", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository,
            "add_oauth_account",
            AsyncMock(return_value=created_user),
        )
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_valid_by_email",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            auth_router.ApprovedDomainRepository,
            "is_domain_approved",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(auth_router.SessionRepository, "create", AsyncMock())
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_deleted",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_email_deleted",
            AsyncMock(return_value=False),
        )

        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        create_call = auth_router.UserRepository.create.call_args
        assert create_call.kwargs["roles"] == ["editor"]
        auth_router.InviteRepository.consume.assert_awaited_once_with("inv-test9")


class TestEmailMismatchDoesNotConsume:
    def test_oauth_signup_nonmatching_email_does_not_consume(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        provider = "github"
        invite_email = "invited@example.com"
        oauth_email = "other@example.com"
        invite = _make_invite(email=invite_email, role_preset="editor")
        created_user = _user(oauth_email, roles=["viewer"])

        monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", False)
        monkeypatch.setattr(auth_router.settings, "OAUTH_LOGIN_ENABLED", True)
        monkeypatch.setattr(auth_router.settings, "APPROVED_DOMAINS_ENABLED", False)
        monkeypatch.setattr(
            provider_registry,
            "get_provider_config",
            lambda name: _provider_config(name),
        )
        monkeypatch.setattr(
            provider_registry,
            "get_enabled_providers",
            lambda: ["github"],
        )
        monkeypatch.setattr(
            auth_router.OAuthStateRepository,
            "consume",
            AsyncMock(return_value=_oauth_state(provider, invite_token=RAW_TOKEN)),
        )
        monkeypatch.setattr(
            provider_registry,
            "exchange_code_for_token",
            AsyncMock(return_value={"access_token": "token", "id_token": "h.p.s"}),
        )
        monkeypatch.setattr(
            provider_registry,
            "fetch_userinfo",
            AsyncMock(return_value=_userinfo(provider, oauth_email)),
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
        monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=5))
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_by_token_hash",
            AsyncMock(return_value=invite),
        )
        monkeypatch.setattr(auth_router.InviteRepository, "consume", AsyncMock(return_value=True))
        monkeypatch.setattr(
            auth_router.UserRepository, "create", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository, "update", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository,
            "add_oauth_account",
            AsyncMock(return_value=created_user),
        )
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_valid_by_email",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            auth_router.ApprovedDomainRepository,
            "is_domain_approved",
            AsyncMock(return_value=True),
        )
        monkeypatch.setattr(auth_router.SessionRepository, "create", AsyncMock())
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_deleted",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_email_deleted",
            AsyncMock(return_value=False),
        )

        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        auth_router.InviteRepository.consume.assert_not_awaited()
        create_call = auth_router.UserRepository.create.call_args
        assert create_call.kwargs["roles"] == ["viewer"]


class TestRoleElevationBlocked:
    def test_viewer_cannot_invite_admin(self) -> None:
        from app.auth.permissions import USERS_INVITE

        viewer = _make_user(user_id="usr-viewer", roles=[PRESET_VIEWER])
        viewer.permissions = [USERS_INVITE]
        s, t, u = _auth_patches(viewer)
        client.cookies.set("session", "tok")
        client.headers.update({"X-CSRF-Token": "x"})
        client.cookies.set("csrftoken", "x")
        with s, t, u:
            response = client.post(
                "/api/invites",
                json={"email": "new@example.com", "role": "admin"},
            )
        assert response.status_code == 403
        assert "role" in response.json()["detail"].lower()


class TestInviteWithAdminRole:
    """Invite with admin role preset is applied on matching OAuth signup."""

    def test_admin_role_from_invite_applied(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "github"
        invite_email = "admin-invited@example.com"
        invite = _make_invite(email=invite_email, role_preset="admin")
        created_user = _user(invite_email, roles=["admin"])

        monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", False)
        monkeypatch.setattr(auth_router.settings, "OAUTH_LOGIN_ENABLED", True)
        monkeypatch.setattr(auth_router.settings, "APPROVED_DOMAINS_ENABLED", False)
        monkeypatch.setattr(
            provider_registry,
            "get_provider_config",
            lambda name: _provider_config(name),
        )
        monkeypatch.setattr(
            provider_registry,
            "get_enabled_providers",
            lambda: ["github"],
        )
        monkeypatch.setattr(
            auth_router.OAuthStateRepository,
            "consume",
            AsyncMock(return_value=_oauth_state(provider, invite_token=RAW_TOKEN)),
        )
        monkeypatch.setattr(
            provider_registry,
            "exchange_code_for_token",
            AsyncMock(return_value={"access_token": "token", "id_token": "h.p.s"}),
        )
        monkeypatch.setattr(
            provider_registry,
            "fetch_userinfo",
            AsyncMock(return_value=_userinfo(provider, invite_email)),
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
        monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=5))
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_by_token_hash",
            AsyncMock(return_value=invite),
        )
        monkeypatch.setattr(auth_router.InviteRepository, "consume", AsyncMock(return_value=True))
        monkeypatch.setattr(
            auth_router.UserRepository, "create", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository, "update", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository,
            "add_oauth_account",
            AsyncMock(return_value=created_user),
        )
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_valid_by_email",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            auth_router.ApprovedDomainRepository,
            "is_domain_approved",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(auth_router.SessionRepository, "create", AsyncMock())
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_deleted",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_email_deleted",
            AsyncMock(return_value=False),
        )

        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        create_call = auth_router.UserRepository.create.call_args
        assert create_call.kwargs["roles"] == ["admin"]


class TestInviteViaGitLabProvider:
    """Invite role applied when signing up via a non-GitHub provider."""

    def test_gitlab_invite_role_applied(self, monkeypatch: pytest.MonkeyPatch) -> None:
        provider = "gitlab"
        invite_email = "gl-invited@example.com"
        invite = _make_invite(email=invite_email, role_preset="editor")
        created_user = _user(invite_email, roles=["editor"])

        monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", False)
        monkeypatch.setattr(auth_router.settings, "OAUTH_LOGIN_ENABLED", True)
        monkeypatch.setattr(auth_router.settings, "APPROVED_DOMAINS_ENABLED", False)
        monkeypatch.setattr(
            provider_registry,
            "get_provider_config",
            lambda name: _provider_config(name),
        )
        monkeypatch.setattr(
            provider_registry,
            "get_enabled_providers",
            lambda: ["gitlab"],
        )
        monkeypatch.setattr(
            auth_router.OAuthStateRepository,
            "consume",
            AsyncMock(return_value=_oauth_state(provider, invite_token=RAW_TOKEN)),
        )
        monkeypatch.setattr(
            provider_registry,
            "exchange_code_for_token",
            AsyncMock(return_value={"access_token": "token"}),
        )
        monkeypatch.setattr(
            provider_registry,
            "fetch_userinfo",
            AsyncMock(return_value=_userinfo(provider, invite_email)),
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
        monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=5))
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_by_token_hash",
            AsyncMock(return_value=invite),
        )
        monkeypatch.setattr(auth_router.InviteRepository, "consume", AsyncMock(return_value=True))
        monkeypatch.setattr(
            auth_router.UserRepository, "create", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository, "update", AsyncMock(return_value=created_user)
        )
        monkeypatch.setattr(
            auth_router.UserRepository,
            "add_oauth_account",
            AsyncMock(return_value=created_user),
        )
        monkeypatch.setattr(
            auth_router.InviteRepository,
            "get_valid_by_email",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            auth_router.ApprovedDomainRepository,
            "is_domain_approved",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(auth_router.SessionRepository, "create", AsyncMock())
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_deleted",
            AsyncMock(return_value=False),
        )
        monkeypatch.setattr(
            auth_router.DeletedUserRepository,
            "is_email_deleted",
            AsyncMock(return_value=False),
        )

        response = client.get(
            f"/api/auth/callback/{provider}",
            params={"code": "valid-code", "state": "valid-state"},
            follow_redirects=False,
        )
        assert response.status_code == 302
        create_call = auth_router.UserRepository.create.call_args
        assert create_call.kwargs["roles"] == ["editor"]
        auth_router.InviteRepository.consume.assert_awaited_once_with("inv-test9")
