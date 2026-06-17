"""
Outside Collaborator Repository — data access for OutsideCollaborator documents.

Outside collaborators are users granted limited access to a workspace
without being full members. They are typically contractors or partners.
"""
from datetime import UTC, datetime

from app.models import OutsideCollaborator


class OutsideCollaboratorRepository:
    @staticmethod
    async def create(
        collaborator_id: str,
        workspace_id: str,
        user_id: str,
        role: str,
        granted_by: str,
    ) -> OutsideCollaborator:
        now = datetime.now(UTC)
        collab = OutsideCollaborator(
            collaboratorId=collaborator_id,
            workspaceId=workspace_id,
            userId=user_id,
            role=role,
            grantedBy=granted_by,
            createdAt=now,
        )
        await collab.insert()
        return collab

    @staticmethod
    async def get_by_id(collaborator_id: str) -> OutsideCollaborator | None:
        return await OutsideCollaborator.find_one(
            OutsideCollaborator.collaboratorId == collaborator_id
        )

    @staticmethod
    async def get_by_workspace_and_user(
        workspace_id: str,
        user_id: str,
    ) -> OutsideCollaborator | None:
        return await OutsideCollaborator.find_one(
            OutsideCollaborator.workspaceId == workspace_id,
            OutsideCollaborator.userId == user_id,
        )

    @staticmethod
    async def list_by_workspace(workspace_id: str) -> list[OutsideCollaborator]:
        return await OutsideCollaborator.find(
            OutsideCollaborator.workspaceId == workspace_id
        ).to_list()

    @staticmethod
    async def list_by_user(user_id: str) -> list[OutsideCollaborator]:
        return await OutsideCollaborator.find(
            OutsideCollaborator.userId == user_id
        ).to_list()

    @staticmethod
    async def update_role(
        collaborator_id: str,
        role: str,
    ) -> OutsideCollaborator | None:
        collab = await OutsideCollaboratorRepository.get_by_id(collaborator_id)
        if not collab:
            return None
        collab.role = role
        await collab.save()
        return collab

    @staticmethod
    async def remove(collaborator_id: str) -> bool:
        collab = await OutsideCollaboratorRepository.get_by_id(collaborator_id)
        if not collab:
            return False
        await collab.delete()
        return True

    @staticmethod
    async def get_permissions_for_workspace(
        workspace_id: str,
        user_id: str,
    ) -> set[str] | None:
        """
        Get the effective permission set for an outside collaborator.
        Returns None if the user is not an outside collaborator.
        """
        from app.auth.permissions import WORKSPACE_ROLE_PERMISSIONS

        collab = await OutsideCollaboratorRepository.get_by_workspace_and_user(
            workspace_id, user_id
        )
        if not collab:
            return None
        return WORKSPACE_ROLE_PERMISSIONS.get(collab.role, set())
