from datetime import UTC, datetime

from app.models import TeamPermissionGrant


class TeamPermissionGrantRepository:
    @staticmethod
    async def create(
        grant_id: str,
        team_id: str,
        org_id: str,
        resource_type: str,
        resource_id: str,
        permissions: list[str],
        granted_by: str,
    ) -> TeamPermissionGrant:
        now = datetime.now(UTC)
        grant = TeamPermissionGrant(
            grantId=grant_id,
            teamId=team_id,
            orgId=org_id,
            resourceType=resource_type,
            resourceId=resource_id,
            permissions=permissions,
            grantedBy=granted_by,
            createdAt=now,
        )
        await grant.insert()
        return grant

    @staticmethod
    async def get_by_id(grant_id: str) -> TeamPermissionGrant | None:
        return await TeamPermissionGrant.find_one(
            TeamPermissionGrant.grantId == grant_id
        )

    @staticmethod
    async def get_by_team_and_resource(
        team_id: str,
        resource_type: str,
        resource_id: str,
    ) -> TeamPermissionGrant | None:
        return await TeamPermissionGrant.find_one(
            TeamPermissionGrant.teamId == team_id,
            TeamPermissionGrant.resourceType == resource_type,
            TeamPermissionGrant.resourceId == resource_id,
        )

    @staticmethod
    async def list_by_team(team_id: str) -> list[TeamPermissionGrant]:
        return await TeamPermissionGrant.find(
            TeamPermissionGrant.teamId == team_id
        ).to_list()

    @staticmethod
    async def list_by_team_ids(team_ids: list[str]) -> list[TeamPermissionGrant]:
        if not team_ids:
            return []
        from beanie.operators import In
        return await TeamPermissionGrant.find(
            In(TeamPermissionGrant.teamId, team_ids)
        ).to_list()

    @staticmethod
    async def delete(grant_id: str) -> bool:
        grant = await TeamPermissionGrantRepository.get_by_id(grant_id)
        if not grant:
            return False
        await grant.delete()
        return True

    @staticmethod
    async def delete_by_team(team_id: str) -> int:
        grants = await TeamPermissionGrantRepository.list_by_team(team_id)
        for grant in grants:
            await grant.delete()
        return len(grants)
