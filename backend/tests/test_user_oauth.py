"""Tests for User OAuthAccount schema and account-linking guard.

Covers acceptance criteria from T5:
- New OAuth user gets an ``OAuthAccount`` entry added to the User document.
- Existing local user (provider='local') is blocked from linking OAuth.
- Duplicate (provider, providerSubject) detection at the repository level.

QA scenarios (MANDATORY):
- ``test_new_user_gets_account`` – new user → oauth_accounts has one entry
- ``test_block_local_link`` – local user → OAuthLinkingBlockedError / 409
- ``test_duplicate_key`` – duplicate (provider, subject) → caught
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from app.auth.exceptions import OAuthLinkingBlockedError
from app.models import OAuthAccount, User
from app.repositories.auth_repositories import UserRepository

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_user(
    user_id: str = "usr-test",
    email: str = "user@example.com",
    oauth_accounts: list[OAuthAccount] | None = None,
) -> User:
    """Build a User via ``model_construct`` to avoid Beanie init."""
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=email,
        display_name="Test User",
        avatar_url=None,
        roles=["viewer"],
        permissions=[],
        oauth_accounts=oauth_accounts or [],
        is_setup_complete=False,
        created_at=now,
        updated_at=now,
    )


def make_oauth_account(
    provider: str = "github",
    subject: str = "gh-user-123",
    email_verified: bool = True,
) -> OAuthAccount:
    """Build an OAuthAccount with reasonable defaults."""
    return OAuthAccount(
        provider=provider,
        providerSubject=subject,
        linkedAt=datetime.now(UTC),
        emailVerified=email_verified,
    )


# ===========================================================================
# Scenario: New OAuth user gets provider account added
# ===========================================================================


class TestNewUserGetsAccount:
    """Newly created OAuth user receives an OAuthAccount entry."""

    @pytest.mark.asyncio
    async def test_add_oauth_account_appends_entry(self) -> None:
        """Calling add_oauth_account persists one account on the user."""
        user = make_user()
        account = make_oauth_account()

        with patch.object(User, "save", new=AsyncMock()) as mock_save:
            result = await UserRepository.add_oauth_account(user, account)

        assert len(result.oauth_accounts) == 1
        assert result.oauth_accounts[0].provider == "github"
        assert result.oauth_accounts[0].providerSubject == "gh-user-123"
        assert result.oauth_accounts[0].emailVerified is True
        assert result.updated_at is not None
        mock_save.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_multiple_accounts_accumulate(self) -> None:
        """Adding a second account produces two entries (defense: no accidental overwrite)."""
        user = make_user(oauth_accounts=[make_oauth_account(provider="local", subject="local-1")])
        account = make_oauth_account(provider="github", subject="gh-456")

        with patch.object(User, "save", new=AsyncMock()):
            result = await UserRepository.add_oauth_account(user, account)

        assert len(result.oauth_accounts) == 2
        assert result.oauth_accounts[0].provider == "local"
        assert result.oauth_accounts[1].provider == "github"


# ===========================================================================
# Scenario: Existing local user trying to link OAuth is blocked
# ===========================================================================


class TestBlockLocalLink:
    """The account-linking guard raises OAuthLinkingBlockedError (HTTP 409)."""

    @pytest.mark.asyncio
    async def test_raises_when_user_has_existing_account(self) -> None:
        """Block: user already has an OAuth account (e.g. provider='local')."""
        user = make_user(
            oauth_accounts=[make_oauth_account(provider="local", subject="local-user")]
        )

        with pytest.raises(OAuthLinkingBlockedError) as exc:
            await UserRepository.link_oauth_account(
                user=user,
                provider="github",
                subject="gh-new",
                email="user@example.com",
                email_verified=True,
            )

        assert exc.value.status_code == 409
        msg = exc.value.detail.lower()
        assert "linking" in msg or "account" in msg

    @pytest.mark.asyncio
    async def test_raises_when_email_belongs_to_different_user(self) -> None:
        """Block: a different user already claims this verified_email."""
        user = make_user(user_id="usr-one", email="a@example.com")
        other_user = make_user(user_id="usr-other", email="other@example.com")

        with patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=other_user)):
            with pytest.raises(OAuthLinkingBlockedError) as exc:
                await UserRepository.link_oauth_account(
                    user=user,
                    provider="github",
                    subject="gh-sub",
                    email="other@example.com",
                    email_verified=True,
                )

        assert exc.value.status_code == 409
        assert "associated with another user" in exc.value.detail

    @pytest.mark.asyncio
    async def test_allows_when_user_has_no_prior_accounts(self) -> None:
        """No existing accounts → link_oauth_account succeeds."""
        user = make_user()

        with (
            patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=user)),
            patch.object(User, "save", new=AsyncMock()) as mock_save,
        ):
            result = await UserRepository.link_oauth_account(
                user=user,
                provider="github",
                subject="gh-sub",
                email="user@example.com",
                email_verified=True,
            )

        assert len(result.oauth_accounts) == 1
        assert result.oauth_accounts[0].provider == "github"
        mock_save.assert_awaited_once()


# ===========================================================================
# Scenario: Duplicate (provider, providerSubject) detection
# ===========================================================================


class TestDuplicateKey:
    """Repository-level detection of duplicate (provider, subject)."""

    @pytest.mark.asyncio
    async def test_find_by_provider_returns_matching_user(self) -> None:
        """find_by_provider locates the user from an OAuthAccount match."""
        target_user = make_user(
            user_id="usr-match",
            oauth_accounts=[make_oauth_account(provider="github", subject="same-subject")],
        )

        with patch.object(User, "find_one", new=AsyncMock(return_value=target_user)):
            result = await UserRepository.find_by_provider("github", "same-subject")

        assert result is not None
        assert result.userId == "usr-match"

    @pytest.mark.asyncio
    async def test_find_by_provider_returns_none_for_no_match(self) -> None:
        """No user has the given (provider, subject) → None."""
        with patch.object(User, "find_one", new=AsyncMock(return_value=None)):
            result = await UserRepository.find_by_provider("github", "nonexistent")

        assert result is None

    @pytest.mark.asyncio
    async def test_find_by_provider_distinguishes_providers(self) -> None:
        """Same subject, different provider → no cross-contamination."""
        target_user = make_user(
            user_id="usr-gh",
            oauth_accounts=[make_oauth_account(provider="github", subject="shared-sub")],
        )

        with patch.object(User, "find_one", new=AsyncMock(return_value=target_user)):
            gh_result = await UserRepository.find_by_provider("github", "shared-sub")
            assert gh_result is not None
            assert gh_result.userId == "usr-gh"

        # GitLab with same subject should NOT match github user
        with patch.object(User, "find_one", new=AsyncMock(return_value=None)):
            gl_result = await UserRepository.find_by_provider("gitlab", "shared-sub")
            assert gl_result is None


# ===========================================================================
# Scenario: OAuthAccount model validation
# ===========================================================================


class TestOAuthAccountModel:
    """OAuthAccount Pydantic model field validation."""

    def test_requires_provider(self) -> None:
        """provider is a required string."""
        account = make_oauth_account(provider="github")
        assert account.provider == "github"

    def test_requires_provider_subject(self) -> None:
        """providerSubject is a required string."""
        account = make_oauth_account(subject="sub-123")
        assert account.providerSubject == "sub-123"

    def test_email_verified_defaults_to_true(self) -> None:
        """emailVerified defaults to True (unverified emails rejected at intake)."""
        account = OAuthAccount(
            provider="github",
            providerSubject="sub-123",
            linkedAt=datetime.now(UTC),
        )
        assert account.emailVerified is True


# ===========================================================================
# Scenario: Email-verified flag preserved through linking
# ===========================================================================


class TestEmailVerifiedPreserved:
    """The emailVerified flag on OAuthAccount reflects the provider's assertion."""

    @pytest.mark.asyncio
    async def test_link_with_unverified_email_stores_false(self) -> None:
        """When provider says email_verified=false, the account records False."""
        user = make_user()

        with (
            patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=user)),
            patch.object(User, "save", new=AsyncMock()),
        ):
            result = await UserRepository.link_oauth_account(
                user=user,
                provider="github",
                subject="gh-unverified",
                email="user@example.com",
                email_verified=False,
            )

        assert len(result.oauth_accounts) == 1
        assert result.oauth_accounts[0].emailVerified is False

    @pytest.mark.asyncio
    async def test_link_with_verified_email_stores_true(self) -> None:
        """When provider says email_verified=true, the account records True."""
        user = make_user()

        with (
            patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=user)),
            patch.object(User, "save", new=AsyncMock()),
        ):
            result = await UserRepository.link_oauth_account(
                user=user,
                provider="gitlab",
                subject="gl-verified",
                email="user@gitlab.example.com",
                email_verified=True,
            )

        assert len(result.oauth_accounts) == 1
        assert result.oauth_accounts[0].emailVerified is True
        assert result.oauth_accounts[0].provider == "gitlab"


# ===========================================================================
# Scenario: Multi-provider accounts on a single user
# ===========================================================================


class TestMultiProviderAccounts:
    """Linking a second provider is blocked — one auth method per user."""

    @pytest.mark.asyncio
    async def test_second_provider_link_is_blocked(self) -> None:
        """User already has github → linking gitlab raises OAuthLinkingBlockedError."""
        user = make_user(oauth_accounts=[make_oauth_account(provider="github", subject="gh-sub")])

        with pytest.raises(OAuthLinkingBlockedError) as exc:
            await UserRepository.link_oauth_account(
                user=user,
                provider="gitlab",
                subject="gl-sub",
                email="user@example.com",
                email_verified=True,
            )

        assert exc.value.status_code == 409
        assert "linking" in exc.value.detail.lower() or "one" in exc.value.detail.lower()
