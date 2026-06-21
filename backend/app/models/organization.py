from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict
from pymongo import ASCENDING, IndexModel


class Organization(Document):
    orgId: str
    slug: str
    name: str
    description: str | None = None
    avatarUrl: str | None = None
    ownerUserId: str
    createdAt: datetime
    updatedAt: datetime
    deletedAt: datetime | None = None

    class Settings:
        name = "organizations"
        indexes = [
            IndexModel([("orgId", ASCENDING)], unique=True),
            IndexModel([("slug", ASCENDING)], unique=True),
            IndexModel([("ownerUserId", ASCENDING)]),
        ]


class OrganizationMember(Document):
    memberId: str
    orgId: str
    userId: str
    role: str  # OrgMemberRole value
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "organization_members"
        indexes = [
            IndexModel([("memberId", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class OrganizationResponse(BaseModel):
    """Public organization representation."""

    model_config = ConfigDict(from_attributes=True)

    orgId: str
    slug: str
    name: str
    description: str | None = None
    avatarUrl: str | None = None
    ownerUserId: str
    createdAt: datetime
    updatedAt: datetime


class OrganizationMemberResponse(BaseModel):
    """Organization member representation."""

    model_config = ConfigDict(from_attributes=True)

    memberId: str
    orgId: str
    userId: str
    role: str
    createdAt: datetime
    updatedAt: datetime
