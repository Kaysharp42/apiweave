from datetime import UTC, datetime

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
        color: str | None = None,
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
            color=color,
            createdAt=now,
            updatedAt=now,
        )
        await project.insert()
        return project

    @staticmethod
    async def get_by_id(project_id: str) -> Project | None:
        """Get project by projectId (alias for collectionId)."""
        return await Project.find_one(Project.projectId == project_id)

    @staticmethod
    async def get_by_project_id(project_id: str) -> Project | None:
        """Explicit alias — get project by its public projectId."""
        return await Project.find_one(Project.projectId == project_id)

    @staticmethod
    async def list_by_workspace(workspace_id: str) -> list[Project]:
        """List all projects in a workspace."""
        return await Project.find(
            Project.workspaceId == workspace_id
        ).sort(-Project.createdAt).to_list()

    @staticmethod
    async def update(
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        color: str | None = None,
    ) -> Project | None:
        """Update project fields. Returns updated project or None."""
        project = await ProjectRepository.get_by_id(project_id)
        if not project:
            return None
        if name is not None:
            project.name = name
        if description is not None:
            project.description = description
        if color is not None:
            project.color = color
        project.updatedAt = datetime.now(UTC)
        await project.save()
        return project

    @staticmethod
    async def delete(project_id: str) -> bool:
        """Permanently delete a project."""
        project = await ProjectRepository.get_by_id(project_id)
        if not project:
            return False
        await project.delete()
        return True

    @staticmethod
    async def count_by_workspace(workspace_id: str) -> int:
        """Count projects in a workspace."""
        return await Project.find(
            Project.workspaceId == workspace_id
        ).count()

    @staticmethod
    async def update_workflow_count(project_id: str) -> Project | None:
        """Recalculate and update the workflowCount for a project."""
        from app.repositories.workflow_repository import WorkflowRepository
        project = await ProjectRepository.get_by_id(project_id)
        if not project:
            return None
        count = await WorkflowRepository.count_by_collection(project_id)
        project.workflowCount = count
        project.updatedAt = datetime.now(UTC)
        await project.save()
        return project
