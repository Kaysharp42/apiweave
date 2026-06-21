from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ASCENDING, IndexModel


class Team(Document):
    teamId: str
    orgId: str
    slug: str
    name: str
    description: str | None = None
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "teams"
        indexes = [
            IndexModel([("teamId", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING), ("slug", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING)]),
        ]


class TeamMember(Document):
    memberId: str
    teamId: str
    userId: str
    role: str = "member"
    createdAt: datetime

    class Settings:
        name = "team_members"
        indexes = [
            IndexModel([("memberId", ASCENDING)], unique=True),
            IndexModel([("teamId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class TeamPermissionGrant(Document):
    """
    Permission grant from a team to a specific resource.

    Teams can be granted permissions on workspaces, environments, or secrets.
    When a user is a member of a team, they inherit all of the team's grants
    through the ScopedPermissionEvaluator's highest-allow-wins logic.
    """

    grantId: str
    teamId: str
    orgId: str
    resourceType: str  # "workspace" | "environment" | "secret"
    resourceId: str
    permissions: list[str] = Field(default_factory=list)
    grantedBy: str  # userId
    createdAt: datetime

    class Settings:
        name = "team_permission_grants"
        indexes = [
            IndexModel([("grantId", ASCENDING)], unique=True),
            IndexModel(
                [("teamId", ASCENDING), ("resourceType", ASCENDING), ("resourceId", ASCENDING)],
                unique=True,
            ),
            IndexModel([("teamId", ASCENDING)]),
            IndexModel([("orgId", ASCENDING)]),
        ]


class TeamResponse(BaseModel):
    """Public team representation."""

    model_config = ConfigDict(from_attributes=True)

    teamId: str
    orgId: str
    slug: str
    name: str
    description: str | None = None
    createdAt: datetime
    updatedAt: datetime


class TeamMemberResponse(BaseModel):
    """Team member representation."""

    model_config = ConfigDict(from_attributes=True)

    memberId: str
    teamId: str
    userId: str
    role: str
    createdAt: datetime


class TeamPermissionGrantResponse(BaseModel):
    """Team permission grant representation."""

    model_config = ConfigDict(from_attributes=True)

    grantId: str
    teamId: str
    orgId: str
    resourceType: str
    resourceId: str
    permissions: list[str] = Field(default_factory=list)
    grantedBy: str
    createdAt: datetime
