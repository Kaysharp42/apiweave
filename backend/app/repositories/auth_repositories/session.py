from datetime import UTC, datetime, timedelta

from app.config import settings
from app.models import Session


class SessionRepository:
    """Repository for Session operations with idle/absolute expiry enforcement"""

    @staticmethod
    def is_active(session: Session) -> bool:
        """
        Pure-Python check — no DB call.

        A session is active when ALL of the following hold:
        1. Not revoked
        2. expires_at (absolute) has not passed
        3. last_seen_at is within the idle window (SESSION_MAX_IDLE_MINUTES)
        """
        if session.revoked:
            return False

        now = datetime.now(UTC)

        # Absolute expiry
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if now >= expires_at:
            return False

        # Idle expiry
        last_seen = session.last_seen_at
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=UTC)
        idle_deadline = last_seen + timedelta(minutes=settings.SESSION_MAX_IDLE_MINUTES)
        if now >= idle_deadline:
            return False

        return True

    @staticmethod
    async def create(
        session_id: str,
        user_id: str,
        token_hash: str,
        created_at: datetime,
        last_seen_at: datetime,
        expires_at: datetime,
    ) -> Session:
        """Create and persist a new session"""
        session = Session(
            sessionId=session_id,
            userId=user_id,
            token_hash=token_hash,
            created_at=created_at,
            last_seen_at=last_seen_at,
            expires_at=expires_at,
            revoked=False,
        )
        await session.insert()
        return session

    @staticmethod
    async def get_by_token_hash(token_hash: str) -> Session | None:
        """Find session by hashed token"""
        return await Session.find_one(Session.token_hash == token_hash)

    @staticmethod
    async def get_by_id(session_id: str) -> Session | None:
        """Find session by sessionId"""
        return await Session.find_one(Session.sessionId == session_id)

    @staticmethod
    async def get_active_sessions_for_user(user_id: str) -> list[Session]:
        """
        Return sessions for user that are not revoked and not absolutely expired.
        Idle expiry is checked in Python via is_active() — callers should filter
        further if they need strict idle enforcement.
        """
        now = datetime.now(UTC)
        sessions = await Session.find(
            Session.userId == user_id,
            Session.revoked == False,  # noqa: E712
            Session.expires_at > now,
        ).to_list()
        # Apply idle check in Python
        return [s for s in sessions if SessionRepository.is_active(s)]

    @staticmethod
    async def touch(session_id: str, last_seen_at: datetime) -> bool:
        """Update last_seen_at to extend idle window"""
        session = await SessionRepository.get_by_id(session_id)
        if not session:
            return False
        session.last_seen_at = last_seen_at
        await session.save()
        return True

    @staticmethod
    async def revoke(session_id: str) -> bool:
        """Mark a single session as revoked"""
        session = await SessionRepository.get_by_id(session_id)
        if not session:
            return False
        session.revoked = True
        await session.save()
        return True

    @staticmethod
    async def revoke_all_for_user(user_id: str) -> int:
        """
        Revoke all non-revoked sessions for a user (concurrent logout).
        Returns the number of sessions revoked.
        """
        sessions = await Session.find(
            Session.userId == user_id,
            Session.revoked == False,  # noqa: E712
        ).to_list()
        count = 0
        for session in sessions:
            session.revoked = True
            await session.save()
            count += 1
        return count

    @staticmethod
    async def delete_all_for_user(user_id: str) -> int:
        """Delete all sessions for a user. Returns count deleted."""
        sessions = await Session.find({"userId": user_id}).to_list()
        count = 0
        for session in sessions:
            await session.delete()
            count += 1
        return count
