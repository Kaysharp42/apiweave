"""
Scoped Secret Service — GitHub-like secret management.

Provides CRUD operations for scoped secrets with:
- GitHub-like naming validation (alphanumeric + underscore, max 255 chars)
- GitHub-like limits (max 100 secrets per scope)
- Client-encrypted writes only (sealed-box ciphertext)
- Metadata-only reads (no ciphertext/value in responses)
- Effective resolution: Environment > Workspace > Organization
- Audit integration for all write operations
"""
from __future__ import annotations

import re
import secrets
import time

from app.models import (
    AuditActorType,
    AuditScopeType,
    Secret,
    SecretCreateRequest,
    SecretMetadataResponse,
)
from app.repositories.secret_repository import SecretRepository
from app.services.audit_service import append_event
from app.services.exceptions import ConflictError, ResourceNotFoundError

# GitHub-like naming: alphanumeric + underscore, must start with letter/underscore
_SECRET_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SECRET_NAME_MAX_LENGTH = 255
_MAX_SECRETS_PER_SCOPE = 100


def validate_secret_name(name: str) -> None:
    """
    Validate secret name follows GitHub-like conventions.

    Raises ValueError if invalid.
    """
    if not name:
        raise ValueError("Secret name cannot be empty")
    if len(name) > _SECRET_NAME_MAX_LENGTH:
        raise ValueError(
            f"Secret name cannot exceed {_SECRET_NAME_MAX_LENGTH} characters"
        )
    if not _SECRET_NAME_PATTERN.match(name):
        raise ValueError(
            "Secret name must start with a letter or underscore and contain "
            "only alphanumeric characters and underscores"
        )


def _generate_secret_id() -> str:
    return f"sec-{int(time.time())}-{secrets.token_hex(8)}"


def _to_metadata_response(secret: Secret) -> SecretMetadataResponse:
    """Convert Secret document to metadata response (no ciphertext)."""
    return SecretMetadataResponse(
        secretId=secret.secretId,
        name=secret.name,
        scopeType=secret.scopeType,
        scopeId=secret.scopeId,
        keyId=secret.keyId,
        createdAt=secret.createdAt,
        updatedAt=secret.updatedAt,
    )


async def create_secret(
    scope_type: str,
    scope_id: str,
    request: SecretCreateRequest,
    actor: AuditActorType = "user",
    actor_id: str = "system",
) -> SecretMetadataResponse:
    """
    Create a new scoped secret.

    Accepts client-encrypted sealed-box ciphertext. Stores metadata + ciphertext.
    Returns metadata only (no ciphertext in response).

    Raises:
        ValueError: If name is invalid or scope limit exceeded.
        ConflictError: If secret with same name already exists in scope.
    """
    validate_secret_name(request.name)

    # Check scope limit
    count = await SecretRepository.count_by_scope(scope_type, scope_id)
    if count >= _MAX_SECRETS_PER_SCOPE:
        raise ValueError(
            f"Cannot exceed {_MAX_SECRETS_PER_SCOPE} secrets per scope"
        )

    # Check for duplicate name in scope
    existing = await SecretRepository.get_by_scope_and_name(
        scope_type, scope_id, request.name
    )
    if existing:
        raise ConflictError(
            f"Secret '{request.name}' already exists in this scope"
        )

    secret_id = _generate_secret_id()
    secret = await SecretRepository.create(
        secret_id=secret_id,
        name=request.name,
        scope_type=scope_type,
        scope_id=scope_id,
        ciphertext=request.ciphertext,
        key_id=request.keyId,
    )

    # Audit
    await _audit_secret_event(
        actor=actor,
        actor_id=actor_id,
        action="secret_created",
        scope_type=scope_type,
        scope_id=scope_id,
        secret=secret,
    )

    return _to_metadata_response(secret)


async def update_secret(
    secret_id: str,
    request: SecretCreateRequest,
    actor: AuditActorType = "user",
    actor_id: str = "system",
) -> SecretMetadataResponse:
    """
    Update an existing secret's ciphertext.

    The secret name in the request must match the existing secret's name
    (name changes require delete + create).

    Raises:
        ResourceNotFoundError: If secret not found.
        ValueError: If name doesn't match or is invalid.
    """
    secret = await SecretRepository.get_by_id(secret_id)
    if not secret:
        raise ResourceNotFoundError(f"Secret {secret_id} not found")

    if request.name != secret.name:
        raise ValueError(
            "Secret name cannot be changed. Delete and recreate to rename."
        )

    validate_secret_name(request.name)

    updated = await SecretRepository.update(
        secret_id=secret_id,
        ciphertext=request.ciphertext,
        key_id=request.keyId,
    )
    if not updated:
        raise ResourceNotFoundError(f"Failed to update secret {secret_id}")

    # Audit
    await _audit_secret_event(
        actor=actor,
        actor_id=actor_id,
        action="secret_updated",
        scope_type=updated.scopeType,
        scope_id=updated.scopeId,
        secret=updated,
    )

    return _to_metadata_response(updated)


async def delete_secret(
    secret_id: str,
    actor: AuditActorType = "user",
    actor_id: str = "system",
) -> None:
    """
    Delete a secret.

    Raises:
        ResourceNotFoundError: If secret not found.
    """
    secret = await SecretRepository.get_by_id(secret_id)
    if not secret:
        raise ResourceNotFoundError(f"Secret {secret_id} not found")

    # Audit before delete (so we have the metadata)
    await _audit_secret_event(
        actor=actor,
        actor_id=actor_id,
        action="secret_deleted",
        scope_type=secret.scopeType,
        scope_id=secret.scopeId,
        secret=secret,
    )

    await SecretRepository.delete(secret_id)


async def list_secrets(
    scope_type: str,
    scope_id: str,
) -> list[SecretMetadataResponse]:
    """
    List all secrets in a scope.

    Returns metadata only — no ciphertext or plaintext values.
    """
    secrets_list = await SecretRepository.list_by_scope(scope_type, scope_id)
    return [_to_metadata_response(s) for s in secrets_list]


async def get_secret_metadata(
    secret_id: str,
) -> SecretMetadataResponse:
    """
    Get secret metadata by ID.

    Returns metadata only — no ciphertext or plaintext values.

    Raises:
        ResourceNotFoundError: If secret not found.
    """
    secret = await SecretRepository.get_by_id(secret_id)
    if not secret:
        raise ResourceNotFoundError(f"Secret {secret_id} not found")
    return _to_metadata_response(secret)


async def resolve_effective_secret(
    environment_id: str | None,
    workspace_id: str | None,
    org_id: str | None,
    secret_name: str,
) -> tuple[Secret, str] | None:
    """
    Resolve the effective secret using GitHub-like override chain.

    Priority: Environment > Workspace > Organization

    Returns (Secret, scope_type) tuple if found, None if not found.
    The scope_type indicates which scope the secret came from.
    """
    # 1. Check environment scope
    if environment_id:
        env_secret = await SecretRepository.get_by_scope_and_name(
            "environment", environment_id, secret_name
        )
        if env_secret:
            return env_secret, "environment"

    # 2. Check workspace scope
    if workspace_id:
        ws_secret = await SecretRepository.get_by_scope_and_name(
            "workspace", workspace_id, secret_name
        )
        if ws_secret:
            return ws_secret, "workspace"

    # 3. Check organization scope
    if org_id:
        org_secret = await SecretRepository.get_by_scope_and_name(
            "organization", org_id, secret_name
        )
        if org_secret:
            return org_secret, "organization"

    return None


async def _audit_secret_event(
    actor: AuditActorType,
    actor_id: str,
    action: str,
    scope_type: str,
    scope_id: str,
    secret: Secret,
) -> None:
    """Record an audit event for a secret operation."""
    # Map scope_type to AuditScopeType
    audit_scope: AuditScopeType
    if scope_type == "organization":
        audit_scope = "org"
    elif scope_type == "workspace":
        audit_scope = "workspace"
    elif scope_type == "environment":
        audit_scope = "environment"
    else:
        audit_scope = "workspace"  # fallback for user scope

    context = {
        "secretName": secret.name,
        "keyId": secret.keyId,
    }

    await append_event(
        actor=actor,
        actor_id=actor_id,
        action=action,
        scope=audit_scope,
        scope_id=scope_id,
        resource_type="secret",
        resource_id=secret.secretId,
        context=context,
    )
