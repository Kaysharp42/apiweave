from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ASCENDING, DESCENDING, IndexModel

# Actor types that can produce audit events
AuditActorType = Literal[
    "user",
    "org_app",
    "service_token",
    "mcp_client",
    "webhook_token",
    "system_migration",
]

# Scope types for audit events
AuditScopeType = Literal[
    "org",
    "workspace",
    "environment",
]


class AuditEvent(Document):
    """
    Append-only audit event.

    Records every significant action in the system with full context.
    NEVER stores secret values, ciphertext, or private keys.
    The repository layer exposes only append and query — no update or delete.
    """

    eventId: str
    actor: AuditActorType
    actorId: str
    action: str
    scope: AuditScopeType
    scopeId: str
    resourceType: str
    resourceId: str
    context: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime

    class Settings:
        name = "audit_events"
        indexes = [
            IndexModel(
                [("actor", ASCENDING), ("actorId", ASCENDING), ("eventId", ASCENDING)], unique=True
            ),
            IndexModel([("createdAt", DESCENDING)]),
            IndexModel([("action", ASCENDING)]),
            IndexModel([("scope", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel([("resourceType", ASCENDING), ("resourceId", ASCENDING)]),
        ]


class AuditEventCreate(BaseModel):
    """Request model for creating an audit event."""

    actor: AuditActorType
    actorId: str
    action: str
    scope: AuditScopeType
    scopeId: str
    resourceType: str
    resourceId: str
    context: dict[str, Any] = Field(default_factory=dict)


class AuditEventResponse(BaseModel):
    """
    Audit event returned in API responses.
    Safe to expose — contains no secret values.
    """

    model_config = ConfigDict(from_attributes=True)

    eventId: str
    actor: AuditActorType
    actorId: str
    action: str
    scope: AuditScopeType
    scopeId: str
    resourceType: str
    resourceId: str
    context: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime
