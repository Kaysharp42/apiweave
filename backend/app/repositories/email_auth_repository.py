"""Email auth token repository — single-use passwordless sign-in tokens."""

from __future__ import annotations

from datetime import UTC, datetime

from app.models import EmailAuthToken


class EmailAuthTokenRepository:
    @staticmethod
    async def create(
        token_id: str,
        token_hash: str,
        email: str,
        created_at: datetime,
        expires_at: datetime,
    ) -> EmailAuthToken:
        token = EmailAuthToken(
            tokenId=token_id,
            tokenHash=token_hash,
            email=email,
            createdAt=created_at,
            expires_at=expires_at,
        )
        await token.insert()
        return token

    @staticmethod
    async def get_by_hash(token_hash: str) -> EmailAuthToken | None:
        return await EmailAuthToken.find_one(EmailAuthToken.tokenHash == token_hash)

    @staticmethod
    async def consume(token_id: str) -> bool:
        """Mark a token consumed. Returns False if missing or already consumed
        (single-use enforcement)."""
        token = await EmailAuthToken.find_one(EmailAuthToken.tokenId == token_id)
        if not token or token.consumed:
            return False
        token.consumed = True
        token.consumed_at = datetime.now(UTC)
        await token.save()
        return True
