"""
Organization-scoped environment endpoints.

Routes under /api/orgs/{org_id}/environments.
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
# Organization Environments: /api/orgs/{org_id}/environments
# ======================================================================


@router.get(
    "/api/orgs/{org_id}/environments",
    response_model=list[Environment],
)
async def list_org_environments(
    org_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> list[Environment]:
    """List all organization-scoped environments."""
    return await svc.list_scoped_environments("organization", org_id)


@router.post(
    "/api/orgs/{org_id}/environments",
    response_model=Environment,
    status_code=status.HTTP_201_CREATED,
)
async def create_org_environment(
    org_id: str,
    data: ScopedEnvironmentCreate,
    _user: User = require_scoped_permission("environments", "create"),
) -> Environment:
    """Create a new organization-scoped environment.

    Org environments can restrict access to specific workspaces via
    the allowedWorkspaceIds field.
    """
    try:
        return await svc.create_scoped_environment(
            scope_type="organization",
            scope_id=org_id,
            data=data,
            owner_type="organization",
        )
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.get(
    "/api/orgs/{org_id}/environments/{environment_id}",
    response_model=Environment,
)
async def get_org_environment(
    org_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> Environment:
    """Get an organization-scoped environment by ID."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "organization" or env.scopeId != org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in org scope",
            )
        return env
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.put(
    "/api/orgs/{org_id}/environments/{environment_id}",
    response_model=Environment,
)
async def update_org_environment(
    org_id: str,
    environment_id: str,
    data: ScopedEnvironmentUpdate,
    _user: User = require_scoped_permission("environments", "update"),
) -> Environment:
    """Update an organization-scoped environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "organization" or env.scopeId != org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in org scope",
            )
        return await svc.update_scoped_environment(environment_id, data)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.delete(
    "/api/orgs/{org_id}/environments/{environment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_org_environment(
    org_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "delete"),
):
    """Delete an organization-scoped environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "organization" or env.scopeId != org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in org scope",
            )
        await svc.delete_scoped_environment(environment_id)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.put(
    "/api/orgs/{org_id}/environments/{environment_id}/allowed-workspaces",
    response_model=Environment,
)
async def set_org_env_allowed_workspaces(
    org_id: str,
    environment_id: str,
    body: dict[str, list[str]],
    _user: User = require_scoped_permission("environments", "update"),
) -> Environment:
    """Set the allowed-workspace policy for an org environment.

    Body: {"workspaceIds": ["ws-abc", "ws-def"]}
    Empty list means available to all org workspaces.
    """
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "organization" or env.scopeId != org_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in org scope",
            )
        workspace_ids = body.get("workspaceIds", [])
        return await svc.set_org_env_allowed_workspaces(environment_id, workspace_ids)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.get(
    "/api/orgs/{org_id}/environments/available-for/{workspace_id}",
    response_model=list[Environment],
)
async def list_org_envs_for_workspace(
    org_id: str,
    workspace_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> list[Environment]:
    """List org environments available to a specific workspace.

    Respects the allowed-workspace policy.
    """
    return await svc.list_org_envs_available_for_workspace(org_id, workspace_id)
