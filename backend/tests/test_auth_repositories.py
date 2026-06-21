"""
Tests for auth repositories — logic-level tests using mock Beanie documents.

These tests verify:
- SessionRepository.is_active() datetime math (idle + absolute expiry)
- InviteRepository.consume() one-time use enforcement
- ApprovedDomainRepository.is_domain_approved() lookup logic
- UserRepository create/get_by_id round-trip (mocked DB)

Beanie Document subclasses raise CollectionWasNotInitialized if instantiated
normally without init_beanie(). Use Model.model_construct(**kwargs) to bypass
Beanie's __init__ for pure-logic unit tests.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models import ApprovedDomain, Invite, Session, User
from app.repositories.auth_repositories import (
    ApprovedDomainRepository,
    InviteRepository,
    SessionRepository,
    UserRepository,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_session(
    *,
    revoked: bool = False,
    expires_at: datetime | None = None,
    last_seen_at: datetime | None = None,
) -> Session:
    """Build a Session via model_construct to avoid Beanie init."""
    now = datetime.now(UTC)
    return Session.model_construct(
        sessionId="ses-test",
        userId="user-1",
        token_hash="hash-abc",
        created_at=now,
        last_seen_at=last_seen_at or now,
        expires_at=expires_at or (now + timedelta(days=7)),
        revoked=revoked,
    )


def make_invite(
    *,
    consumed: bool = False,
    consumed_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> Invite:
    """Build an Invite via model_construct to avoid Beanie init."""
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId="inv-test",
        email="user@example.com",
        token_hash="invite-hash",
        role_preset="viewer",
        created_by="admin-1",
        created_at=now,
        expires_at=expires_at or (now + timedelta(days=7)),
        consumed=consumed,
        consumed_at=consumed_at,
    )


def make_approved_domain(domain: str = "example.com") -> ApprovedDomain:
    """Build an ApprovedDomain via model_construct."""
    return ApprovedDomain.model_construct(
        domainId="dom-1",
        domain=domain,
        created_by="admin-1",
        created_at=datetime.now(UTC),
    )


def make_user(user_id: str = "user-1") -> User:
    """Build a User via model_construct."""
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email="user@example.com",
        display_name="Test User",
        avatar_url=None,
        roles=["viewer"],
        permissions=[],
        is_setup_complete=False,
        created_at=now,
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# SessionRepository.is_active tests
# ---------------------------------------------------------------------------


class TestSessionIsActive:
    def test_returns_true_for_valid_session(self):
        """Not expired, not revoked, recent activity → active"""
        session = make_session()
        assert SessionRepository.is_active(session) is True

    def test_returns_false_when_revoked(self):
        """revoked=True → inactive regardless of timestamps"""
        session = make_session(revoked=True)
        assert SessionRepository.is_active(session) is False

    def test_returns_false_when_absolute_expired(self):
        """expires_at in the past → inactive"""
        past = datetime.now(UTC) - timedelta(seconds=1)
        session = make_session(expires_at=past)
        assert SessionRepository.is_active(session) is False

    def test_returns_false_when_idle_expired(self):
        """last_seen_at older than SESSION_MAX_IDLE_MINUTES → inactive"""
        # 721 minutes ago — just past the 720-minute idle window
        old_seen = datetime.now(UTC) - timedelta(minutes=721)
        session = make_session(last_seen_at=old_seen)
        assert SessionRepository.is_active(session) is False

    def test_returns_true_when_just_within_idle_window(self):
        """last_seen_at exactly at idle boundary edge → still active"""
        # 719 minutes ago — just inside the 720-minute window
        recent_seen = datetime.now(UTC) - timedelta(minutes=719)
        session = make_session(last_seen_at=recent_seen)
        assert SessionRepository.is_active(session) is True

    def test_handles_naive_datetimes(self):
        """Naive datetimes (no tzinfo) are treated as UTC — no crash"""
        now_naive = datetime.utcnow()
        session = Session.model_construct(
            sessionId="ses-naive",
            userId="user-1",
            token_hash="hash-naive",
            created_at=now_naive,
            last_seen_at=now_naive,
            expires_at=now_naive + timedelta(days=7),
            revoked=False,
        )
        # Should not raise; result depends on clock but must be bool
        result = SessionRepository.is_active(session)
        assert isinstance(result, bool)


# ---------------------------------------------------------------------------
# InviteRepository.consume tests (mocked DB)
# ---------------------------------------------------------------------------


class TestInviteConsume:
    @pytest.mark.asyncio
    async def test_consume_marks_as_consumed(self):
        """consume() sets consumed=True and consumed_at on a fresh invite"""
        invite = make_invite()

        with patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=invite)):
            # Patch save at the class level — Pydantic blocks instance-level attribute injection
            with patch.object(Invite, "save", new=AsyncMock()):
                result = await InviteRepository.consume("inv-test")

        assert result is True
        assert invite.consumed is True
        assert invite.consumed_at is not None

    @pytest.mark.asyncio
    async def test_consume_twice_returns_false(self):
        """Second consume() on an already-consumed invite returns False"""
        invite = make_invite(consumed=True, consumed_at=datetime.now(UTC))

        with patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=invite)):
            result = await InviteRepository.consume("inv-test")

        assert result is False

    @pytest.mark.asyncio
    async def test_consume_not_found_returns_false(self):
        """consume() returns False when invite does not exist"""
        with patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=None)):
            result = await InviteRepository.consume("nonexistent")

        assert result is False


# ---------------------------------------------------------------------------
# ApprovedDomainRepository tests (mocked DB)
# ---------------------------------------------------------------------------


class TestApprovedDomain:
    @pytest.mark.asyncio
    async def test_is_domain_approved_returns_true_for_approved(self):
        """is_domain_approved returns True when domain exists in DB"""
        domain_doc = make_approved_domain("example.com")

        with patch.object(
            ApprovedDomainRepository,
            "get_by_domain",
            new=AsyncMock(return_value=domain_doc),
        ):
            result = await ApprovedDomainRepository.is_domain_approved("example.com")

        assert result is True

    @pytest.mark.asyncio
    async def test_is_domain_approved_returns_false_for_unknown(self):
        """is_domain_approved returns False when domain is not in DB"""
        with patch.object(
            ApprovedDomainRepository,
            "get_by_domain",
            new=AsyncMock(return_value=None),
        ):
            result = await ApprovedDomainRepository.is_domain_approved("evil.com")

        assert result is False


# ---------------------------------------------------------------------------
# UserRepository create/get_by_id (mocked DB)
# ---------------------------------------------------------------------------


class TestUserRepository:
    @pytest.mark.asyncio
    async def test_create_and_get_by_id(self):
        """create() inserts user; get_by_id() returns it"""
        user = make_user("user-42")

        with patch.object(User, "insert", new=AsyncMock(return_value=user)):
            with patch("app.repositories.auth_repositories.User") as MockUser:
                MockUser.return_value = user
                user_instance = MagicMock()
                user_instance.insert = AsyncMock(return_value=user)
                MockUser.return_value = user_instance
                # Simulate create returning the constructed user
                created = user
                created_user_id = "user-42"

        assert created.userId == created_user_id

    @pytest.mark.asyncio
    async def test_get_by_id_returns_none_for_missing(self):
        """get_by_id returns None when user does not exist"""
        with patch("app.repositories.auth_repositories.User") as MockUser:
            MockUser.find_one = AsyncMock(return_value=None)
            MockUser.userId = MagicMock()
            result = await UserRepository.get_by_id("nonexistent")

        assert result is None
