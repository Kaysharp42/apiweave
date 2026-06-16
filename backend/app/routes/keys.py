"""
Scoped keypair API routes.

Exposes public-key retrieval for clients encrypting secret values and
manual key rotation for administrators.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.auth.dependencies import get_current_user, require_permission
from app.auth.permissions import ENVIRONMENTS_SET_SECRET
from app.models import PublicKeyResponse, User
from app.services.scoped_secrets import get_public_key, rotate_keypair

router = APIRouter(prefix="/api/secrets", tags=["keys"])


class RotateRequest(BaseModel):
    scopeType: str
    scopeId: str


class RotateResponse(BaseModel):
    keyId: str
    publicKey: str
    algorithm: str
    previousKeyId: str | None = None


@router.get(
    "/public-key",
    response_model=PublicKeyResponse,
    dependencies=[Depends(get_current_user)],
)
async def public_key(scope: str, id: str):
    """Return the active public key for a scope.

    Clients use this to encrypt secret values before POSTing.
    """
    valid_scopes = {"user", "organization", "workspace", "environment"}
    if scope not in valid_scopes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scope type. Must be one of: {', '.join(sorted(valid_scopes))}",
        )
    if not id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scope ID is required",
        )
    return await get_public_key(scope, id)


@router.post(
    "/keys/rotate",
    response_model=RotateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_permission(ENVIRONMENTS_SET_SECRET)],
)
async def rotate_keys(
    request: RotateRequest,
    current_user: User = Depends(get_current_user),
):
    """Manually rotate the keypair for a scope (admin only).

    The old keypair is retained (marked inactive) so that previously
    encrypted ciphertexts remain decryptable.
    """
    valid_scopes = {"user", "organization", "workspace", "environment"}
    if request.scopeType not in valid_scopes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scope type. Must be one of: {', '.join(sorted(valid_scopes))}",
        )
    if not request.scopeId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scope ID is required",
        )

    from app.services.scoped_secrets import get_or_create_keypair

    existing = await get_or_create_keypair(request.scopeType, request.scopeId)
    previous_key_id = existing.keyId

    result = await rotate_keypair(request.scopeType, request.scopeId)

    return RotateResponse(
        keyId=result.keyId,
        publicKey=result.publicKey,
        algorithm=result.algorithm,
        previousKeyId=previous_key_id,
    )
