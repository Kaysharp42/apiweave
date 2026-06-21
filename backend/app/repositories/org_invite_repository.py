from datetime import UTC, datetime

from app.models import OrgInvite


class OrgInviteRepository:
    @staticmethod
    async def create(
        invite_id: str,
        org_id: str,
        email: str,
        token_hash: str,
        role: str,
        invited_by: str,
        expires_at: datetime,
    ) -> OrgInvite:
        now = datetime.now(UTC)
        invite = OrgInvite(
            inviteId=invite_id,
            orgId=org_id,
            email=email,
            token_hash=token_hash,
            role=role,
            invited_by=invited_by,
            created_at=now,
            expires_at=expires_at,
        )
        await invite.insert()
        return invite

    @staticmethod
    async def get_by_id(invite_id: str) -> OrgInvite | None:
        return await OrgInvite.find_one(OrgInvite.inviteId == invite_id)

    @staticmethod
    async def get_by_token_hash(token_hash: str) -> OrgInvite | None:
        return await OrgInvite.find_one(OrgInvite.token_hash == token_hash)

    @staticmethod
    async def find_active_by_org_and_email(org_id: str, email: str) -> OrgInvite | None:
        now = datetime.now(UTC)
        return await OrgInvite.find_one(
            OrgInvite.orgId == org_id,
            OrgInvite.email == email,
            OrgInvite.consumed == False,  # noqa: E712
            OrgInvite.expires_at > now,
        )

    @staticmethod
    async def list_pending_by_org(org_id: str) -> list[OrgInvite]:
        now = datetime.now(UTC)
        return (
            await OrgInvite.find(
                OrgInvite.orgId == org_id,
                OrgInvite.consumed == False,  # noqa: E712
                OrgInvite.expires_at > now,
            )
            .sort([("created_at", -1)])
            .to_list()
        )

    @staticmethod
    async def count_recent_by_org(org_id: str, since: datetime) -> int:
        return await OrgInvite.find(
            OrgInvite.orgId == org_id,
            OrgInvite.created_at >= since,
        ).count()

    @staticmethod
    async def consume(invite_id: str) -> bool:
        invite = await OrgInviteRepository.get_by_id(invite_id)
        if not invite or invite.consumed:
            return False
        invite.consumed = True
        invite.consumed_at = datetime.now(UTC)
        await invite.save()
        return True

    @staticmethod
    async def cancel(invite_id: str) -> bool:
        invite = await OrgInviteRepository.get_by_id(invite_id)
        if not invite:
            return False
        await invite.delete()
        return True
