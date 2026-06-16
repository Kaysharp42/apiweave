from datetime import UTC, datetime
from typing import Optional

from app.models import Workspace, WorkspaceMember


class WorkspaceRepository:
    @staticmethod
    async def create(
        workspace_id: str,
        slug: str,
        name: str,
        owner_type: str,
        owner_user_id: str | None = None,
        org_id: str | None = None,
        is_personal: bool = False,
    ) -> Workspace:
        now = datetime.now(UTC)
        ws = Workspace(
            workspaceId=workspace_id,
            slug=slug,
            name=name,
            ownerType=owner_type,
            ownerUserId=owner_user_id,
            orgId=org_id,
            isPersonal=is_personal,
            createdAt=now,
            updatedAt=now,
        )
        await ws.insert()
        return ws

    @staticmethod
    async def get_by_id(workspace_id: str) -> Optional[Workspace]:
        return await Workspace.find_one(Workspace.workspaceId == workspace_id)

    @staticmethod
    async def get_personal_for_user(user_id: str) -> Optional[Workspace]:
        return await Workspace.find_one(
            Workspace.ownerType == "user",
            Workspace.ownerUserId == user_id,
            Workspace.isPersonal == True,  # noqa: E712
        )

    @staticmethod
    async def add_member(
        member_id: str,
        workspace_id: str,
        user_id: str,
        role: str,
    ) -> WorkspaceMember:
        now = datetime.now(UTC)
        member = WorkspaceMember(
            memberId=member_id,
            workspaceId=workspace_id,
            userId=user_id,
            role=role,
            createdAt=now,
            updatedAt=now,
        )
        await member.insert()
        return member

    @staticmethod
    async def get_member(workspace_id: str, user_id: str) -> Optional[WorkspaceMember]:
        return await WorkspaceMember.find_one(
            WorkspaceMember.workspaceId == workspace_id,
            WorkspaceMember.userId == user_id,
        )

    @staticmethod
    async def list_by_user(user_id: str) -> list[Workspace]:
        direct = await Workspace.find(Workspace.ownerUserId == user_id).to_list()
        member_recs = await WorkspaceMember.find(
            WorkspaceMember.userId == user_id
        ).to_list()
        member_ws_ids = {m.workspaceId for m in member_recs}
        for ws in direct:
            member_ws_ids.discard(ws.workspaceId)
        if member_ws_ids:
            from beanie.operators import In
            by_membership = await Workspace.find(
                In(Workspace.workspaceId, list(member_ws_ids))
            ).to_list()
            return direct + by_membership
        return direct
