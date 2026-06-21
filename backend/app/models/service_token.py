from datetime import datetime

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ASCENDING, IndexModel


class ServiceToken(Document):
    """
    Scoped service token for MCP/webhooks/workers.

    The raw token value is shown ONCE at creation/rotation time and never stored.
    Only the SHA-256 hash is persisted for validation. Tokens are scoped to a
    workspace or organization and carry explicit permissions.

    Revocation (revokedAt set) and scope narrowing immediately affect subsequent
    API/MCP/webhook calls — the token resolver checks scope and permissions on
    every request.
    """

    tokenId: str
    name: str
    tokenHash: str  # SHA-256 hash of the raw token value
    scopeType: str  # "workspace" | "organization"
    scopeId: str
    permissions: list[str] = Field(default_factory=list)
    createdBy: str  # userId of the creator
    createdAt: datetime
    expiresAt: datetime | None = None
    revokedAt: datetime | None = None
    lastUsedAt: datetime | None = None
    description: str | None = None

    class Settings:
        name = "service_tokens"
        indexes = [
            IndexModel([("tokenId", ASCENDING)], unique=True),
            IndexModel([("tokenHash", ASCENDING)], unique=True),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel([("createdBy", ASCENDING)]),
        ]


class ServiceTokenCreateRequest(BaseModel):
    """Request body for creating a scoped service token."""

    name: str
    description: str | None = None
    permissions: list[str] = Field(default_factory=list)
    expiresAt: datetime | None = None


class ServiceTokenCreateResponse(BaseModel):
    """
    Response at token creation time — includes the one-time raw token value.

    WARNING: The `token` field is shown ONLY once. Subsequent GET/metadata
    calls will NEVER return the token value.
    """

    tokenId: str
    name: str
    token: str  # One-time raw token value — shown only at creation
    scopeType: str
    scopeId: str
    permissions: list[str]
    createdAt: datetime
    expiresAt: datetime | None = None


class ServiceTokenMetadataResponse(BaseModel):
    """
    Service token metadata returned by list/get endpoints.

    NEVER includes the raw token value or hash.
    """

    model_config = ConfigDict(from_attributes=True)

    tokenId: str
    name: str
    description: str | None = None
    scopeType: str
    scopeId: str
    permissions: list[str]
    createdBy: str
    createdAt: datetime
    expiresAt: datetime | None = None
    revokedAt: datetime | None = None
    lastUsedAt: datetime | None = None


class ServiceTokenRotateResponse(BaseModel):
    """
    Response at token rotation time — includes the new one-time raw token value.

    The old token is immediately invalidated. The new token is shown ONLY once.
    """

    tokenId: str
    name: str
    token: str  # New one-time raw token value — shown only at rotation
    rotatedAt: datetime
