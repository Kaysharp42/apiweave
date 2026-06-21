"""
Trusted secret resolver helper - demonstrates audit integration.

This module provides the pattern that the executor (Wave 3, Task 14) will use
to resolve secrets with mandatory audit. Every resolution records an event;
if the audit write fails, the resolver raises AuditWriteUnavailableError
(fail-closed) so no secret is used without an audit trail.
"""

import logging
from typing import Any

from app.core.exceptions import AuditWriteUnavailableError
from app.models import AuditActorType, AuditEventCreate, AuditScopeType
from app.repositories.audit_repository import AuditRepository

logger = logging.getLogger(__name__)

# Fields that must NEVER appear in audit context - fail-closed if detected.
# Mirror of the set in app.services.audit_service for the runner-layer path.
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
    """Strip any forbidden keys from audit context.

    Raises AuditWriteUnavailableError if a secret-value key is detected -
    this is a programming error that must fail loudly.
    """
    leaked = _FORBIDDEN_CONTEXT_KEYS & set(context.keys())
    if leaked:
        raise AuditWriteUnavailableError(
            f"Audit context contains forbidden secret keys: {sorted(leaked)}. "
            "This is a programming error - secret values must never reach the audit layer."
        )
    return dict(context)


async def resolve_secret_with_audit(  # noqa: PLR0913 - audit context requires all fields
    *,
    actor: AuditActorType,
    actor_id: str,
    scope: AuditScopeType,
    scope_id: str,
    run_id: str,
    node_id: str,
    secret_name: str,
    key_id: str,
    resolved_value: str,
    resource_type: str = "secret",
    resource_id: str | None = None,
) -> str:
    """
    Resolve a secret and record an audit event.

    The audit event records metadata only - never the resolved value.
    If the audit write fails, raises AuditWriteUnavailableError (fail-closed).

    Returns the resolved_value on success.
    """
    context: dict[str, Any] = {
        "runId": run_id,
        "nodeId": node_id,
        "secretName": secret_name,
        "keyId": key_id,
    }
    safe_context = _sanitize_context(context)

    event_data = AuditEventCreate(
        actor=actor,
        actorId=actor_id,
        action="secret_resolved",
        scope=scope,
        scopeId=scope_id,
        resourceType=resource_type,
        resourceId=resource_id or secret_name,
        context=safe_context,
    )

    try:
        await AuditRepository.append(event_data)
    except Exception as exc:
        logger.error("Audit write failed: %s", exc)
        raise AuditWriteUnavailableError(f"Audit write failed: {exc}") from exc

    return resolved_value
