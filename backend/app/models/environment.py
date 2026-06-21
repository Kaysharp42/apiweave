from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class EnvironmentProtectionPolicy(BaseModel):
    """Protection policy for a scoped environment."""

    requiredReviewers: list[str] = Field(default_factory=list)  # userIds
    allowSelfApproval: bool = False
    bypassPolicy: Literal["none", "trusted_token_only"] = "none"
    bypassAllowlist: list[str] = Field(default_factory=list)  # serviceTokenIds


class EnvironmentCreate(BaseModel):
    """Request model for creating an environment"""

    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)  # NEW: Secrets


class EnvironmentUpdate(BaseModel):
    """Request model for updating an environment"""

    name: str | None = None
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] | None = None
    secrets: dict[str, Any] | None = None  # NEW: Secrets


class Environment(Document):
    """Environment model with variables and secrets - Beanie Document

    Scoped to user, organization, or workspace. No global isActive.
    Each workspace has exactly one default environment (isDefault=True).
    Organization environments can restrict access via allowedWorkspaceIds.
    """

    environmentId: str
    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any] = Field(default_factory=dict)  # str (legacy) or EncryptedBlob dict
    scopeType: Literal["user", "organization", "workspace"] = "user"
    scopeId: str | None = None  # userId, orgId, or workspaceId
    ownerType: str | None = None  # "user" | "organization"
    isDefault: bool = False  # True for the default workspace environment
    allowedWorkspaceIds: list[str] = Field(
        default_factory=list
    )  # Org env policy: which workspaces can use this env
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "environments"
        indexes = [
            IndexModel([("environmentId", ASCENDING)], unique=True),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("isDefault", ASCENDING)]
            ),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class ScopedEnvironmentCreate(BaseModel):
    """Request model for creating a scoped environment."""

    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    allowedWorkspaceIds: list[str] = Field(default_factory=list)  # Org env policy


class ScopedEnvironmentUpdate(BaseModel):
    """Request model for updating a scoped environment."""

    name: str | None = None
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] | None = None
    allowedWorkspaceIds: list[str] | None = None  # Org env policy


class EnvironmentProtectionUpdate(BaseModel):
    """Request model for updating environment protection config."""

    requiredReviewers: list[str] | None = None
    allowSelfApproval: bool | None = None
    bypassPolicy: Literal["none", "trusted_token_only"] | None = None
    bypassAllowlist: list[str] | None = None


class EnvironmentProtection(Document):
    protectionId: str
    environmentId: str
    requiredReviewers: list[str] = Field(default_factory=list)
    allowSelfApproval: bool = False
    bypassPolicy: str = "none"
    bypassAllowlist: list[str] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "environment_protections"
        indexes = [
            IndexModel([("protectionId", ASCENDING)], unique=True),
            IndexModel([("environmentId", ASCENDING)], unique=True),
        ]
