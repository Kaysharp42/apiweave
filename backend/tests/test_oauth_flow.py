"""
OAuth flow tests — Task 4 TDD scaffolding.

Tests 1-6 are marked skip(reason="Requires Task 6 OAuth implementation") because
the actual OAuth callback routes do not exist yet.  They will be un-skipped in
Task 6 once the routes are wired up.

Tests 7-8 verify the fixture shapes immediately (no skip) so CI can confirm the
mock data is well-formed before Task 6 lands.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

# Import fixtures so pytest can discover them
from tests.fixtures.oauth_mocks import (  # noqa: F401
    mock_github_emails_unverified,
    mock_github_emails_verified,
    mock_github_user,
    mock_github_userinfo,
    mock_github_userinfo_unverified,
    mock_gitlab_user_unverified,
    mock_gitlab_user_verified,
    mock_gitlab_userinfo,
    mock_gitlab_userinfo_unverified,
    mock_google_id_token_claims_unverified,
    mock_google_id_token_claims_verified,
    mock_google_userinfo,
    mock_google_userinfo_unverified,
    mock_microsoft_id_token_claims_verified,
    mock_microsoft_me_response,
    mock_microsoft_userinfo,
    mock_microsoft_userinfo_unverified,
)

client = TestClient(app)

PROVIDERS = ["github", "gitlab", "google", "microsoft"]

# ---------------------------------------------------------------------------
# Tests 1-6: Implementation-dependent — skipped until Task 6
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires Task 6 OAuth implementation")
@pytest.mark.parametrize("provider", PROVIDERS)
def test_oauth_login_initiates_redirect(provider: str) -> None:
    """GET /api/auth/login/{provider} must return 302 with state in redirect URL."""
    response = client.get(f"/api/auth/login/{provider}", follow_redirects=False)
    assert response.status_code == 302
    location = response.headers.get("location", "")
    assert "state=" in location, f"Redirect URL missing state param: {location}"


@pytest.mark.skip(reason="Requires Task 6 OAuth implementation")
@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_tampered_state(provider: str) -> None:
    """Callback with a state value not matching server-side store must return 400."""
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "legit-code", "state": "tampered-state-value"},
    )
    assert response.status_code == 400
    detail = response.json().get("detail", "").lower()
    assert "state" in detail or "invalid" in detail


@pytest.mark.skip(reason="Requires Task 6 OAuth implementation")
@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_expired_state(provider: str) -> None:
    """Callback with an expired state token must return 400."""
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "legit-code", "state": "expired-state-value"},
    )
    assert response.status_code == 400
    detail = response.json().get("detail", "").lower()
    assert "expir" in detail or "state" in detail or "invalid" in detail


@pytest.mark.skip(reason="Requires Task 6 OAuth implementation")
@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_succeeds_with_verified_email(provider: str) -> None:
    """Happy-path callback with verified email must return 200 and set session cookie."""
    # Actual implementation will mock the provider token exchange and userinfo fetch.
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "valid-code", "state": "valid-state"},
    )
    assert response.status_code == 200
    # Session cookie must be set
    assert "session" in response.cookies or any(
        "session" in k.lower() for k in response.cookies
    )


@pytest.mark.skip(reason="Requires Task 6 OAuth implementation")
@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_unverified_email(provider: str) -> None:
    """Callback where provider reports unverified email must return 403."""
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "unverified-code", "state": "valid-state"},
    )
    assert response.status_code == 403
    detail = response.json().get("detail", "").lower()
    assert "verif" in detail or "email" in detail


@pytest.mark.skip(reason="Requires Task 6 OAuth implementation")
@pytest.mark.parametrize("provider", PROVIDERS)
def test_callback_rejects_missing_state_parameter(provider: str) -> None:
    """Callback with no state query parameter must return 400."""
    response = client.get(
        f"/api/auth/callback/{provider}",
        params={"code": "some-code"},
        # No 'state' param
    )
    assert response.status_code == 400


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
