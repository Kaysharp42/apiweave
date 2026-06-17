"""
Service Token Service — scoped token lifecycle management.

Handles create/rotate/revoke with SHA-256 hashing, one-time display,
and audit events. Token validation checks scope, expiry, and revocation.
"""
import hashlib
import logging
import secrets
from datetime import UTC, datetime

from app.models import (
    ServiceToken,
    ServiceTokenCreateRequest,
    ServiceTokenCreateResponse,
    ServiceTokenMetadataResponse,
    ServiceTokenRotateResponse,
)
from app.repositories.service_token_repository import ServiceTokenRepository
from app.services.audit_service import append_event
from app.services.exceptions import ResourceNotFoundError

logger = logging.getLogger(__name__)

# Token prefix for easy identification in logs/configs
_TOKEN_PREFIX = "awst_"
_TOKEN_BYTES = 32


def _generate_raw_token() -> str:
    """Generate a cryptographically secure random token with prefix."""
    return f"{_TOKEN_PREFIX}{secrets.token_hex(_TOKEN_BYTES)}"


def _hash_token(raw_token: str) -> str:
    """SHA-256 hash of the raw token value."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _audit_scope_type(token_scope_type: str) -> str:
    """Map token scopeType to audit scope type."""
    if token_scope_type == "workspace":
        return "workspace"
    if token_scope_type == "organization":
        return "org"
    return "workspace"


async def create_token(
    *,
    scope_type: str,
    scope_id: str,
    created_by: str,
    request: ServiceTokenCreateRequest,
) -> ServiceTokenCreateResponse:
    """
    Create a new scoped service token.

    The raw token value is returned ONLY in this response. It is never
    stored — only the SHA-256 hash is persisted. Subsequent metadata
    calls will NOT include the token value.
    """
    raw_token = _generate_raw_token()
    token_hash = _hash_token(raw_token)
    token_id = f"st-{secrets.token_hex(12)}"

    token = await ServiceTokenRepository.create(
        token_id=token_id,
        name=request.name,
        token_hash=token_hash,
        scope_type=scope_type,
        scope_id=scope_id,
        created_by=created_by,
        permissions=request.permissions,
        expires_at=request.expiresAt,
        description=request.description,
    )

    # Audit the creation
    await append_event(
        actor="user",
        actor_id=created_by,
        action="service_token_created",
        scope=_audit_scope_type(scope_type),  # type: ignore[arg-type]
        scope_id=scope_id,
        resource_type="service_token",
        resource_id=token_id,
        context={
            "tokenName": request.name,
            "scopeType": scope_type,
            "permissions": request.permissions,
        },
    )

    logger.info(
        "Service token created: tokenId=%s scope=%s/%s by=%s",
        token_id,
        scope_type,
        scope_id,
        created_by,
    )

    return ServiceTokenCreateResponse(
        tokenId=token_id,
        name=token.name,
        token=raw_token,  # One-time display
        scopeType=scope_type,
        scopeId=scope_id,
        permissions=token.permissions,
        createdAt=token.createdAt,
        expiresAt=token.expiresAt,
    )


async def rotate_token(
    *,
    token_id: str,
    rotated_by: str,
) -> ServiceTokenRotateResponse:
    """
    Rotate a service token, generating a new value.

    The old token is immediately invalidated (hash replaced). The new
    raw token value is returned ONLY in this response.
    """
    token = await ServiceTokenRepository.get_by_id(token_id)
    if not token:
        raise ResourceNotFoundError(f"Service token not found: {token_id}")

    if token.revokedAt is not None:
        raise ResourceNotFoundError(f"Service token is revoked: {token_id}")

    # Generate new token value
    new_raw_token = _generate_raw_token()
    new_hash = _hash_token(new_raw_token)

    # Replace the hash — old token immediately invalid
    token.tokenHash = new_hash
    await token.save()

    now = datetime.now(UTC)

    # Audit the rotation
    await append_event(
        actor="user",
        actor_id=rotated_by,
        action="service_token_rotated",
        scope=_audit_scope_type(token.scopeType),  # type: ignore[arg-type]
        scope_id=token.scopeId,
        resource_type="service_token",
        resource_id=token_id,
        context={
            "tokenName": token.name,
            "scopeType": token.scopeType,
        },
    )

    logger.info(
        "Service token rotated: tokenId=%s by=%s",
        token_id,
        rotated_by,
    )

    return ServiceTokenRotateResponse(
        tokenId=token_id,
        name=token.name,
        token=new_raw_token,  # One-time display
        rotatedAt=now,
    )


async def revoke_token(
    *,
    token_id: str,
    revoked_by: str,
) -> ServiceTokenMetadataResponse:
    """
    Revoke a service token. The token is immediately invalid for all
    subsequent calls.
    """
    token = await ServiceTokenRepository.get_by_id(token_id)
    if not token:
        raise ResourceNotFoundError(f"Service token not found: {token_id}")

    if token.revokedAt is not None:
        # Already revoked — return current state
        return ServiceTokenMetadataResponse.model_validate(token)

    success = await ServiceTokenRepository.revoke(token_id)
    if not success:
        raise ResourceNotFoundError(f"Service token not found: {token_id}")

    # Re-fetch to get updated state
    token = await ServiceTokenRepository.get_by_id(token_id)
    if not token:
        raise ResourceNotFoundError(f"Service token not found after revoke: {token_id}")

    # Audit the revocation
    await append_event(
        actor="user",
        actor_id=revoked_by,
        action="service_token_revoked",
        scope=_audit_scope_type(token.scopeType),  # type: ignore[arg-type]
        scope_id=token.scopeId,
        resource_type="service_token",
        resource_id=token_id,
        context={
            "tokenName": token.name,
            "scopeType": token.scopeType,
        },
    )

    logger.info(
        "Service token revoked: tokenId=%s by=%s",
        token_id,
        revoked_by,
    )

    return ServiceTokenMetadataResponse.model_validate(token)


async def validate_token(
    raw_token: str,
    *,
    expected_scope_type: str | None = None,
    expected_scope_id: str | None = None,
) -> ServiceToken | None:
    """
    Validate a raw token value and return the ServiceToken if valid.

    Checks:
    - Hash matches a stored token
    - Token is not revoked
    - Token is not expired
    - Token scope matches expected scope (if provided)

    Updates lastUsedAt on successful validation.
    Returns None if the token is invalid.
    """
    token_hash = _hash_token(raw_token)
    token = await ServiceTokenRepository.get_by_hash(token_hash)

    if not token:
        return None

    # Check revocation
    if token.revokedAt is not None:
        return None

    # Check expiry
    if token.expiresAt is not None:
        now = datetime.now(UTC)
        if token.expiresAt < now:
            return None

    # Check scope match
    if expected_scope_type and token.scopeType != expected_scope_type:
        return None
    if expected_scope_id and token.scopeId != expected_scope_id:
        return None

    # Update last used timestamp
    token.lastUsedAt = datetime.now(UTC)
    await token.save()

    return token


async def get_token_metadata(token_id: str) -> ServiceTokenMetadataResponse:
    """
    Get service token metadata. NEVER includes the raw token value.
    """
    token = await ServiceTokenRepository.get_by_id(token_id)
    if not token:
        raise ResourceNotFoundError(f"Service token not found: {token_id}")
    return ServiceTokenMetadataResponse.model_validate(token)


async def list_tokens_by_scope(
    scope_type: str,
    scope_id: str,
) -> list[ServiceTokenMetadataResponse]:
    """
    List all active service tokens for a scope. Returns metadata only.
    """
    tokens = await ServiceTokenRepository.list_by_scope(scope_type, scope_id)
    return [ServiceTokenMetadataResponse.model_validate(t) for t in tokens]


async def update_token_permissions(
    *,
    token_id: str,
    permissions: list[str],
    updated_by: str,
) -> ServiceTokenMetadataResponse:
    """
    Update (narrow) a token's permissions. Takes effect immediately on
    subsequent calls.

    Scope narrowing is audited. This is the mechanism for reducing a
    token's access without full revocation.
    """
    token = await ServiceTokenRepository.get_by_id(token_id)
    if not token:
        raise ResourceNotFoundError(f"Service token not found: {token_id}")

    if token.revokedAt is not None:
        raise ResourceNotFoundError(f"Service token is revoked: {token_id}")

    old_permissions = list(token.permissions)
    token.permissions = permissions
    await token.save()

    # Audit the permission change (scope narrowing)
    await append_event(
        actor="user",
        actor_id=updated_by,
        action="service_token_permissions_updated",
        scope=_audit_scope_type(token.scopeType),  # type: ignore[arg-type]
        scope_id=token.scopeId,
        resource_type="service_token",
        resource_id=token_id,
        context={
            "tokenName": token.name,
            "oldPermissions": old_permissions,
            "newPermissions": permissions,
        },
    )

    logger.info(
        "Service token permissions updated: tokenId=%s old=%s new=%s by=%s",
        token_id,
        old_permissions,
        permissions,
        updated_by,
    )

    return ServiceTokenMetadataResponse.model_validate(token)
