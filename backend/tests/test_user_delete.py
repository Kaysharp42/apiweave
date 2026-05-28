from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient

import app.auth.provider_registry as provider_registry
import app.auth.router as auth_router
from app.auth.provider_registry import ProviderConfig, ProviderUserInfo
from app.main import app
from app.models import OAuthState, ProviderIdentity, Session, User
from app.repositories.auth_repositories import (
    ProviderIdentityRepository,
    SessionRepository,
    UserRepository,
)

client = TestClient(app)


class _FindResult:
    def __init__(self, items: list[object]) -> None:
        self._items = items

    async def to_list(self) -> list[object]:
        return self._items


def _provider_config() -> ProviderConfig:
    return ProviderConfig(
        name="github",
        client_id="github-client-id",
        client_secret="github-client-secret",
        authorize_url="https://github.example.test/oauth/authorize",
        token_url="https://github.example.test/oauth/token",
        userinfo_url="https://github.example.test/userinfo",
        oidc=False,
        scopes=("read_user",),
    )


def _oauth_state() -> OAuthState:
    now = datetime.now(UTC)
    return OAuthState.model_construct(
        stateId="ost-github",
        state="valid-state",
        code_verifier="verifier",
        nonce="nonce",
        provider="github",
        redirect_uri="http://testserver/api/auth/callback/github",
        invite_token=None,
        expires_at=now + timedelta(minutes=10),
    )


def _userinfo(
    email: str = "deleted@example.com",
    subject: str = "github-subject",
) -> ProviderUserInfo:
    return ProviderUserInfo(
        provider="github",
        subject=subject,
        email=email,
        email_verified=True,
        name="Deleted User",
        avatar_url=None,
        claims=None,
    )


def _user() -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId="usr-deleted",
        verified_email="deleted@example.com",
        display_name="Deleted User",
        avatar_url=None,
        roles=["viewer"],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _identity(identity_id: str = "pid-deleted") -> ProviderIdentity:
    return ProviderIdentity.model_construct(
        identityId=identity_id,
        userId="usr-deleted",
        provider="github",
        subject="github-subject",
        email="deleted@example.com",
        verified=True,
    )


def _session(session_id: str = "ses-deleted") -> Session:
    now = datetime.now(UTC)
    return Session.model_construct(
        sessionId=session_id,
        userId="usr-deleted",
        token_hash=f"hash-{session_id}",
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=7),
        revoked=False,
    )


def test_deleted_user_cannot_login_via_oauth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth_router.OAuthStateRepository,
        "consume",
        AsyncMock(return_value=_oauth_state()),
    )
    monkeypatch.setattr(
        provider_registry,
        "get_provider_config",
        lambda provider: _provider_config(),
    )
    monkeypatch.setattr(
        provider_registry,
        "exchange_code_for_token",
        AsyncMock(return_value={"access_token": "token"}),
    )
    monkeypatch.setattr(
        provider_registry,
        "fetch_userinfo",
        AsyncMock(return_value=_userinfo()),
    )
    monkeypatch.setattr(
        auth_router.DeletedUserRepository,
        "is_deleted",
        AsyncMock(return_value=False),
    )
    monkeypatch.setattr(
        auth_router.DeletedUserRepository,
        "is_email_deleted",
        AsyncMock(return_value=True),
    )

    response = client.get(
        "/api/auth/callback/github",
        params={"code": "valid-code", "state": "valid-state"},
        follow_redirects=False,
    )

    assert response.status_code == status.HTTP_302_FOUND
    assert response.headers["location"] == (
        "http://localhost:3000/login?error=Account+has+been+deleted"
    )


@pytest.mark.asyncio
async def test_deleted_user_provider_identity_cleaned_up(monkeypatch: pytest.MonkeyPatch) -> None:
    identities = [_identity("pid-one"), _identity("pid-two")]
    deleted = AsyncMock()
    monkeypatch.setattr(ProviderIdentity, "find", lambda *args: _FindResult(identities))
    monkeypatch.setattr(ProviderIdentity, "delete", deleted)

    count = await ProviderIdentityRepository.delete_by_user_id("usr-deleted")

    assert count == 2
    assert deleted.await_count == 2


@pytest.mark.asyncio
async def test_deleted_user_sessions_cleaned_up(monkeypatch: pytest.MonkeyPatch) -> None:
    sessions = [_session("ses-one"), _session("ses-two")]
    deleted = AsyncMock()
    monkeypatch.setattr(Session, "find", lambda *args: _FindResult(sessions))
    monkeypatch.setattr(Session, "delete", deleted)

    count = await SessionRepository.delete_all_for_user("usr-deleted")

    assert count == 2
    assert deleted.await_count == 2


@pytest.mark.asyncio
async def test_deleted_user_blocked_by_email(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        auth_router.DeletedUserRepository,
        "is_deleted",
        AsyncMock(return_value=False),
    )
    monkeypatch.setattr(
        auth_router.DeletedUserRepository,
        "is_email_deleted",
        AsyncMock(return_value=True),
    )

    with pytest.raises(HTTPException) as exc_info:
        await auth_router._create_or_link_user(_userinfo(subject="different-subject"))

    assert exc_info.value.status_code == status.HTTP_403_FORBIDDEN
    assert exc_info.value.detail == "Account has been deleted"


@pytest.mark.asyncio
async def test_delete_user_cascades_properly(monkeypatch: pytest.MonkeyPatch) -> None:
    user = _user()
    record_deleted = AsyncMock()
    delete_identities = AsyncMock(return_value=1)
    delete_sessions = AsyncMock(return_value=2)
    delete_user = AsyncMock()
    monkeypatch.setattr(UserRepository, "get_by_id", AsyncMock(return_value=user))
    monkeypatch.setattr(
        "app.repositories.auth_repositories.DeletedUserRepository.create",
        record_deleted,
    )
    monkeypatch.setattr(ProviderIdentityRepository, "delete_by_user_id", delete_identities)
    monkeypatch.setattr(SessionRepository, "delete_all_for_user", delete_sessions)
    monkeypatch.setattr(User, "delete", delete_user)

    deleted = await UserRepository.delete("usr-deleted")

    assert deleted is True
    record_deleted.assert_awaited_once_with("usr-deleted", "deleted@example.com")
    delete_identities.assert_awaited_once_with("usr-deleted")
    delete_sessions.assert_awaited_once_with("usr-deleted")
    delete_user.assert_awaited_once()
