"""
Audit Service — business logic for append-only audit events.

Provides append_event(), get_events(), and export_json().
Secret values, ciphertext, and private keys are NEVER stored in audit context.
"""

import json
import logging
from datetime import datetime
from typing import Any

from app.models import (
    AuditActorType,
    AuditEvent,
    AuditEventCreate,
    AuditEventResponse,
    AuditScopeType,
)
from app.repositories.audit_repository import AuditRepository
from app.services.exceptions import AuditWriteUnavailableError
from app.services.secret_utils import SecretMasker

logger = logging.getLogger(__name__)

# Fields that must NEVER appear in audit context — fail-closed if detected
_FORBIDDEN_CONTEXT_KEYS: frozenset[str] = frozenset(
    {
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
    }
)


def _sanitize_context(context: dict[str, Any]) -> dict[str, Any]:
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


def mask_context_values(context: dict[str, Any], masker: SecretMasker) -> dict[str, Any]:
    """Apply value-based masking to all string values in audit context.

    Defense-in-depth: even though callers should never pass secret values
    in context, this ensures any accidental inclusion is masked before storage.
    """
    if not masker.has_secrets:
        return dict(context)
    return {k: masker.mask_text(v) if isinstance(v, str) else v for k, v in context.items()}


async def append_event(
    actor: AuditActorType,
    actor_id: str,
    action: str,
    scope: AuditScopeType,
    scope_id: str,
    resource_type: str,
    resource_id: str,
    context: dict[str, Any] | None = None,
    masker: SecretMasker | None = None,
) -> AuditEvent:
    """
    Append a new audit event. Sanitizes context and raises
    AuditWriteUnavailableError on write failure for fail-closed behaviour.

    If *masker* is provided, all string values in context are value-masked
    as defense-in-depth before forbidden-key check.
    """
    raw_context = dict(context or {})
    if masker is not None:
        raw_context = mask_context_values(raw_context, masker)
    safe_context = _sanitize_context(raw_context)
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
        raise AuditWriteUnavailableError(f"Audit write failed: {exc}") from exc


async def get_events(
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
) -> tuple[list[AuditEventResponse], int]:
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
    actor: str | None = None,
    action: str | None = None,
    scope: str | None = None,
    scope_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    from_date: datetime | None = None,
    to_date: datetime | None = None,
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
