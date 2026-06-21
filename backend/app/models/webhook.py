from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class Webhook(Document):
    """
    Webhook for CI/CD integration

    Provides stable URL for workflow/collection execution
    that remains valid even when resource is edited.

    Webhooks execute as scoped actors (WebhookTokenActor) — NOT as the
    webhook creator's current user permissions. The workspaceId/scopeType/
    scopeId fields bind the webhook to a specific workspace scope.
    """

    webhookId: str  # e.g., "wh-abc123xyz789"

    # Resource binding (workflow or collection)
    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId

    # Environment binding
    environmentId: str

    # Scoped ownership (webhook actor scope)
    workspaceId: str | None = None
    scopeType: str = "workspace"  # "workspace" | "organization"
    scopeId: str | None = None  # workspaceId or orgId

    # Authentication (shown only once!)
    token: str  # Webhook token for X-Webhook-Token header
    hmacSecret: str  # HMAC secret for signature validation

    # Configuration
    enabled: bool = True
    description: str | None = None

    # Metadata
    createdAt: datetime
    createdBy: str | None = None  # userId
    updatedAt: datetime

    # Usage tracking
    lastUsed: datetime | None = None
    usageCount: int = 0
    lastStatus: Literal["success", "failure", "validation_error"] | None = None

    class Settings:
        name = "webhooks"
        indexes = [
            IndexModel([("webhookId", ASCENDING)], unique=True),
            IndexModel([("resourceType", ASCENDING), ("resourceId", ASCENDING)]),
            IndexModel([("environmentId", ASCENDING)]),
            IndexModel([("token", ASCENDING)], unique=True),
            IndexModel([("workspaceId", ASCENDING)]),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class WebhookLog(Document):
    """Track webhook execution history (auto-expires after 30 days)"""

    logId: str  # e.g., "log-abc123"
    webhookId: str

    # Execution details
    timestamp: datetime
    status: Literal["success", "failure", "validation_error"]
    duration: int  # milliseconds

    # Request information
    httpMethod: str | None = None
    requestHeaders: dict[str, str] = Field(default_factory=dict)
    requestBody: str | None = None
    ipAddress: str | None = None

    # Response information
    responseStatus: int
    responseBody: str | None = None
    errorMessage: str | None = None

    # Run tracking
    runId: str | None = None  # For workflow runs
    collectionRunId: str | None = None  # For collection runs

    class Settings:
        name = "webhook_logs"
        indexes = [
            IndexModel([("webhookId", ASCENDING), ("timestamp", DESCENDING)]),
            IndexModel([("timestamp", ASCENDING)], expireAfterSeconds=2592000),  # 30 days TTL
        ]


class IdempotencyKey(Document):
    webhookId: str
    idempotencyKey: str
    runId: str
    collectionRunId: str | None = None
    statusCode: int
    responseBody: dict[str, Any]
    expires_at: datetime

    class Settings:
        name = "idempotency_keys"
        indexes = [
            IndexModel([("webhookId", ASCENDING), ("idempotencyKey", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=86400),
        ]


class WebhookCreate(BaseModel):
    """Request model for creating a webhook"""

    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId
    environmentId: str
    workspaceId: str | None = None  # Scoped workspace binding
    description: str | None = None


class WebhookUpdate(BaseModel):
    """Request model for updating a webhook"""

    environmentId: str | None = None
    enabled: bool | None = None
    description: str | None = None


class WebhookTokenActor(BaseModel):
    """
    Webhook execution actor context.

    Webhooks execute as scoped actors with explicit workspace permissions,
    NOT as the webhook creator's current user permissions. This model
    captures the token's scope and permissions for the executor.
    """

    actorType: Literal["webhook_token"] = "webhook_token"
    tokenId: str
    webhookId: str
    scopeType: str  # "workspace" | "organization"
    scopeId: str
    permissions: list[str] = Field(default_factory=list)
