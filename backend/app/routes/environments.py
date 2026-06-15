"""
Environment API routes
CRUD operations for environments
Now using shared service layer
"""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.auth.dependencies import require_permission
from app.auth.permissions import ENVIRONMENTS_CREATE, ENVIRONMENTS_DELETE, ENVIRONMENTS_READ, ENVIRONMENTS_UPDATE
from app.repositories import EnvironmentRepository
from app.services import (
    list_environments as svc_list_environments,
    get_environment as svc_get_environment,
    get_active_environment as svc_get_active_environment,
    create_environment as svc_create_environment,
    update_environment as svc_update_environment,
    delete_environment as svc_delete_environment,
    activate_environment as svc_activate_environment,
    duplicate_environment as svc_duplicate_environment,
    get_public_key_b64,
    get_sealed_box_key_id,
    get_sealed_box_algorithm,
    open_sealed_box,
)
from app.services.environment_service import (
    set_environment_secret,
    delete_environment_secret,
)
from app.services.secret_crypto import encrypt as crypto_encrypt
from app.services.exceptions import ConflictError

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.post("", response_model=Environment, status_code=status.HTTP_201_CREATED, dependencies=[require_permission(ENVIRONMENTS_CREATE)])
async def create_environment(environment: EnvironmentCreate):
    """Create a new environment"""
    return await svc_create_environment(environment)


@router.get("", response_model=List[Environment], dependencies=[require_permission(ENVIRONMENTS_READ)])
async def list_environments():
    """List all environments"""
    return await svc_list_environments()


@router.get("/{environment_id}", response_model=Environment, dependencies=[require_permission(ENVIRONMENTS_READ)])
async def get_environment(environment_id: str):
    """Get an environment by ID"""
    try:
        return await svc_get_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/active/current", response_model=Environment, dependencies=[require_permission(ENVIRONMENTS_READ)])
async def get_active_environment():
    """Get the currently active environment"""
    try:
        return await svc_get_active_environment()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.put("/{environment_id}", response_model=Environment, dependencies=[require_permission(ENVIRONMENTS_UPDATE)])
async def update_environment(environment_id: str, update: EnvironmentUpdate):
    """Update an environment"""
    try:
        return await svc_update_environment(environment_id, update)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[require_permission(ENVIRONMENTS_DELETE)])
async def delete_environment(environment_id: str):
    """Delete an environment"""
    try:
        await svc_delete_environment(environment_id)
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/{environment_id}/activate", response_model=Environment, dependencies=[require_permission(ENVIRONMENTS_UPDATE)])
async def activate_environment(environment_id: str):
    """Set an environment as active - deactivates all others"""
    try:
        return await svc_activate_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/{environment_id}/duplicate", response_model=Environment, status_code=status.HTTP_201_CREATED, dependencies=[require_permission(ENVIRONMENTS_CREATE)])
async def duplicate_environment(environment_id: str):
    """Duplicate an existing environment"""
    try:
        return await svc_duplicate_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# ---------------------------------------------------------------------------
# Secret value endpoints (T10 — encrypted write, masked display)
# ---------------------------------------------------------------------------


class SecretPublicKeyResponse(BaseModel):
    """Response for the sealed-box public key endpoint."""
    key_id: str
    public_key: str
    algorithm: str


class SetSecretRequest(BaseModel):
    """Request body for setting an encrypted secret value."""
    key: str
    encrypted_value: str
    key_id: str


@router.get(
    "/{environment_id}/secrets/public-key",
    response_model=SecretPublicKeyResponse,
    dependencies=[require_permission(ENVIRONMENTS_READ)],
)
async def get_secret_public_key(environment_id: str):
    """Return the sealed-box public key for encrypting secret values.

    NEVER returns the private key. The frontend uses this to encrypt
    secret values before sending them to the POST endpoint.
    """
    try:
        await svc_get_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    return SecretPublicKeyResponse(
        key_id=get_sealed_box_key_id(),
        public_key=get_public_key_b64(),
        algorithm=get_sealed_box_algorithm(),
    )


@router.post(
    "/{environment_id}/secrets",
    response_model=Environment,
    dependencies=[require_permission(ENVIRONMENTS_UPDATE)],
)
async def set_secret_value(environment_id: str, body: SetSecretRequest):
    """Set a secret value on an environment.

    Accepts sealed-box ciphertext, decrypts it server-side, then
    re-encrypts with AES-256-GCM envelope storage. The plaintext
    value is never returned in the response.
    """
    try:
        await svc_get_environment(environment_id)

        if body.key_id != get_sealed_box_key_id():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown key_id: {body.key_id}. Fetch the current public key first.",
            )

        try:
            plaintext = open_sealed_box(body.encrypted_value)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to decrypt sealed-box ciphertext. Ensure you are using the correct public key.",
            ) from exc

        blob = await crypto_encrypt(plaintext)
        import json
        encrypted_json = json.dumps(blob.model_dump())
        await set_environment_secret(environment_id, body.key, encrypted_json)

        return await svc_get_environment(environment_id)

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete(
    "/{environment_id}/secrets/{secret_key}",
    response_model=Environment,
    dependencies=[require_permission(ENVIRONMENTS_UPDATE)],
)
async def unset_secret_value(environment_id: str, secret_key: str):
    """Remove a secret key from an environment."""
    try:
        return await delete_environment_secret(environment_id, secret_key)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
