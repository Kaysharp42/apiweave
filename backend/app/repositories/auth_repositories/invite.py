from datetime import UTC, datetime

from app.models import Invite


class InviteRepository:
    """Repository for Invite operations with one-time consumption enforcement"""

    @staticmethod
    async def create(
        invite_id: str,
        email: str,
        token_hash: str,
        role_preset: str,
        created_by: str,
        created_at: datetime,
        expires_at: datetime,
        invite_url: str,
    ) -> Invite:
        """Create and persist an invite. token_hash must be pre-hashed by caller."""
        invite = Invite(
            inviteId=invite_id,
            email=email,
            token_hash=token_hash,
            role_preset=role_preset,
            created_by=created_by,
            created_at=created_at,
            expires_at=expires_at,
            consumed=False,
            consumed_at=None,
            invite_url=invite_url,
        )
        await invite.insert()
        return invite

    @staticmethod
    async def get_by_token_hash(token_hash: str) -> Invite | None:
        """Find invite by hashed token"""
        return await Invite.find_one(Invite.token_hash == token_hash)

    @staticmethod
    async def get_by_id(invite_id: str) -> Invite | None:
        """Find invite by inviteId"""
        return await Invite.find_one(Invite.inviteId == invite_id)

    @staticmethod
    async def get_valid_by_email(email: str) -> list[Invite]:
        """Return invites for email that are not consumed and not expired"""
        now = datetime.now(UTC)
        return await Invite.find(
            Invite.email == email,
            Invite.consumed == False,  # noqa: E712
            Invite.expires_at > now,
        ).to_list()

    @staticmethod
    async def find_active_by_email(email: str) -> Invite | None:
        """Find an unconsumed, unexpired invite by case-insensitive email."""
        now = datetime.now(UTC)
        return await Invite.find_one(
            {
                "$expr": {"$eq": [{"$toLower": "$email"}, email.lower()]},
                "consumed": False,
                "expires_at": {"$gt": now},
            }
        )

    @staticmethod
    async def update_role(invite_id: str, role_preset: str) -> Invite | None:
        """Update an invite role preset; returns None when missing."""
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return None
        await invite.update({"$set": {"role_preset": role_preset}})
        invite.role_preset = role_preset
        return invite

    @staticmethod
    async def delete_invite(invite_id: str) -> bool:
        """Delete invite; returns True if deleted, False if not found."""
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        await invite.delete()
        return True

    @staticmethod
    async def consume(invite_id: str) -> bool:
        """
        Mark invite as consumed (one-time use).
        Returns False if already consumed or not found.
        """
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        if invite.consumed:
            return False
        invite.consumed = True
        invite.consumed_at = datetime.now(UTC)
        await invite.save()
        return True

    @staticmethod
    async def unconsume(invite_id: str) -> bool:
        """Restore a consumed invite (rollback on user-creation failure).
        Returns True if restored, False if not found or was not consumed."""
        invite = await InviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        if not invite.consumed:
            return False
        invite.consumed = False
        invite.consumed_at = None
        await invite.save()
        return True

    @staticmethod
    async def get_all() -> list[Invite]:
        """Return all invites"""
        return await Invite.find_all().to_list()

    @staticmethod
    async def list_pending() -> list[Invite]:
        """Return unconsumed, unexpired invites"""
        now = datetime.now(UTC)
        return await Invite.find(
            Invite.consumed == False,  # noqa: E712
            Invite.expires_at > now,
        ).to_list()
