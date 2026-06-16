"""
Audit Service — business logic for append-only audit events.

Provides append_event(), get_events(), and export_json().
Secret values, ciphertext, and private keys are NEVER stored in audit context.
"""
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from app.models import (
    AuditActorType,
    AuditEvent,
    AuditEventCreate,
    AuditEventResponse,
    AuditScopeType,
)
from app.repositories.audit_repository import AuditRepository
from app.services.exceptions import AuditWriteUnavailableError

logger = logging.getLogger(__name__)

# Fields that must NEVER appear in audit context — fail-closed if detected
_FORBIDDEN_CONTEXT_KEYS: frozenset[str] = frozenset({
    "value",
    "secretValue",
    "secret_value",
    "plaintext",
    "ciphertext",
    "privateKey",
    "private_key",
    "encryptedValue",
    "encrypted_value",
    "kek",
    "dek",
    "token",
    "hmacSecret",
    "hmac_secret",
    "password",
    "apiKey",
    "api_key",
})


def _sanitize_context(context: Dict[str, Any]) -> Dict[str, Any]:
    """
    Strip any forbidden keys from audit context. Raises if a secret value
    key is detected — this is a programming error that must fail loudly.
    """
    leaked = _FORBIDDEN_CONTEXT_KEYS & set(context.keys())
    if leaked:
        raise AuditWriteUnavailableError(
            f"Audit context contains forbidden secret keys: {sorted(leaked)}. "
            "This is a programming error — secret values must never reach the audit layer."
        )
    return dict(context)


async def append_event(
    actor: AuditActorType,
    actor_id: str,
    action: str,
    scope: AuditScopeType,
    scope_id: str,
    resource_type: str,
    resource_id: str,
    context: Optional[Dict[str, Any]] = None,
) -> AuditEvent:
    """
    Append a new audit event. Sanitizes context and raises
    AuditWriteUnavailableError on write failure for fail-closed behaviour.
    """
    safe_context = _sanitize_context(context or {})
    event_data = AuditEventCreate(
        actor=actor,
        actorId=actor_id,
        action=action,
        scope=scope,
        scopeId=scope_id,
        resourceType=resource_type,
        resourceId=resource_id,
        context=safe_context,
    )
    try:
        return await AuditRepository.append(event_data)
    except Exception as exc:
        logger.error("Audit write failed: %s", exc)
        raise AuditWriteUnavailableError(
            f"Audit write failed: {exc}"
        ) from exc


async def get_events(
    *,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    scope: Optional[str] = None,
    scope_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 100,
) -> tuple[List[AuditEventResponse], int]:
    """Query audit events and return sanitized response DTOs."""
    events, total = await AuditRepository.query(
        actor=actor,
        action=action,
        scope=scope,
        scope_id=scope_id,
        resource_type=resource_type,
        resource_id=resource_id,
        from_date=from_date,
        to_date=to_date,
        skip=skip,
        limit=limit,
    )
    responses = [AuditEventResponse.model_validate(e) for e in events]
    return responses, total


async def export_json(
    *,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    scope: Optional[str] = None,
    scope_id: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    from_date: Optional[datetime] = None,
    to_date: Optional[datetime] = None,
) -> str:
    """
    Export audit events as a JSON string. Guaranteed to contain no secret values.
    """
    events, _ = await AuditRepository.query(
        actor=actor,
        action=action,
        scope=scope,
        scope_id=scope_id,
        resource_type=resource_type,
        resource_id=resource_id,
        from_date=from_date,
        to_date=to_date,
        limit=10000,
    )
    serialized = []
    for event in events:
        doc = event.model_dump()
        serialized.append(doc)
    return json.dumps({"events": serialized, "count": len(serialized)}, default=str)
