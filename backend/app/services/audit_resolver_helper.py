"""
Trusted secret resolver helper — demonstrates audit integration.

This module provides the pattern that the executor (Wave 3, Task 14) will use
to resolve secrets with mandatory audit. Every resolution records an event;
if the audit write fails, the resolver raises AuditWriteUnavailableError
(fail-closed) so no secret is used without an audit trail.
"""
from typing import Any, Dict, Optional

from app.models import AuditActorType, AuditScopeType
from app.services.audit_service import append_event
from app.services.exceptions import AuditWriteUnavailableError


async def resolve_secret_with_audit(
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
    resource_id: Optional[str] = None,
) -> str:
    """
    Resolve a secret and record an audit event.

    The audit event records metadata only — never the resolved value.
    If the audit write fails, raises AuditWriteUnavailableError (fail-closed).

    Returns the resolved_value on success.
    """
    context: Dict[str, Any] = {
        "runId": run_id,
        "nodeId": node_id,
        "secretName": secret_name,
        "keyId": key_id,
    }

    await append_event(
        actor=actor,
        actor_id=actor_id,
        action="secret_resolved",
        scope=scope,
        scope_id=scope_id,
        resource_type=resource_type,
        resource_id=resource_id or secret_name,
        context=context,
    )

    return resolved_value
