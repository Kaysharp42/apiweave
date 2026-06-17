"""
Secret Binding Service — user-secret binding to workspace/environment.

User personal secrets only participate in resolution through explicit
binding records. This service manages those bindings.
"""
from __future__ import annotations

import secrets
import time

from app.models import (
    AuditActorType,
    AuditScopeType,
    SecretBinding,
    SecretBindingCreateRequest,
    SecretBindingResponse,
)
from app.repositories.secret_repository import SecretBindingRepository, SecretRepository
from app.services.audit_service import append_event
from app.services.exceptions import ConflictError, ResourceNotFoundError


def _generate_binding_id() -> str:
    return f"sbi-{int(time.time())}-{secrets.token_hex(8)}"


def _to_binding_response(binding: SecretBinding) -> SecretBindingResponse:
    """Convert SecretBinding document to response DTO."""
    return SecretBindingResponse(
        bindingId=binding.bindingId,
        secretId=binding.secretId,
        userId=binding.userId,
        targetScopeType=binding.targetScopeType,
        targetScopeId=binding.targetScopeId,
        createdAt=binding.createdAt,
    )


async def bind_user_secret(
    user_id: str,
    request: SecretBindingCreateRequest,
    actor: AuditActorType = "user",
    actor_id: str = "system",
) -> SecretBindingResponse:
    """
    Bind a user-scoped secret to a workspace or environment.

    The secret must exist and be in the user scope.
    The target scope must be workspace or environment.

    Raises:
        ResourceNotFoundError: If secret not found.
        ValueError: If secret is not user-scoped or target scope is invalid.
        ConflictError: If binding already exists.
    """
    # Validate target scope
    if request.targetScopeType not in ("workspace", "environment"):
        raise ValueError(
            "Target scope must be 'workspace' or 'environment'"
        )

    # Verify secret exists and is user-scoped
    secret = await SecretRepository.get_by_id(request.secretId)
    if not secret:
        raise ResourceNotFoundError(f"Secret {request.secretId} not found")

    if secret.scopeType != "user":
        raise ValueError(
            "Only user-scoped secrets can be bound. "
            f"Secret is scoped to {secret.scopeType}."
        )

    if secret.scopeId != user_id:
        raise ValueError(
            "Cannot bind a secret that does not belong to you"
        )

    # Check for existing binding
    existing = await SecretBindingRepository.get_existing(
        secret_id=request.secretId,
        target_scope_type=request.targetScopeType,
        target_scope_id=request.targetScopeId,
    )
    if existing:
        raise ConflictError(
            f"Binding already exists for secret {request.secretId} "
            f"to {request.targetScopeType}:{request.targetScopeId}"
        )

    binding_id = _generate_binding_id()
    binding = await SecretBindingRepository.create(
        binding_id=binding_id,
        secret_id=request.secretId,
        user_id=user_id,
        target_scope_type=request.targetScopeType,
        target_scope_id=request.targetScopeId,
    )

    # Audit
    await _audit_binding_event(
        actor=actor,
        actor_id=actor_id,
        action="secret_binding_created",
        binding=binding,
    )

    return _to_binding_response(binding)


async def unbind_user_secret(
    binding_id: str,
    user_id: str,
    actor: AuditActorType = "user",
    actor_id: str = "system",
) -> None:
    """
    Remove a user-secret binding.

    Raises:
        ResourceNotFoundError: If binding not found.
        ValueError: If binding does not belong to user.
    """
    binding = await SecretBindingRepository.get_by_id(binding_id)
    if not binding:
        raise ResourceNotFoundError(f"Binding {binding_id} not found")

    if binding.userId != user_id:
        raise ValueError("Cannot unbind a binding that does not belong to you")

    # Audit before delete
    await _audit_binding_event(
        actor=actor,
        actor_id=actor_id,
        action="secret_binding_deleted",
        binding=binding,
    )

    await SecretBindingRepository.delete(binding_id)


async def list_bindings_for_target(
    target_scope_type: str,
    target_scope_id: str,
) -> list[SecretBindingResponse]:
    """
    List all bindings for a workspace or environment.

    Returns bindings where user-scoped secrets are bound to this target.
    """
    bindings = await SecretBindingRepository.list_for_target(
        target_scope_type=target_scope_type,
        target_scope_id=target_scope_id,
    )
    return [_to_binding_response(b) for b in bindings]


async def list_bindings_for_user(
    user_id: str,
) -> list[SecretBindingResponse]:
    """
    List all bindings for a user.

    Returns all bindings where the user has bound their personal secrets.
    """
    bindings = await SecretBindingRepository.list_for_user(user_id)
    return [_to_binding_response(b) for b in bindings]


async def _audit_binding_event(
    actor: AuditActorType,
    actor_id: str,
    action: str,
    binding: SecretBinding,
) -> None:
    """Record an audit event for a binding operation."""
    # Map target scope to AuditScopeType
    audit_scope: AuditScopeType
    if binding.targetScopeType == "workspace":
        audit_scope = "workspace"
    elif binding.targetScopeType == "environment":
        audit_scope = "environment"
    else:
        audit_scope = "workspace"  # fallback

    context = {
        "secretId": binding.secretId,
        "targetScopeType": binding.targetScopeType,
        "targetScopeId": binding.targetScopeId,
    }

    await append_event(
        actor=actor,
        actor_id=actor_id,
        action=action,
        scope=audit_scope,
        scope_id=binding.targetScopeId,
        resource_type="secret_binding",
        resource_id=binding.bindingId,
        context=context,
    )
