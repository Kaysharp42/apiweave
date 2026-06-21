"""
User-scoped environment endpoints.

Routes under /api/users/{user_id}/environments.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException, status

from app.auth.dependencies import require_scoped_permission
from app.models import (
    Environment,
    ScopedEnvironmentCreate,
    ScopedEnvironmentUpdate,
    User,
)
from app.services import scoped_environment_service as svc
from app.services.exceptions import ConflictError, ResourceNotFoundError

from ._router import router

logger = logging.getLogger(__name__)


# ======================================================================
# Helpers
# ======================================================================


def _handle_service_error(exc: Exception):
    """Convert service exceptions to HTTP errors."""
    if isinstance(exc, ResourceNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    if isinstance(exc, ConflictError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    raise exc


# ======================================================================
# User Environments: /api/users/{user_id}/environments
# ======================================================================


@router.get(
    "/api/users/{user_id}/environments",
    response_model=list[Environment],
)
async def list_user_environments(
    user_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> list[Environment]:
    """List all user-scoped environments."""
    return await svc.list_scoped_environments("user", user_id)


@router.post(
    "/api/users/{user_id}/environments",
    response_model=Environment,
    status_code=status.HTTP_201_CREATED,
)
async def create_user_environment(
    user_id: str,
    data: ScopedEnvironmentCreate,
    _user: User = require_scoped_permission("environments", "create"),
) -> Environment:
    """Create a new user-scoped environment."""
    try:
        return await svc.create_scoped_environment(
            scope_type="user",
            scope_id=user_id,
            data=data,
            owner_type="user",
        )
    except Exception as exc:
        _handle_service_error(exc)
        raise  # unreachable, satisfies type checker


@router.get(
    "/api/users/{user_id}/environments/{environment_id}",
    response_model=Environment,
)
async def get_user_environment(
    user_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> Environment:
    """Get a user-scoped environment by ID."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "user" or env.scopeId != user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in user scope",
            )
        return env
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.put(
    "/api/users/{user_id}/environments/{environment_id}",
    response_model=Environment,
)
async def update_user_environment(
    user_id: str,
    environment_id: str,
    data: ScopedEnvironmentUpdate,
    _user: User = require_scoped_permission("environments", "update"),
) -> Environment:
    """Update a user-scoped environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "user" or env.scopeId != user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in user scope",
            )
        return await svc.update_scoped_environment(environment_id, data)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.delete(
    "/api/users/{user_id}/environments/{environment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_user_environment(
    user_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "delete"),
):
    """Delete a user-scoped environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "user" or env.scopeId != user_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in user scope",
            )
        await svc.delete_scoped_environment(environment_id)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise
