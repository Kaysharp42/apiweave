from datetime import UTC, datetime
from typing import Optional

from app.models import Project


class ProjectRepository:
    @staticmethod
    async def create(
        project_id: str,
        name: str,
        workspace_id: str | None = None,
        org_id: str | None = None,
        owner_type: str | None = None,
        description: str | None = None,
    ) -> Project:
        now = datetime.now(UTC)
        project = Project(
            collectionId=project_id,
            projectId=project_id,
            name=name,
            workspaceId=workspace_id,
            orgId=org_id,
            ownerType=owner_type,
            description=description,
            createdAt=now,
            updatedAt=now,
        )
        await project.insert()
        return project

    @staticmethod
    async def get_by_id(project_id: str) -> Optional[Project]:
        return await Project.find_one(Project.collectionId == project_id)

    @staticmethod
    async def list_by_workspace(workspace_id: str) -> list[Project]:
        return await Project.find(
            Project.workspaceId == workspace_id
        ).sort(-Project.createdAt).to_list()
