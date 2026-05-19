"""
MCP webhook lifecycle tools — CRUD, credential rotation, and logs.

Uses shared contracts for structured errors and webhook schemas for redacted DTOs.
"""
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.config import settings
from app.mcp.collection_run_readiness import COLLECTION_RUN_READINESS
from app.mcp.contracts import (
    REDACTION_PLACEHOLDER,
    make_not_found_error,
    make_validation_error,
)
from app.mcp.database import ensure_mcp_database
from app.mcp.schemas.webhooks import (
    WebhookCreateResponse,
    WebhookDeleteResponse,
    WebhookDetail,
    WebhookGetResponse,
    WebhookListResponse,
    WebhookLogEntry,
    WebhookLogsResponse,
    WebhookRotateResponse,
    WebhookSummary,
    webhook_log_to_entry,
    webhook_to_detail,
    webhook_to_summary,
)
from app.models import Webhook
from app.repositories import WebhookRepository


async def webhook_list(
    resource_type: Annotated[
        str | None,
        Field(description="Filter by resource type: 'workflow' or 'collection'."),
    ] = None,
    resource_id: Annotated[
        str | None,
        Field(description="Filter by resource ID (workflowId or collectionId)."),
    ] = None,
    skip: Annotated[int, Field(ge=0, description="Number of webhooks to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum webhooks to return.")] = 50,
) -> WebhookListResponse:
    """List webhooks with optional resource filter and pagination."""
    await ensure_mcp_database()

    if resource_type and resource_id:
        webhooks = await WebhookRepository.get_by_resource(resource_type, resource_id)
    elif resource_type:
        all_webhooks = await WebhookRepository.list_all(skip=0, limit=1000)
        webhooks = [wh for wh in all_webhooks if wh.resourceType == resource_type]
    else:
        webhooks = await WebhookRepository.list_all(skip=skip, limit=limit)

    total = await WebhookRepository.count()
    summaries = [webhook_to_summary(wh) for wh in webhooks]

    return WebhookListResponse(
        webhooks=summaries,
        total=total,
        skip=skip,
        limit=limit,
        has_more=(skip + limit) < total,
    )


async def webhook_get(
    webhook_id: Annotated[str, Field(description="Webhook ID to retrieve.")],
) -> WebhookGetResponse:
    """Get webhook details with credentials redacted."""
    await ensure_mcp_database()
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise ValueError(make_not_found_error("Webhook", webhook_id, "webhook_list").model_dump_json())
    return WebhookGetResponse(webhook=webhook_to_detail(webhook, settings.BASE_URL))


async def webhook_create(
    resource_type: Annotated[str, Field(description="Resource type: 'workflow' or 'collection'.")],
    resource_id: Annotated[str, Field(description="Resource ID (workflowId or collectionId).")],
    environment_id: Annotated[str, Field(description="Environment ID for execution.")],
    description: Annotated[str | None, Field(description="Optional description.")] = None,
) -> WebhookCreateResponse:
    """Create a webhook. Returns one-time credentials — save immediately."""
    import secrets
    import uuid
    from datetime import datetime, UTC

    await ensure_mcp_database()

    # Verify resource exists
    if resource_type == "workflow":
        from app.repositories import WorkflowRepository
        resource = await WorkflowRepository.get_by_id(resource_id)
        if not resource:
            raise ValueError(make_not_found_error("Workflow", resource_id).model_dump_json())
    elif resource_type == "collection":
        from app.repositories import CollectionRepository
        resource = await CollectionRepository.get_by_id(resource_id)
        if not resource:
            raise ValueError(make_not_found_error("Collection", resource_id).model_dump_json())
    else:
        raise ValueError(make_validation_error(f"Invalid resource_type: {resource_type}").model_dump_json())

    webhook_id = f"wh-{uuid.uuid4().hex[:12]}"
    token = f"secret_{secrets.token_urlsafe(32)}"
    hmac_secret = f"hmac_{secrets.token_urlsafe(32)}"

    webhook = await WebhookRepository.create({
        "webhookId": webhook_id,
        "resourceType": resource_type,
        "resourceId": resource_id,
        "environmentId": environment_id,
        "token": token,
        "hmacSecret": hmac_secret,
        "enabled": True,
        "description": description,
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
        "usageCount": 0,
    })

    from app.mcp.schemas.webhooks import WebhookCredentialResponse
    credential = WebhookCredentialResponse(
        webhookId=webhook.webhookId,
        url=f"{settings.BASE_URL}/api/webhooks/{resource_type}s/{webhook_id}/execute",
        token=token,
        hmacSecret=hmac_secret,
    )

    return WebhookCreateResponse(
        message="Webhook created successfully",
        webhook=credential,
    )


async def webhook_update(
    webhook_id: Annotated[str, Field(description="Webhook ID to update.")],
    environment_id: Annotated[str | None, Field(description="New environment ID.")] = None,
    enabled: Annotated[bool | None, Field(description="Enable or disable webhook.")] = None,
    description: Annotated[str | None, Field(description="New description.")] = None,
) -> WebhookGetResponse:
    """Update webhook configuration. Cannot change token/HMAC — use rotate endpoint."""
    await ensure_mcp_database()

    update_data: dict[str, Any] = {}
    if environment_id is not None:
        update_data["environmentId"] = environment_id
    if enabled is not None:
        update_data["enabled"] = enabled
    if description is not None:
        update_data["description"] = description

    if not update_data:
        raise ValueError(make_validation_error("No update fields provided").model_dump_json())

    updated = await WebhookRepository.update(webhook_id, update_data)
    if not updated:
        raise ValueError(make_not_found_error("Webhook", webhook_id, "webhook_list").model_dump_json())

    return WebhookGetResponse(webhook=webhook_to_detail(updated, settings.BASE_URL))


async def webhook_delete(
    webhook_id: Annotated[str, Field(description="Webhook ID to delete. Destructive — cannot be undone.")],
) -> WebhookDeleteResponse:
    """Delete a webhook. This is destructive and cannot be undone."""
    await ensure_mcp_database()
    deleted = await WebhookRepository.delete(webhook_id)
    if not deleted:
        raise ValueError(make_not_found_error("Webhook", webhook_id).model_dump_json())
    return WebhookDeleteResponse(
        message="Webhook deleted successfully",
        webhookId=webhook_id,
    )


async def webhook_regenerate_credentials(
    webhook_id: Annotated[str, Field(description="Webhook ID to rotate credentials for. Destructive — invalidates old token.")],
) -> WebhookRotateResponse:
    """Regenerate webhook token and HMAC secret. Invalidates old credentials immediately."""
    import secrets

    await ensure_mcp_database()
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise ValueError(make_not_found_error("Webhook", webhook_id).model_dump_json())

    new_token = f"secret_{secrets.token_urlsafe(32)}"
    new_hmac_secret = f"hmac_{secrets.token_urlsafe(32)}"

    updated = await WebhookRepository.update(webhook_id, {
        "token": new_token,
        "hmacSecret": new_hmac_secret,
    })
    if not updated:
        raise ValueError(make_not_found_error("Webhook", webhook_id).model_dump_json())

    from app.mcp.schemas.webhooks import WebhookCredentialResponse
    credential = WebhookCredentialResponse(
        webhookId=updated.webhookId,
        url=f"{settings.BASE_URL}/api/webhooks/{updated.resourceType}s/{webhook_id}/execute",
        token=new_token,
        hmacSecret=new_hmac_secret,
    )

    return WebhookRotateResponse(
        message="Credentials regenerated successfully",
        webhook=credential,
    )


async def webhook_get_logs(
    webhook_id: Annotated[str, Field(description="Webhook ID to get logs for.")],
    offset: Annotated[int, Field(ge=0, description="Number of logs to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum logs to return.")] = 50,
) -> WebhookLogsResponse:
    """Get webhook execution logs with pagination. Sensitive payload fields are redacted."""
    await ensure_mcp_database()

    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        raise ValueError(make_not_found_error("Webhook", webhook_id).model_dump_json())

    limit = min(limit, 100)

    from app.models import WebhookLog
    logs = await WebhookLog.find(
        WebhookLog.webhookId == webhook_id
    ).sort("-timestamp").skip(offset).limit(limit).to_list()

    total = await WebhookLog.find(
        WebhookLog.webhookId == webhook_id
    ).count()

    entries = [webhook_log_to_entry(log) for log in logs]

    return WebhookLogsResponse(
        webhookId=webhook_id,
        total=total,
        offset=offset,
        limit=limit,
        has_more=(offset + limit) < total,
        logs=entries,
    )


def register_webhook_tools(server: FastMCP) -> None:
    """Register webhook lifecycle tools."""
    server.tool(
        name="webhook_list",
        description="List webhooks with optional resource filter and pagination.",
    )(webhook_list)

    server.tool(
        name="webhook_get",
        description="Get webhook details with credentials redacted.",
    )(webhook_get)

    server.tool(
        name="webhook_create",
        description="Create a webhook. Returns one-time credentials — save immediately!",
    )(webhook_create)

    server.tool(
        name="webhook_update",
        description="Update webhook configuration (environment, enabled, description).",
    )(webhook_update)

    server.tool(
        name="webhook_delete",
        description="Delete a webhook. Destructive — cannot be undone.",
    )(webhook_delete)

    server.tool(
        name="webhook_regenerate_credentials",
        description="Regenerate webhook token and HMAC secret. Invalidates old credentials immediately.",
    )(webhook_regenerate_credentials)

    server.tool(
        name="webhook_get_logs",
        description="Get webhook execution logs with pagination. Sensitive fields redacted.",
    )(webhook_get_logs)
