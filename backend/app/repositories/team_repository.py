from datetime import UTC, datetime
from typing import Optional

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
    async def get_by_id(team_id: str) -> Optional[Team]:
        return await Team.find_one(Team.teamId == team_id)

    @staticmethod
    async def list_by_org(org_id: str) -> list[Team]:
        return await Team.find(Team.orgId == org_id).sort(Team.name).to_list()

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
    async def list_members(team_id: str) -> list[TeamMember]:
        return await TeamMember.find(TeamMember.teamId == team_id).to_list()
