"""
OAuth provider mock fixtures.

Shapes follow real provider API responses so tests remain valid when Task 6
wires up the actual OAuth callback handlers.

Provider notes:
- GitHub: NOT OIDC — uses /user + /user/emails REST endpoints
- GitLab: NOT OIDC — uses /user REST endpoint with confirmed_at field
- Google: OIDC — id_token claims + /userinfo endpoint
- Microsoft: OIDC — id_token claims + /v1.0/me endpoint
"""

import pytest


# ---------------------------------------------------------------------------
# GitHub fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_github_user():
    """Mock GitHub GET /user response."""
    return {
        "login": "testuser",
        "id": 12345678,
        "avatar_url": "https://avatars.githubusercontent.com/u/12345678?v=4",
        "name": "Test User",
        "email": None,  # May be null; primary email comes from /user/emails
        "html_url": "https://github.com/testuser",
        "type": "User",
        "site_admin": False,
    }


@pytest.fixture
def mock_github_emails_verified():
    """Mock GitHub GET /user/emails response — primary email is verified."""
    return [
        {
            "email": "testuser@example.com",
            "primary": True,
            "verified": True,
            "visibility": "private",
        },
        {
            "email": "testuser+secondary@example.com",
            "primary": False,
            "verified": True,
            "visibility": None,
        },
    ]


@pytest.fixture
def mock_github_emails_unverified():
    """Mock GitHub GET /user/emails response — primary email is NOT verified."""
    return [
        {
            "email": "testuser@example.com",
            "primary": True,
            "verified": False,
            "visibility": "private",
        },
    ]


@pytest.fixture
def mock_github_userinfo(mock_github_user, mock_github_emails_verified):
    """Combined GitHub userinfo: /user + /user/emails (verified primary email)."""
    return {
        "user": mock_github_user,
        "emails": mock_github_emails_verified,
        # Normalised fields used by the OAuth handler
        "provider": "github",
        "subject": str(mock_github_user["id"]),
        "email": "testuser@example.com",
        "email_verified": True,
        "name": mock_github_user["name"] or mock_github_user["login"],
        "avatar_url": mock_github_user["avatar_url"],
    }


@pytest.fixture
def mock_github_userinfo_unverified(mock_github_user, mock_github_emails_unverified):
    """Combined GitHub userinfo with unverified primary email."""
    return {
        "user": mock_github_user,
        "emails": mock_github_emails_unverified,
        "provider": "github",
        "subject": str(mock_github_user["id"]),
        "email": "testuser@example.com",
        "email_verified": False,
        "name": mock_github_user["name"] or mock_github_user["login"],
        "avatar_url": mock_github_user["avatar_url"],
    }


# ---------------------------------------------------------------------------
# GitLab fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_gitlab_user_verified():
    """Mock GitLab GET /user response — email confirmed."""
    return {
        "id": 9876543,
        "username": "testuser_gl",
        "email": "testuser@gitlab-example.com",
        "name": "Test User GL",
        "avatar_url": "https://secure.gravatar.com/avatar/abc123",
        "web_url": "https://gitlab.com/testuser_gl",
        "confirmed_at": "2024-01-15T10:30:00.000Z",
        "state": "active",
    }


@pytest.fixture
def mock_gitlab_user_unverified():
    """Mock GitLab GET /user response — email NOT confirmed (confirmed_at is null)."""
    return {
        "id": 9876543,
        "username": "testuser_gl",
        "email": "testuser@gitlab-example.com",
        "name": "Test User GL",
        "avatar_url": "https://secure.gravatar.com/avatar/abc123",
        "web_url": "https://gitlab.com/testuser_gl",
        "confirmed_at": None,
        "state": "active",
    }


@pytest.fixture
def mock_gitlab_userinfo(mock_gitlab_user_verified):
    """Normalised GitLab userinfo (verified email)."""
    user = mock_gitlab_user_verified
    return {
        "user": user,
        "provider": "gitlab",
        "subject": str(user["id"]),
        "email": user["email"],
        "email_verified": user["confirmed_at"] is not None,
        "name": user["name"],
        "avatar_url": user["avatar_url"],
    }


@pytest.fixture
def mock_gitlab_userinfo_unverified(mock_gitlab_user_unverified):
    """Normalised GitLab userinfo (unverified email)."""
    user = mock_gitlab_user_unverified
    return {
        "user": user,
        "provider": "gitlab",
        "subject": str(user["id"]),
        "email": user["email"],
        "email_verified": False,
        "name": user["name"],
        "avatar_url": user["avatar_url"],
    }


# ---------------------------------------------------------------------------
# Google OIDC fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_google_id_token_claims_verified():
    """Mock Google OIDC id_token claims — email_verified=true."""
    return {
        "iss": "https://accounts.google.com",
        "sub": "108204268537357903842",
        "aud": "test-client-id.apps.googleusercontent.com",
        "iat": 1700000000,
        "exp": 1700003600,
        "email": "testuser@gmail.com",
        "email_verified": True,
        "name": "Test User Google",
        "picture": "https://lh3.googleusercontent.com/a/test-photo",
        "given_name": "Test",
        "family_name": "User",
        "locale": "en",
    }


@pytest.fixture
def mock_google_id_token_claims_unverified():
    """Mock Google OIDC id_token claims — email_verified=false."""
    return {
        "iss": "https://accounts.google.com",
        "sub": "108204268537357903842",
        "aud": "test-client-id.apps.googleusercontent.com",
        "iat": 1700000000,
        "exp": 1700003600,
        "email": "testuser@gmail.com",
        "email_verified": False,
        "name": "Test User Google",
        "picture": "https://lh3.googleusercontent.com/a/test-photo",
        "given_name": "Test",
        "family_name": "User",
        "locale": "en",
    }


@pytest.fixture
def mock_google_userinfo(mock_google_id_token_claims_verified):
    """Normalised Google userinfo (verified email)."""
    claims = mock_google_id_token_claims_verified
    return {
        "claims": claims,
        "provider": "google",
        "subject": claims["sub"],
        "email": claims["email"],
        "email_verified": claims["email_verified"],
        "name": claims["name"],
        "avatar_url": claims["picture"],
    }


@pytest.fixture
def mock_google_userinfo_unverified(mock_google_id_token_claims_unverified):
    """Normalised Google userinfo (unverified email)."""
    claims = mock_google_id_token_claims_unverified
    return {
        "claims": claims,
        "provider": "google",
        "subject": claims["sub"],
        "email": claims["email"],
        "email_verified": claims["email_verified"],
        "name": claims["name"],
        "avatar_url": claims["picture"],
    }


# ---------------------------------------------------------------------------
# Microsoft OIDC fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_microsoft_id_token_claims_verified():
    """Mock Microsoft OIDC id_token claims — email present and verified."""
    return {
        "iss": "https://login.microsoftonline.com/common/v2.0",
        "sub": "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
        "aud": "test-ms-client-id",
        "iat": 1700000000,
        "exp": 1700003600,
        "oid": "00000000-0000-0000-66f3-3332eca7ea81",
        "preferred_username": "testuser@outlook.com",
        "email": "testuser@outlook.com",
        "name": "Test User Microsoft",
        "tid": "9188040d-6c67-4c5b-b112-36a304b66dad",
    }


@pytest.fixture
def mock_microsoft_me_response():
    """Mock Microsoft Graph GET /v1.0/me response."""
    return {
        "id": "00000000-0000-0000-66f3-3332eca7ea81",
        "displayName": "Test User Microsoft",
        "mail": "testuser@outlook.com",
        "userPrincipalName": "testuser@outlook.com",
        "givenName": "Test",
        "surname": "User",
        "jobTitle": None,
        "officeLocation": None,
    }


@pytest.fixture
def mock_microsoft_userinfo(
    mock_microsoft_id_token_claims_verified, mock_microsoft_me_response
):
    """Normalised Microsoft userinfo (verified — email present in token)."""
    claims = mock_microsoft_id_token_claims_verified
    me = mock_microsoft_me_response
    email = me.get("mail") or me.get("userPrincipalName") or claims.get("email")
    return {
        "claims": claims,
        "me": me,
        "provider": "microsoft",
        "subject": claims["sub"],
        "email": email,
        # Microsoft OIDC does not have an explicit email_verified claim;
        # presence of a confirmed email in the token is treated as verified.
        "email_verified": email is not None,
        "name": claims.get("name") or me.get("displayName"),
        "avatar_url": None,  # Graph /photo endpoint is separate
    }


@pytest.fixture
def mock_microsoft_userinfo_unverified():
    """Normalised Microsoft userinfo where no email can be resolved (treated as unverified)."""
    return {
        "claims": {
            "iss": "https://login.microsoftonline.com/common/v2.0",
            "sub": "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
            "aud": "test-ms-client-id",
            "iat": 1700000000,
            "exp": 1700003600,
            "oid": "00000000-0000-0000-66f3-3332eca7ea81",
            "name": "Test User Microsoft",
            "tid": "9188040d-6c67-4c5b-b112-36a304b66dad",
            # No email / preferred_username in token
        },
        "me": {
            "id": "00000000-0000-0000-66f3-3332eca7ea81",
            "displayName": "Test User Microsoft",
            "mail": None,
            "userPrincipalName": None,
        },
        "provider": "microsoft",
        "subject": "AAAAAAAAAAAAAAAAAAAAAIkzqFVrSaSaFHy782bbtaQ",
        "email": None,
        "email_verified": False,
        "name": "Test User Microsoft",
        "avatar_url": None,
    }
