"""
Scoped Service Token API routes — token lifecycle management.

Provides CRUD endpoints for scoped service tokens with:
- One-time token value display at creation/rotation
- Metadata-only reads (no token value in responses)
- Scope enforcement (tokens cannot cross workspace/org boundaries)
- Permission narrowing and revocation with immediate effect
- Full audit trail for all token actions

Route structure:
    /api/scopes/{scope_type}/{scope_id}/tokens
    /api/scopes/{scope_type}/{scope_id}/tokens/{token_id}
    /api/scopes/{scope_type}/{scope_id}/tokens/{token_id}/rotate
    /api/scopes/{scope_type}/{scope_id}/tokens/{token_id}/revoke
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_permission
from app.auth.permissions import SECRETS_CREATE, SECRETS_DELETE, SECRETS_READ, SECRETS_UPDATE
from app.models import (
    ServiceTokenCreateRequest,
    ServiceTokenCreateResponse,
    ServiceTokenMetadataResponse,
    ServiceTokenRotateResponse,
    User,
)
from app.services import service_token_service
from app.services.exceptions import ResourceNotFoundError

router = APIRouter(prefix="/api/scopes", tags=["service_tokens"])

VALID_TOKEN_SCOPE_TYPES = {"workspace", "organization"}


def _validate_scope(scope_type: str):
    """Validate scope type is one of the allowed values for tokens."""
    if scope_type not in VALID_TOKEN_SCOPE_TYPES:
        valid_types = ", ".join(sorted(VALID_TOKEN_SCOPE_TYPES))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scope type for tokens. Must be one of: {valid_types}",
        )


# ============================================================================
# Service Token CRUD Endpoints
# ============================================================================


class ServiceTokenListResponse(BaseModel):
    """Response for listing service tokens in a scope."""

    tokens: list[ServiceTokenMetadataResponse]
    total: int


class ServiceTokenPermissionsUpdateRequest(BaseModel):
    """Request body for updating token permissions (scope narrowing)."""

    permissions: list[str]


@router.get(
    "/{scope_type}/{scope_id}/tokens",
    response_model=ServiceTokenListResponse,
    dependencies=[Depends(get_current_user), require_permission(SECRETS_READ)],
)
async def list_tokens(scope_type: str, scope_id: str):
    """
    List all active service tokens in a scope.

    Returns metadata only — no raw token values.
    """
    _validate_scope(scope_type)
    tokens = await service_token_service.list_tokens_by_scope(scope_type, scope_id)
    return ServiceTokenListResponse(tokens=tokens, total=len(tokens))


@router.get(
    "/{scope_type}/{scope_id}/tokens/{token_id}",
    response_model=ServiceTokenMetadataResponse,
    dependencies=[Depends(get_current_user), require_permission(SECRETS_READ)],
)
async def get_token(scope_type: str, scope_id: str, token_id: str):
    """
    Get service token metadata by ID.

    Returns metadata only — no raw token value.
    """
    _validate_scope(scope_type)
    try:
        token = await service_token_service.get_token_metadata(token_id)
        # Verify token belongs to this scope
        if token.scopeType != scope_type or token.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Service token not found in this scope",
            )
        return token
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.post(
    "/{scope_type}/{scope_id}/tokens",
    response_model=ServiceTokenCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user), require_permission(SECRETS_CREATE)],
)
async def create_token(
    scope_type: str,
    scope_id: str,
    request: ServiceTokenCreateRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Create a new scoped service token.

    The raw token value is returned ONLY in this response. It is never
    stored — only the SHA-256 hash is persisted. Subsequent metadata
    calls will NOT include the token value.

    WARNING: Copy the token value now. It cannot be retrieved later.
    """
    _validate_scope(scope_type)
    return await service_token_service.create_token(
        scope_type=scope_type,
        scope_id=scope_id,
        created_by=current_user.userId,
        request=request,
    )


@router.post(
    "/{scope_type}/{scope_id}/tokens/{token_id}/rotate",
    response_model=ServiceTokenRotateResponse,
    dependencies=[Depends(get_current_user), require_permission(SECRETS_UPDATE)],
)
async def rotate_token(
    scope_type: str,
    scope_id: str,
    token_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Rotate a service token, generating a new value.

    The old token is immediately invalidated. The new raw token value
    is returned ONLY in this response.

    WARNING: Copy the new token value now. It cannot be retrieved later.
    """
    _validate_scope(scope_type)
    try:
        # Verify token belongs to this scope
        token = await service_token_service.get_token_metadata(token_id)
        if token.scopeType != scope_type or token.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Service token not found in this scope",
            )
        return await service_token_service.rotate_token(
            token_id=token_id,
            rotated_by=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.post(
    "/{scope_type}/{scope_id}/tokens/{token_id}/revoke",
    response_model=ServiceTokenMetadataResponse,
    dependencies=[Depends(get_current_user), require_permission(SECRETS_DELETE)],
)
async def revoke_token(
    scope_type: str,
    scope_id: str,
    token_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Revoke a service token. The token is immediately invalid for all
    subsequent calls.
    """
    _validate_scope(scope_type)
    try:
        # Verify token belongs to this scope
        token = await service_token_service.get_token_metadata(token_id)
        if token.scopeType != scope_type or token.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Service token not found in this scope",
            )
        return await service_token_service.revoke_token(
            token_id=token_id,
            revoked_by=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.patch(
    "/{scope_type}/{scope_id}/tokens/{token_id}/permissions",
    response_model=ServiceTokenMetadataResponse,
    dependencies=[Depends(get_current_user), require_permission(SECRETS_UPDATE)],
)
async def update_token_permissions(
    scope_type: str,
    scope_id: str,
    token_id: str,
    request: ServiceTokenPermissionsUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Update (narrow) a token's permissions. Takes effect immediately on
    subsequent calls.

    This is the mechanism for reducing a token's access without full
    revocation (scope narrowing).
    """
    _validate_scope(scope_type)
    try:
        # Verify token belongs to this scope
        token = await service_token_service.get_token_metadata(token_id)
        if token.scopeType != scope_type or token.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Service token not found in this scope",
            )
        return await service_token_service.update_token_permissions(
            token_id=token_id,
            permissions=request.permissions,
            updated_by=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
