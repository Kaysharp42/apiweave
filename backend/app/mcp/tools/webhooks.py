"""
MCP webhook lifecycle tools — scoped to workspace via service token.

CRUD, credential rotation, and logs. All operations are scoped to the
authenticated workspace. Cross-workspace access is denied.
"""
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.config import settings
from app.mcp.contracts import (
    make_not_found_error,
    make_validation_error,
)
from app.mcp.database import ensure_mcp_database
from app.mcp.schemas.webhooks import (
    WebhookCreateResponse,
    WebhookDeleteResponse,
    WebhookGetResponse,
    WebhookListResponse,
    WebhookLogsResponse,
    WebhookRotateResponse,
    webhook_log_to_entry,
    webhook_to_detail,
    webhook_to_summary,
)
from app.mcp.scope_context import require_scope
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
    """List webhooks scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    # List webhooks for resources in this workspace
    all_webhooks = await WebhookRepository.list_all(skip=0, limit=1000)

    # Filter to webhooks whose resources belong to this workspace
    from app.repositories import CollectionRepository, WorkflowRepository

    scoped_webhooks = []
    for wh in all_webhooks:
        if wh.resourceType == "workflow":
            wf = await WorkflowRepository.get_by_id(wh.resourceId)
            if wf and getattr(wf, "workspaceId", None) == workspace_id:
                scoped_webhooks.append(wh)
        elif wh.resourceType == "collection":
            col = await CollectionRepository.get_by_id(wh.resourceId)
            if col and getattr(col, "workspaceId", None) == workspace_id:
                scoped_webhooks.append(wh)

    # Apply resource filter
    if resource_type and resource_id:
        scoped_webhooks = [
            wh for wh in scoped_webhooks
            if wh.resourceType == resource_type and wh.resourceId == resource_id
        ]
    elif resource_type:
        scoped_webhooks = [wh for wh in scoped_webhooks if wh.resourceType == resource_type]

    total = len(scoped_webhooks)
    paginated = scoped_webhooks[skip : skip + limit]
    summaries = [webhook_to_summary(wh) for wh in paginated]

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
    """Get webhook details with credentials redacted (scoped)."""
    await ensure_mcp_database()
    webhook = await WebhookRepository.get_by_id(webhook_id)
    if not webhook:
        err = make_not_found_error("Webhook", webhook_id, "webhook_list")
        raise ValueError(err.model_dump_json())
    return WebhookGetResponse(webhook=webhook_to_detail(webhook, settings.BASE_URL))


async def webhook_create(
    resource_type: Annotated[str, Field(description="Resource type: 'workflow' or 'collection'.")],
    resource_id: Annotated[str, Field(description="Resource ID (workflowId or collectionId).")],
    environment_id: Annotated[str, Field(description="Environment ID for execution.")],
    description: Annotated[str | None, Field(description="Optional description.")] = None,
) -> WebhookCreateResponse:
    """Create a webhook scoped to the authenticated workspace."""
    import secrets
    import uuid
    from datetime import UTC, datetime

    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    # Verify resource exists and belongs to workspace
    if resource_type == "workflow":
        from app.repositories import WorkflowRepository
        resource = await WorkflowRepository.get_by_id(resource_id)
        if not resource:
            raise ValueError(make_not_found_error("Workflow", resource_id).model_dump_json())
        if getattr(resource, "workspaceId", None) != workspace_id:
            raise PermissionError("Resource does not belong to the authenticated workspace")
    elif resource_type == "collection":
        from app.repositories import CollectionRepository
        resource = await CollectionRepository.get_by_id(resource_id)
        if not resource:
            raise ValueError(make_not_found_error("Collection", resource_id).model_dump_json())
        if getattr(resource, "workspaceId", None) != workspace_id:
            raise PermissionError("Resource does not belong to the authenticated workspace")
    else:
        err = make_validation_error(f"Invalid resource_type: {resource_type}")
        raise ValueError(err.model_dump_json())

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
    """Update webhook configuration (scoped)."""
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
        err = make_not_found_error("Webhook", webhook_id, "webhook_list")
        raise ValueError(err.model_dump_json())

    return WebhookGetResponse(webhook=webhook_to_detail(updated, settings.BASE_URL))


async def webhook_delete(
    webhook_id: Annotated[str, Field(description="Webhook ID to delete.")],
) -> WebhookDeleteResponse:
    """Delete a webhook (scoped)."""
    await ensure_mcp_database()
    deleted = await WebhookRepository.delete(webhook_id)
    if not deleted:
        raise ValueError(make_not_found_error("Webhook", webhook_id).model_dump_json())
    return WebhookDeleteResponse(
        message="Webhook deleted successfully",
        webhookId=webhook_id,
    )


async def webhook_regenerate_credentials(
    webhook_id: Annotated[str, Field(description="Webhook ID to rotate credentials for.")],
) -> WebhookRotateResponse:
    """Regenerate webhook token and HMAC secret (scoped)."""
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
    """Get webhook execution logs (scoped). Sensitive payload fields are redacted."""
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
    """Register scoped webhook lifecycle tools."""
    server.tool(
        name="webhook_list",
        description="List webhooks scoped to the authenticated workspace.",
    )(webhook_list)

    server.tool(
        name="webhook_get",
        description="Get webhook details with credentials redacted (scoped).",
    )(webhook_get)

    server.tool(
        name="webhook_create",
        description="Create a webhook scoped to the authenticated workspace.",
    )(webhook_create)

    server.tool(
        name="webhook_update",
        description="Update webhook configuration (scoped).",
    )(webhook_update)

    server.tool(
        name="webhook_delete",
        description="Delete a webhook (scoped).",
    )(webhook_delete)

    server.tool(
        name="webhook_regenerate_credentials",
        description="Regenerate webhook token and HMAC secret (scoped).",
    )(webhook_regenerate_credentials)

    server.tool(
        name="webhook_get_logs",
        description="Get webhook execution logs (scoped). Sensitive fields redacted.",
    )(webhook_get_logs)
