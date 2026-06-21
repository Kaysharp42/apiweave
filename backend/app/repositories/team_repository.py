from datetime import UTC, datetime

from app.models import Team, TeamMember


class TeamRepository:
    @staticmethod
    async def create(
        team_id: str,
        org_id: str,
        slug: str,
        name: str,
        description: str | None = None,
    ) -> Team:
        now = datetime.now(UTC)
        team = Team(
            teamId=team_id,
            orgId=org_id,
            slug=slug,
            name=name,
            description=description,
            createdAt=now,
            updatedAt=now,
        )
        await team.insert()
        return team

    @staticmethod
    async def get_by_id(team_id: str) -> Team | None:
        return await Team.find_one(Team.teamId == team_id)

    @staticmethod
    async def get_by_slug(org_id: str, slug: str) -> Team | None:
        return await Team.find_one(
            Team.orgId == org_id,
            Team.slug == slug,
        )

    @staticmethod
    async def list_by_org(org_id: str) -> list[Team]:
        return await Team.find(Team.orgId == org_id).sort(Team.name).to_list()

    @staticmethod
    async def update(
        team_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        slug: str | None = None,
    ) -> Team | None:
        team = await TeamRepository.get_by_id(team_id)
        if not team:
            return None
        if name is not None:
            team.name = name
        if description is not None:
            team.description = description
        if slug is not None:
            team.slug = slug
        team.updatedAt = datetime.now(UTC)
        await team.save()
        return team

    @staticmethod
    async def delete(team_id: str) -> bool:
        team = await TeamRepository.get_by_id(team_id)
        if not team:
            return False
        await team.delete()
        return True

    @staticmethod
    async def add_member(
        member_id: str,
        team_id: str,
        user_id: str,
        role: str = "member",
    ) -> TeamMember:
        now = datetime.now(UTC)
        member = TeamMember(
            memberId=member_id,
            teamId=team_id,
            userId=user_id,
            role=role,
            createdAt=now,
        )
        await member.insert()
        return member

    @staticmethod
    async def get_member(team_id: str, user_id: str) -> TeamMember | None:
        return await TeamMember.find_one(
            TeamMember.teamId == team_id,
            TeamMember.userId == user_id,
        )

    @staticmethod
    async def list_members(team_id: str) -> list[TeamMember]:
        return await TeamMember.find(TeamMember.teamId == team_id).to_list()

    @staticmethod
    async def remove_member(team_id: str, user_id: str) -> bool:
        member = await TeamRepository.get_member(team_id, user_id)
        if not member:
            return False
        await member.delete()
        return True

    @staticmethod
    async def list_teams_for_user_in_org(user_id: str, org_id: str) -> list[Team]:
        memberships = await TeamMember.find(TeamMember.userId == user_id).to_list()
        team_ids = [m.teamId for m in memberships]
        if not team_ids:
            return []
        from beanie.operators import In

        return await Team.find(
            In(Team.teamId, team_ids),
            Team.orgId == org_id,
        ).to_list()
