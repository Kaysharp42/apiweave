from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict
from pymongo import ASCENDING, IndexModel


class Workspace(Document):
    workspaceId: str
    slug: str
    name: str
    description: str | None = None
    ownerType: str  # "user" | "organization"
    ownerUserId: str | None = None
    orgId: str | None = None
    isPersonal: bool = False
    createdAt: datetime
    updatedAt: datetime
    deletedAt: datetime | None = None

    class Settings:
        name = "workspaces"
        indexes = [
            IndexModel([("workspaceId", ASCENDING)], unique=True),
            IndexModel(
                [("ownerType", ASCENDING), ("ownerUserId", ASCENDING), ("slug", ASCENDING)],
                unique=True,
            ),
            # Partial: without this filter, all personal workspaces (orgId=null) collide on slug.
            IndexModel(
                [("orgId", ASCENDING), ("slug", ASCENDING)],
                unique=True,
                partialFilterExpression={"orgId": {"$type": "string"}},
            ),
        ]


class WorkspaceMember(Document):
    memberId: str
    workspaceId: str
    userId: str
    role: str  # WorkspaceRole value
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "workspace_members"
        indexes = [
            IndexModel([("memberId", ASCENDING)], unique=True),
            IndexModel([("workspaceId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class OutsideCollaborator(Document):
    collaboratorId: str
    workspaceId: str
    userId: str
    role: str = "read"
    grantedBy: str
    createdAt: datetime

    class Settings:
        name = "outside_collaborators"
        indexes = [
            IndexModel([("collaboratorId", ASCENDING)], unique=True),
            IndexModel([("workspaceId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class OutsideCollaboratorResponse(BaseModel):
    """Outside collaborator representation."""

    model_config = ConfigDict(from_attributes=True)

    collaboratorId: str
    workspaceId: str
    userId: str
    role: str
    grantedBy: str
    createdAt: datetime
