"""
MCP schemas for webhook lifecycle tools.

Defines DTOs for webhook create/list/get/update/delete, credential rotation, and logs.
Enforces one-time credential return only for create/rotation responses.
All normal read responses redact token and HMAC secret values.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class WebhookSummary(BaseModel):
    """Redacted webhook summary for list responses — no credentials."""

    webhook_id: str = Field(alias="webhookId")
    resource_type: str = Field(alias="resourceType")
    resource_id: str = Field(alias="resourceId")
    environment_id: str = Field(alias="environmentId")
    enabled: bool
    description: str | None = None
    created_at: datetime | None = Field(alias="createdAt", default=None)
    last_used: datetime | None = Field(alias="lastUsed", default=None)
    usage_count: int = Field(alias="usageCount", default=0)
    last_status: str | None = Field(alias="lastStatus", default=None)


class WebhookDetail(BaseModel):
    """Redacted webhook detail for get/update responses — no credentials."""

    webhook_id: str = Field(alias="webhookId")
    url: str
    resource_type: str = Field(alias="resourceType")
    resource_id: str = Field(alias="resourceId")
    environment_id: str = Field(alias="environmentId")
    enabled: bool
    description: str | None = None
    created_at: datetime | None = Field(alias="createdAt", default=None)
    updated_at: datetime | None = Field(alias="updatedAt", default=None)
    last_used: datetime | None = Field(alias="lastUsed", default=None)
    usage_count: int = Field(alias="usageCount", default=0)
    last_status: str | None = Field(alias="lastStatus", default=None)


class WebhookCredentialResponse(BaseModel):
    """One-time credential response for create/rotate operations.

    WARNING: This is the ONLY response shape that returns raw credentials.
    All other webhook responses MUST redact token and hmacSecret.
    """

    webhook_id: str = Field(alias="webhookId")
    url: str
    token: str = Field(description="⚠️ One-time display — save immediately!")
    hmac_secret: str = Field(
        alias="hmacSecret", description="⚠️ One-time display — save immediately!"
    )
    one_time_display: bool = Field(
        default=True,
        description="WARNING: These credentials are shown ONLY ONCE. Save them now.",
    )
    warning: str = "⚠️ Save these credentials now! They will not be shown again."


class WebhookLogEntry(BaseModel):
    """Redacted webhook log entry — sensitive payload fields removed."""

    log_id: str = Field(alias="logId")
    timestamp: datetime
    status: str
    duration: int
    response_status: int = Field(alias="responseStatus")
    error_message: str | None = Field(alias="errorMessage", default=None)
    run_id: str | None = Field(alias="runId", default=None)
    collection_run_id: str | None = Field(alias="collectionRunId", default=None)


class WebhookListResponse(BaseModel):
    webhooks: list[WebhookSummary]
    total: int
    skip: int = 0
    limit: int = 50
    has_more: bool = False


class WebhookGetResponse(BaseModel):
    webhook: WebhookDetail


class WebhookCreateResponse(BaseModel):
    message: str
    webhook: WebhookCredentialResponse


class WebhookUpdateResponse(BaseModel):
    message: str
    webhook: WebhookDetail


class WebhookDeleteResponse(BaseModel):
    message: str
    webhook_id: str = Field(alias="webhookId")


class WebhookRotateResponse(BaseModel):
    message: str
    webhook: WebhookCredentialResponse


class WebhookLogsResponse(BaseModel):
    webhook_id: str = Field(alias="webhookId")
    total: int
    offset: int
    limit: int
    has_more: bool = False
    logs: list[WebhookLogEntry]


def webhook_to_summary(webhook: Any) -> WebhookSummary:
    """Convert a webhook document to a redacted summary."""
    return WebhookSummary(
        webhookId=getattr(webhook, "webhookId"),
        resourceType=getattr(webhook, "resourceType"),
        resourceId=getattr(webhook, "resourceId"),
        environmentId=getattr(webhook, "environmentId"),
        enabled=getattr(webhook, "enabled", True),
        description=getattr(webhook, "description", None),
        createdAt=getattr(webhook, "createdAt", None),
        lastUsed=getattr(webhook, "lastUsed", None),
        usageCount=getattr(webhook, "usageCount", 0),
        lastStatus=getattr(webhook, "lastStatus", None),
    )


def webhook_to_detail(webhook: Any, base_url: str) -> WebhookDetail:
    """Convert a webhook document to a redacted detail DTO."""
    resource_type_path = (
        "workflows" if getattr(webhook, "resourceType") == "workflow" else "collections"
    )
    return WebhookDetail(
        webhookId=getattr(webhook, "webhookId"),
        url=f"{base_url}/api/webhooks/{resource_type_path}/{webhook.webhookId}/execute",
        resourceType=getattr(webhook, "resourceType"),
        resourceId=getattr(webhook, "resourceId"),
        environmentId=getattr(webhook, "environmentId"),
        enabled=getattr(webhook, "enabled", True),
        description=getattr(webhook, "description", None),
        createdAt=getattr(webhook, "createdAt", None),
        updatedAt=getattr(webhook, "updatedAt", None),
        lastUsed=getattr(webhook, "lastUsed", None),
        usageCount=getattr(webhook, "usageCount", 0),
        lastStatus=getattr(webhook, "lastStatus", None),
    )


def webhook_log_to_entry(log: Any) -> WebhookLogEntry:
    """Convert a webhook log document to a redacted entry."""
    return WebhookLogEntry(
        logId=getattr(log, "logId"),
        timestamp=getattr(log, "timestamp"),
        status=getattr(log, "status"),
        duration=getattr(log, "duration"),
        responseStatus=getattr(log, "responseStatus"),
        errorMessage=getattr(log, "errorMessage", None),
        runId=getattr(log, "runId", None),
        collectionRunId=getattr(log, "collectionRunId", None),
    )
