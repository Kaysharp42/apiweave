"""
Scoped Secret API routes — GitHub-like secret management.

Provides CRUD endpoints for scoped secrets with:
- Client-encrypted writes only (sealed-box ciphertext)
- Metadata-only reads (no ciphertext/value in responses)
- User-secret binding to workspace/environment

Route structure:
    /api/scopes/{scope_type}/{scope_id}/secrets
    /api/scopes/{scope_type}/{scope_id}/secrets/{secret_id}
    /api/scopes/{scope_type}/{scope_id}/secrets/bindings
    /api/scopes/{scope_type}/{scope_id}/secrets/bindings/{binding_id}
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_scope_permission
from app.models import (
    SecretBindingCreateRequest,
    SecretBindingResponse,
    SecretCreateRequest,
    SecretMetadataResponse,
    User,
)
from app.services import secret_binding_service, secret_service
from app.services.exceptions import ConflictError, ResourceNotFoundError

router = APIRouter(prefix="/api/scopes", tags=["secrets"])

VALID_SCOPE_TYPES = {"user", "organization", "workspace", "environment"}


def _validate_scope(scope_type: str):
    """Validate scope type is one of the allowed values."""
    if scope_type not in VALID_SCOPE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scope type. Must be one of: {', '.join(sorted(VALID_SCOPE_TYPES))}",
        )


# ============================================================================
# Secret CRUD Endpoints
# ============================================================================


class SecretListResponse(BaseModel):
    """Response for listing secrets in a scope."""

    secrets: list[SecretMetadataResponse]
    total: int


@router.get(
    "/{scope_type}/{scope_id}/secrets",
    response_model=SecretListResponse,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "read")],
)
async def list_secrets(scope_type: str, scope_id: str):
    """
    List all secrets in a scope.

    Returns metadata only — no ciphertext or plaintext values.
    """
    _validate_scope(scope_type)
    secrets_list = await secret_service.list_secrets(scope_type, scope_id)
    return SecretListResponse(secrets=secrets_list, total=len(secrets_list))


@router.get(
    "/{scope_type}/{scope_id}/secrets/{secret_id}",
    response_model=SecretMetadataResponse,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "read")],
)
async def get_secret(scope_type: str, scope_id: str, secret_id: str):
    """
    Get secret metadata by ID.

    Returns metadata only — no ciphertext or plaintext values.
    """
    _validate_scope(scope_type)
    try:
        secret = await secret_service.get_secret_metadata(secret_id)
        # Verify secret belongs to this scope
        if secret.scopeType != scope_type or secret.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Secret not found in this scope",
            )
        return secret
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


@router.post(
    "/{scope_type}/{scope_id}/secrets",
    response_model=SecretMetadataResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "create")],
)
async def create_secret(
    scope_type: str,
    scope_id: str,
    request: SecretCreateRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Create a new scoped secret.

    Accepts client-encrypted sealed-box ciphertext. The plaintext value
    is never sent to or stored by the server in decrypted form.
    """
    _validate_scope(scope_type)
    try:
        return await secret_service.create_secret(
            scope_type=scope_type,
            scope_id=scope_id,
            request=request,
            actor="user",
            actor_id=current_user.userId,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.put(
    "/{scope_type}/{scope_id}/secrets/{secret_id}",
    response_model=SecretMetadataResponse,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "update")],
)
async def update_secret(
    scope_type: str,
    scope_id: str,
    secret_id: str,
    request: SecretCreateRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Update an existing secret's ciphertext.

    The secret name in the request must match the existing secret's name.
    To rename a secret, delete and recreate it.
    """
    _validate_scope(scope_type)
    try:
        secret = await secret_service.get_secret_metadata(secret_id)
        # Verify secret belongs to this scope
        if secret.scopeType != scope_type or secret.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Secret not found in this scope",
            )
        return await secret_service.update_secret(
            secret_id=secret_id,
            request=request,
            actor="user",
            actor_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.delete(
    "/{scope_type}/{scope_id}/secrets/{secret_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "delete")],
)
async def delete_secret(
    scope_type: str,
    scope_id: str,
    secret_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Delete a secret.
    """
    _validate_scope(scope_type)
    try:
        secret = await secret_service.get_secret_metadata(secret_id)
        # Verify secret belongs to this scope
        if secret.scopeType != scope_type or secret.scopeId != scope_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Secret not found in this scope",
            )
        await secret_service.delete_secret(
            secret_id=secret_id,
            actor="user",
            actor_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )


# ============================================================================
# Secret Binding Endpoints
# ============================================================================


class BindingListResponse(BaseModel):
    """Response for listing bindings."""

    bindings: list[SecretBindingResponse]
    total: int


@router.get(
    "/{scope_type}/{scope_id}/secrets/bindings",
    response_model=BindingListResponse,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "read")],
)
async def list_bindings(scope_type: str, scope_id: str):
    """
    List all bindings for a workspace or environment.

    Returns bindings where user-scoped secrets are bound to this target.
    """
    _validate_scope(scope_type)
    if scope_type not in ("workspace", "environment"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bindings are only available for workspace and environment scopes",
        )
    bindings = await secret_binding_service.list_bindings_for_target(
        target_scope_type=scope_type,
        target_scope_id=scope_id,
    )
    return BindingListResponse(bindings=bindings, total=len(bindings))


@router.post(
    "/{scope_type}/{scope_id}/secrets/bindings",
    response_model=SecretBindingResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "create")],
)
async def create_binding(
    scope_type: str,
    scope_id: str,
    request: SecretBindingCreateRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Bind a user-scoped secret to a workspace or environment.

    The secret must exist and be in the user scope.
    """
    _validate_scope(scope_type)
    if scope_type not in ("workspace", "environment"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bindings are only available for workspace and environment scopes",
        )
    # Verify target matches request
    if request.targetScopeType != scope_type or request.targetScopeId != scope_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Binding target must match the route scope",
        )
    try:
        return await secret_binding_service.bind_user_secret(
            user_id=current_user.userId,
            request=request,
            actor="user",
            actor_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        )


@router.delete(
    "/{scope_type}/{scope_id}/secrets/bindings/{binding_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user), require_scope_permission("secrets", "delete")],
)
async def delete_binding(
    scope_type: str,
    scope_id: str,
    binding_id: str,
    current_user: User = Depends(get_current_user),
):
    """
    Remove a user-secret binding.
    """
    _validate_scope(scope_type)
    try:
        await secret_binding_service.unbind_user_secret(
            binding_id=binding_id,
            user_id=current_user.userId,
            actor="user",
            actor_id=current_user.userId,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
