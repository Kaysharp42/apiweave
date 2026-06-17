"""
Environment API routes
CRUD operations for environments
Now using shared service layer
"""

from fastapi import APIRouter, HTTPException, status

from app.auth.dependencies import require_permission
from app.auth.permissions import (
    ENVIRONMENTS_CREATE,
    ENVIRONMENTS_DELETE,
    ENVIRONMENTS_READ,
    ENVIRONMENTS_UPDATE,
)
from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.services import (
    create_environment as svc_create_environment,
)
from app.services import (
    delete_environment as svc_delete_environment,
)
from app.services import (
    duplicate_environment as svc_duplicate_environment,
)
from app.services import (
    get_environment as svc_get_environment,
)
from app.services import (
    list_environments as svc_list_environments,
)
from app.services import (
    update_environment as svc_update_environment,
)
from app.services.exceptions import ConflictError

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.post("", response_model=Environment, status_code=status.HTTP_201_CREATED, dependencies=[require_permission(ENVIRONMENTS_CREATE)])
async def create_environment(environment: EnvironmentCreate):
    """Create a new environment"""
    return await svc_create_environment(environment)


@router.get("", response_model=list[Environment], dependencies=[require_permission(ENVIRONMENTS_READ)])
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


@router.post("/{environment_id}/duplicate", response_model=Environment, status_code=status.HTTP_201_CREATED, dependencies=[require_permission(ENVIRONMENTS_CREATE)])
async def duplicate_environment(environment_id: str):
    """Duplicate an existing environment"""
    try:
        return await svc_duplicate_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# NOTE: Old secret value endpoints (public-key, POST secrets, DELETE secrets/{key})
# have been REMOVED as part of the GitHub-style scoped secrets refactor.
# Secret management is now through scoped API routes:
#   GET  /api/secrets/public-key?scope=...&id=...
#   POST /api/scopes/{scope_type}/{scope_id}/secrets
#   PUT  /api/scopes/{scope_type}/{scope_id}/secrets/{secret_id}
#   DELETE /api/scopes/{scope_type}/{scope_id}/secrets/{secret_id}
