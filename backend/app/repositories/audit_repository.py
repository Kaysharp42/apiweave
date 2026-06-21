"""
Audit Repository — append-only data access for AuditEvent documents.

Intentionally exposes NO update or delete methods. Audit events are immutable
once written. This is a security invariant: the audit trail must not be
tampered with after creation.
"""

import uuid
from datetime import UTC, datetime

from beanie.operators import And

from app.models import AuditEvent, AuditEventCreate


class AuditRepository:
    """Append-only repository for AuditEvent documents."""

    @staticmethod
    async def append(event_data: AuditEventCreate) -> AuditEvent:
        """
        Insert a new audit event. Returns the persisted document.

        Raises on write failure so callers can implement fail-closed behaviour.
        """
        event = AuditEvent(
            eventId=str(uuid.uuid4()),
            actor=event_data.actor,
            actorId=event_data.actorId,
            action=event_data.action,
            scope=event_data.scope,
            scopeId=event_data.scopeId,
            resourceType=event_data.resourceType,
            resourceId=event_data.resourceId,
            context=event_data.context,
            createdAt=datetime.now(UTC),
        )
        await event.insert()
        return event

    @staticmethod
    async def query(
        *,
        actor: str | None = None,
        action: str | None = None,
        scope: str | None = None,
        scope_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        from_date: datetime | None = None,
        to_date: datetime | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[AuditEvent], int]:
        """
        Query audit events with optional filters. Returns (events, total_count).
        """
        filters: list = []
        if actor:
            filters.append(AuditEvent.actor == actor)
        if action:
            filters.append(AuditEvent.action == action)
        if scope:
            filters.append(AuditEvent.scope == scope)
        if scope_id:
            filters.append(AuditEvent.scopeId == scope_id)
        if resource_type:
            filters.append(AuditEvent.resourceType == resource_type)
        if resource_id:
            filters.append(AuditEvent.resourceId == resource_id)
        if from_date:
            filters.append(AuditEvent.createdAt >= from_date)
        if to_date:
            filters.append(AuditEvent.createdAt <= to_date)

        query = AuditEvent.find(And(*filters)) if filters else AuditEvent.find_all()

        total = await query.count()
        events = await query.sort(-AuditEvent.createdAt).skip(skip).limit(limit).to_list()

        return events, total
