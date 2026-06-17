"""
Audit API routes — read-only audit event listing and JSON export.

Provides:
- GET /api/audit/events — paginated list with filters
- GET /api/audit/events/export — JSON download

All endpoints require authentication. Secret values, ciphertext, and private
keys are NEVER returned — the AuditEventResponse model and audit service
guarantee this at the data layer.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.auth.dependencies import get_current_active_user
from app.models import AuditEventResponse, User
from app.services import audit_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditEventListResponse(BaseModel):
    """Paginated response for audit event listing."""
    events: list[AuditEventResponse]
    total: int
    skip: int
    limit: int


@router.get(
    "/events",
    response_model=AuditEventListResponse,
    summary="List audit events",
    description="Returns paginated audit events with optional filters. "
                "No secret values are ever included in responses.",
)
async def list_audit_events(
    actor: Optional[str] = Query(None, description="Filter by actor type (user, service_token, webhook_token, etc.)"),
    action: Optional[str] = Query(None, description="Filter by action (secret_resolved, secret_created, etc.)"),
    scope: Optional[str] = Query(None, description="Filter by scope (org, workspace, environment)"),
    resource_type: Optional[str] = Query(None, alias="resourceType", description="Filter by resource type"),
    from_date: Optional[datetime] = Query(None, alias="from", description="Start of date range (ISO 8601)"),
    to_date: Optional[datetime] = Query(None, alias="to", description="End of date range (ISO 8601)"),
    skip: int = Query(0, ge=0, description="Number of events to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum events to return"),
    current_user: User = Depends(get_current_active_user),
) -> AuditEventListResponse:
    """
    List audit events with optional filters.

    Returns metadata only — no secret values, ciphertext, or private keys.
    """
    events, total = await audit_service.get_events(
        actor=actor,
        action=action,
        scope=scope,
        resource_type=resource_type,
        from_date=from_date,
        to_date=to_date,
        skip=skip,
        limit=limit,
    )
    return AuditEventListResponse(
        events=events,
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get(
    "/events/export",
    summary="Export audit events as JSON",
    description="Downloads all matching audit events as a JSON file. "
                "Guaranteed to contain no secret values.",
)
async def export_audit_events(
    actor: Optional[str] = Query(None, description="Filter by actor type"),
    action: Optional[str] = Query(None, description="Filter by action"),
    scope: Optional[str] = Query(None, description="Filter by scope"),
    resource_type: Optional[str] = Query(None, alias="resourceType", description="Filter by resource type"),
    from_date: Optional[datetime] = Query(None, alias="from", description="Start of date range (ISO 8601)"),
    to_date: Optional[datetime] = Query(None, alias="to", description="End of date range (ISO 8601)"),
    current_user: User = Depends(get_current_active_user),
) -> Response:
    """
    Export audit events as a downloadable JSON file.

    The export is guaranteed to contain no secret values, ciphertext,
    or private keys.
    """
    json_str = await audit_service.export_json(
        actor=actor,
        action=action,
        scope=scope,
        resource_type=resource_type,
        from_date=from_date,
        to_date=to_date,
    )
    return Response(
        content=json_str,
        media_type="application/json",
        headers={
            "Content-Disposition": "attachment; filename=audit-events.json",
        },
    )
