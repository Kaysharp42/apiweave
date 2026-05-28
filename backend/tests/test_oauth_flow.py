import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, status
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

import app.auth.provider_registry as provider_registry
import app.auth.router as auth_router
from app.auth.provider_registry import ProviderConfig, ProviderUserInfo
from app.main import app
from app.models import Invite, OAuthState, ProviderIdentity, User

pytest_plugins = ("tests.fixtures.oauth_mocks",)

client = TestClient(app)

PROVIDERS = ["github", "gitlab", "google", "microsoft"]


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


def _oauth_state(
    provider: str,
    *,
    expired: bool = False,
    invite_token: str | None = None,
) -> OAuthState:
    now = datetime.now(UTC)
    return OAuthState.model_construct(
        stateId=f"ost-{provider}",
        state="valid-state",
        code_verifier="verifier",
        nonce="nonce",
        provider=provider,
        redirect_uri=f"http://testserver/api/auth/callback/{provider}",
        invite_token=invite_token,
        expires_at=now - timedelta(minutes=1) if expired else now + timedelta(minutes=10),
    )


def _user(email: str) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId="usr-test",
        verified_email=email,
        display_name="Test User",
        avatar_url=None,
        roles=["admin"],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _provider_identity(provider: str, user_id: str = "usr-test") -> ProviderIdentity:
    return ProviderIdentity.model_construct(
        identityId="pid-test",
        userId=user_id,
        provider=provider,
        subject=f"{provider}-subject",
        email=f"testuser@{provider}.example.com",
        verified=True,
    )


def _invite(email: str, token: str) -> Invite:
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId="inv-test",
        email=email,
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        role_preset="viewer",
        created_by="usr-admin",
        created_at=now,
        expires_at=now + timedelta(days=1),
        consumed_at=None,
        consumed=False,
    )


def _userinfo(provider: str, *, verified: bool = True) -> ProviderUserInfo:
    email = f"testuser@{provider}.example.com" if verified else None
    return ProviderUserInfo(
        provider=provider,
        subject=f"{provider}-subject",
        email=email,
        email_verified=verified,
        name="Test User",
        avatar_url=None,
        claims={"nonce": "nonce"} if provider in {"google", "microsoft"} else None,
    )


def _patch_provider(monkeypatch: pytest.MonkeyPatch, provider: str) -> None:
    monkeypatch.setattr(
        provider_registry,
        "get_provider_config",
        lambda name: _provider_config(name),
    )
    monkeypatch.setattr(auth_router.OAuthStateRepository, "create", AsyncMock())


def _patch_callback(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    *,
    state: OAuthState | None,
    verified: bool = True,
) -> User:
    user = _user(f"testuser@{provider}.example.com")
    monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", True)
    monkeypatch.setattr(
        provider_registry,
        "get_provider_config",
        lambda name: _provider_config(name),
    )
    monkeypatch.setattr(auth_router.OAuthStateRepository, "consume", AsyncMock(return_value=state))
    monkeypatch.setattr(
        provider_registry,
        "exchange_code_for_token",
        AsyncMock(return_value={"access_token": "token", "id_token": "header.payload.sig"}),
    )
    monkeypatch.setattr(
        provider_registry,
        "fetch_userinfo",
        AsyncMock(return_value=_userinfo(provider, verified=verified)),
    )
    monkeypatch.setattr(
        auth_router.ProviderIdentityRepository,
        "get_by_provider_subject",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(auth_router.ProviderIdentityRepository, "create", AsyncMock())
    monkeypatch.setattr(auth_router.UserRepository, "get_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=0))
    monkeypatch.setattr(auth_router.UserRepository, "create", AsyncMock(return_value=user))
    monkeypatch.setattr(auth_router.UserRepository, "update", AsyncMock(return_value=user))
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
    return user


@pytest.mark.parametrize("provider", PROVIDERS)
def test_oauth_login_initiates_redirect(monkeypatch: pytest.MonkeyPatch, provider: str) -> None:
    """GET /api/auth/login/{provider} must return 302 with state in redirect URL."""
    _patch_provider(monkeypatch, provider)
    response = client.get(f"/api/auth/login/{provider}", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers.get("location", "")
    assert "state=" in location, f"Redirect URL missing state param: {location}"


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_tampered_state(monkeypatch: pytest.MonkeyPatch, provider: str) -> None:
    """Callback with a state value not matching server-side store must return 400."""
    _patch_callback(monkeypatch, provider, state=None)
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "legit-code", "state": "tampered-state-value"},
    )
    assert response.status_code == 400
    detail = response.json().get("detail", "").lower()
    assert "state" in detail or "invalid" in detail


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_expired_state(monkeypatch: pytest.MonkeyPatch, provider: str) -> None:
    """Callback with an expired state token must return 400."""
    _patch_callback(monkeypatch, provider, state=_oauth_state(provider, expired=True))
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "legit-code", "state": "expired-state-value"},
    )
    assert response.status_code == 400
    detail = response.json().get("detail", "").lower()
    assert "expir" in detail or "state" in detail or "invalid" in detail


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_succeeds_with_verified_email(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    _patch_callback(monkeypatch, provider, state=_oauth_state(provider), verified=True)
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "valid-code", "state": "valid-state"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:3000/"
    assert "session" in response.cookies or any(
        "session" in k.lower() for k in response.cookies
    )
    assert "csrftoken" in response.cookies or any(
        "csrftoken" in k.lower() for k in response.cookies
    )


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_unverified_email(monkeypatch: pytest.MonkeyPatch, provider: str) -> None:
    """Callback where provider reports unverified email must return 403."""
    _patch_callback(monkeypatch, provider, state=_oauth_state(provider), verified=False)
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "unverified-code", "state": "valid-state"},
    )
    assert response.status_code == 403
    detail = response.json().get("detail", "").lower()
    assert "verif" in detail or "email" in detail


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_missing_state_parameter(provider: str) -> None:
    """Callback with no state query parameter must return 400."""
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "some-code"},
        # No 'state' param
    )
    assert response.status_code == 400


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_redirects_uninvited_users_to_frontend_login(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    _patch_callback(monkeypatch, provider, state=_oauth_state(provider), verified=True)

    async def _raise_invite_required(*_args: object, **_kwargs: object) -> User:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access requires an invitation",
        )

    monkeypatch.setattr(auth_router, "_create_or_link_user", _raise_invite_required)

    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "valid-code", "state": "valid-state"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["location"] == "http://localhost:3000/login?error=Access+requires+an+invitation"


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_invalid_invite_token(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    _patch_callback(
        monkeypatch,
        provider,
        state=_oauth_state(provider, invite_token="wrong-token"),
        verified=True,
    )
    email = f"testuser@{provider}.example.com"
    monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=1))
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "get_valid_by_email",
        AsyncMock(return_value=[_invite(email, "correct-token")]),
    )
    consume = AsyncMock(return_value=True)
    monkeypatch.setattr(auth_router.InviteRepository, "consume", consume)

    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "valid-code", "state": "valid-state"},
        follow_redirects=False,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid invite token"
    consume.assert_not_awaited()


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_consumes_valid_invite_token(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    invite_token = "correct-token"
    _patch_callback(
        monkeypatch,
        provider,
        state=_oauth_state(provider, invite_token=invite_token),
        verified=True,
    )
    email = f"testuser@{provider}.example.com"
    monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=1))
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "get_valid_by_email",
        AsyncMock(return_value=[_invite(email, invite_token)]),
    )
    consume = AsyncMock(return_value=True)
    monkeypatch.setattr(auth_router.InviteRepository, "consume", consume)

    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "valid-code", "state": "valid-state"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    consume.assert_awaited_once_with("inv-test")


@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_auto_consumes_invite_when_no_token(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    _patch_callback(
        monkeypatch,
        provider,
        state=_oauth_state(provider, invite_token=None),
        verified=True,
    )
    email = f"testuser@{provider}.example.com"
    monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=1))
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "get_valid_by_email",
        AsyncMock(return_value=[_invite(email, "some-other-token")]),
    )
    consume = AsyncMock(return_value=True)
    monkeypatch.setattr(auth_router.InviteRepository, "consume", consume)
    monkeypatch.setattr(auth_router.UserRepository, "update", AsyncMock(return_value=_user(email)))

    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "valid-code", "state": "valid-state"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    consume.assert_awaited_once_with("inv-test")


@pytest.mark.asyncio
async def test_create_or_link_user_refetches_user_after_duplicate_key_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = "github"
    email = f"testuser@{provider}.example.com"
    existing_user = _user(email)
    get_by_email = AsyncMock(side_effect=[None, existing_user])
    create = AsyncMock(side_effect=DuplicateKeyError("duplicate verified_email"))

    monkeypatch.setattr(auth_router.settings, "SETUP_MODE_ENABLED", False)
    monkeypatch.setattr(
        auth_router.ProviderIdentityRepository,
        "get_by_provider_subject",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(auth_router.ProviderIdentityRepository, "create", AsyncMock())
    monkeypatch.setattr(auth_router.UserRepository, "get_by_email", get_by_email)
    monkeypatch.setattr(auth_router.UserRepository, "count", AsyncMock(return_value=1))
    monkeypatch.setattr(auth_router.UserRepository, "create", create)
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "find_active_by_email",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "get_valid_by_email",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(auth_router, "_is_domain_approved", AsyncMock(return_value=True))

    user = await auth_router._create_or_link_user(_userinfo(provider))

    assert user == existing_user
    assert get_by_email.await_count == 2
    create.assert_awaited_once()


@pytest.mark.asyncio
async def test_create_or_link_user_refetches_identity_after_duplicate_key_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = "github"
    email = f"testuser@{provider}.example.com"
    existing_user = _user(email)
    existing_identity = _provider_identity(provider, user_id=existing_user.userId)
    get_by_provider_subject = AsyncMock(side_effect=[None, existing_identity])

    monkeypatch.setattr(
        auth_router.ProviderIdentityRepository,
        "get_by_provider_subject",
        get_by_provider_subject,
    )
    monkeypatch.setattr(
        auth_router.ProviderIdentityRepository,
        "create",
        AsyncMock(side_effect=DuplicateKeyError("duplicate provider subject")),
    )
    monkeypatch.setattr(
        auth_router.UserRepository,
        "get_by_email",
        AsyncMock(return_value=existing_user),
    )
    monkeypatch.setattr(
        auth_router.UserRepository,
        "get_by_id",
        AsyncMock(return_value=existing_user),
    )
    monkeypatch.setattr(
        auth_router.InviteRepository,
        "find_active_by_email",
        AsyncMock(return_value=None),
    )

    user = await auth_router._create_or_link_user(_userinfo(provider))

    assert user == existing_user
    assert get_by_provider_subject.await_count == 2


# ---------------------------------------------------------------------------
# Tests 7-8: Fixture shape validation — run immediately (no skip)
# ---------------------------------------------------------------------------


class TestMockGithubUserinfoShape:
    """Verify the GitHub mock fixture returns the correct shape."""

    def test_mock_github_userinfo_returns_verified_email(
        self, mock_github_userinfo: dict
    ) -> None:
        """GitHub verified fixture must expose normalised fields with email_verified=True."""
        info = mock_github_userinfo
        assert info["provider"] == "github"
        assert isinstance(info["subject"], str)
        assert "@" in info["email"]
        assert info["email_verified"] is True
        assert info["name"]
        # Raw /user shape
        user = info["user"]
        assert "login" in user
        assert "id" in user
        assert "avatar_url" in user
        # Raw /user/emails shape
        emails = info["emails"]
        assert isinstance(emails, list)
        primary = next((e for e in emails if e["primary"]), None)
        assert primary is not None
        assert primary["verified"] is True

    def test_mock_github_userinfo_unverified_has_verified_false(
        self, mock_github_userinfo_unverified: dict
    ) -> None:
        """GitHub unverified fixture must have email_verified=False."""
        info = mock_github_userinfo_unverified
        assert info["email_verified"] is False
        primary = next((e for e in info["emails"] if e["primary"]), None)
        assert primary is not None
        assert primary["verified"] is False

    def test_mock_github_emails_verified_shape(
        self, mock_github_emails_verified: list
    ) -> None:
        """Each email entry must have required GitHub /user/emails fields."""
        for entry in mock_github_emails_verified:
            assert "email" in entry
            assert "primary" in entry
            assert "verified" in entry
            assert "visibility" in entry

    def test_mock_github_user_shape(self, mock_github_user: dict) -> None:
        """GitHub /user response must have required fields."""
        assert "login" in mock_github_user
        assert "id" in mock_github_user
        assert "avatar_url" in mock_github_user


class TestMockGoogleOidcShape:
    """Verify the Google OIDC mock fixture returns the correct claims."""

    def test_mock_google_oidc_id_token_claims(
        self, mock_google_id_token_claims_verified: dict
    ) -> None:
        """Google OIDC claims must include standard OIDC fields."""
        claims = mock_google_id_token_claims_verified
        assert claims["iss"] == "https://accounts.google.com"
        assert "sub" in claims
        assert "email" in claims
        assert claims["email_verified"] is True
        assert "name" in claims
        assert "picture" in claims

    def test_mock_google_oidc_unverified_claims(
        self, mock_google_id_token_claims_unverified: dict
    ) -> None:
        """Google OIDC unverified claims must have email_verified=False."""
        claims = mock_google_id_token_claims_unverified
        assert claims["email_verified"] is False

    def test_mock_google_userinfo_normalised(self, mock_google_userinfo: dict) -> None:
        """Normalised Google userinfo must expose provider/subject/email/email_verified."""
        info = mock_google_userinfo
        assert info["provider"] == "google"
        assert info["email_verified"] is True
        assert "@" in info["email"]

    def test_mock_google_userinfo_unverified(
        self, mock_google_userinfo_unverified: dict
    ) -> None:
        """Normalised Google unverified userinfo must have email_verified=False."""
        assert mock_google_userinfo_unverified["email_verified"] is False


class TestMockGitlabShape:
    """Verify the GitLab mock fixture shapes."""

    def test_mock_gitlab_user_verified_has_confirmed_at(
        self, mock_gitlab_user_verified: dict
    ) -> None:
        """GitLab verified user must have a non-null confirmed_at."""
        assert mock_gitlab_user_verified["confirmed_at"] is not None

    def test_mock_gitlab_user_unverified_has_null_confirmed_at(
        self, mock_gitlab_user_unverified: dict
    ) -> None:
        """GitLab unverified user must have confirmed_at=None."""
        assert mock_gitlab_user_unverified["confirmed_at"] is None

    def test_mock_gitlab_userinfo_normalised(self, mock_gitlab_userinfo: dict) -> None:
        """Normalised GitLab userinfo must have email_verified=True."""
        assert mock_gitlab_userinfo["provider"] == "gitlab"
        assert mock_gitlab_userinfo["email_verified"] is True

    def test_mock_gitlab_userinfo_unverified(
        self, mock_gitlab_userinfo_unverified: dict
    ) -> None:
        """Normalised GitLab unverified userinfo must have email_verified=False."""
        assert mock_gitlab_userinfo_unverified["email_verified"] is False


class TestMockMicrosoftShape:
    """Verify the Microsoft OIDC mock fixture shapes."""

    def test_mock_microsoft_id_token_has_sub(
        self, mock_microsoft_id_token_claims_verified: dict
    ) -> None:
        """Microsoft id_token must have sub, oid, and name."""
        claims = mock_microsoft_id_token_claims_verified
        assert "sub" in claims
        assert "oid" in claims
        assert "name" in claims

    def test_mock_microsoft_me_response_shape(
        self, mock_microsoft_me_response: dict
    ) -> None:
        """Microsoft /v1.0/me must have id, displayName, mail, userPrincipalName."""
        me = mock_microsoft_me_response
        assert "id" in me
        assert "displayName" in me
        assert "mail" in me
        assert "userPrincipalName" in me

    def test_mock_microsoft_userinfo_normalised(
        self, mock_microsoft_userinfo: dict
    ) -> None:
        """Normalised Microsoft userinfo must have email_verified=True when email present."""
        info = mock_microsoft_userinfo
        assert info["provider"] == "microsoft"
        assert info["email_verified"] is True
        assert info["email"] is not None

    def test_mock_microsoft_userinfo_unverified(
        self, mock_microsoft_userinfo_unverified: dict
    ) -> None:
        """Normalised Microsoft unverified userinfo must have email_verified=False."""
        info = mock_microsoft_userinfo_unverified
        assert info["email_verified"] is False
        assert info["email"] is None


def test_setup_mode_auto_disabled_after_first_admin(monkeypatch: pytest.MonkeyPatch) -> None:
    """After the first admin user is created in setup mode, SETUP_MODE_ENABLED must be False."""
    provider = "github"
    _patch_callback(monkeypatch, provider, state=_oauth_state(provider), verified=True)

    assert auth_router.settings.SETUP_MODE_ENABLED is True

    client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "legit-code", "state": "valid-state"},
        follow_redirects=False,
    )

    assert auth_router.settings.SETUP_MODE_ENABLED is False
