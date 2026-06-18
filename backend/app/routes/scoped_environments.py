"""
Scoped Environment API routes.

GitHub-style nested route structure for user/org/workspace environments.
Each run selects exactly one environment (defaulting to workspace default).
Org environments support allowed-workspace policy.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.auth.dependencies import require_scoped_permission
from app.models import (
    Environment,
    EnvironmentProtection,
    EnvironmentProtectionUpdate,
    RunEnvironmentSelection,
    ScopedEnvironmentCreate,
    ScopedEnvironmentUpdate,
    User,
)
from app.services import scoped_environment_service as svc
from app.services.exceptions import ConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["scoped-environments"])


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


# ======================================================================
# Workspace Environments: /api/workspaces/{workspace_id}/environments
# ======================================================================


@router.get(
    "/api/workspaces/{workspace_id}/environments",
    response_model=list[Environment],
)
async def list_workspace_environments(
    workspace_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> list[Environment]:
    """List all workspace-scoped environments."""
    return await svc.list_scoped_environments("workspace", workspace_id)


@router.post(
    "/api/workspaces/{workspace_id}/environments",
    response_model=Environment,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace_environment(
    workspace_id: str,
    data: ScopedEnvironmentCreate,
    _user: User = require_scoped_permission("environments", "create"),
) -> Environment:
    """Create a new workspace-scoped environment."""
    try:
        return await svc.create_scoped_environment(
            scope_type="workspace",
            scope_id=workspace_id,
            data=data,
            owner_type="user",  # Workspace owner type determined by workspace
        )
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.get(
    "/api/workspaces/{workspace_id}/environments/default",
    response_model=Environment,
)
async def get_workspace_default_environment(
    workspace_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> Environment:
    """Get the default environment for a workspace."""
    try:
        return await svc.get_default_workspace_environment(workspace_id)
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.post(
    "/api/workspaces/{workspace_id}/environments/resolve",
    response_model=RunEnvironmentSelection,
)
async def resolve_run_environment(
    workspace_id: str,
    body: dict[str, Any] | None = None,
    _user: User = require_scoped_permission("environments", "read"),
) -> RunEnvironmentSelection:
    """Resolve the environment for a run.

    Each run selects exactly one environment. If no explicit environment
    is provided in the body, the workspace default is used.

    Body (optional): {"environmentId": "env-xxx", "orgId": "org-xxx"}
    """
    body = body or {}
    try:
        return await svc.resolve_run_environment(
            workspace_id=workspace_id,
            org_id=body.get("orgId"),
            explicit_environment_id=body.get("environmentId"),
        )
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.get(
    "/api/workspaces/{workspace_id}/environments/all-accessible",
    response_model=list[Environment],
)
async def list_all_accessible_environments(
    workspace_id: str,
    org_id: str | None = None,
    user: User = require_scoped_permission("environments", "read"),
) -> list[Environment]:
    """List all environments accessible for a workspace.

    Includes workspace, user, and org environments (filtered by policy).
    """
    return await svc.list_all_accessible_environments(
        workspace_id=workspace_id,
        user_id=user.userId,
        org_id=org_id,
    )


@router.get(
    "/api/workspaces/{workspace_id}/environments/{environment_id}",
    response_model=Environment,
)
async def get_workspace_environment(
    workspace_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> Environment:
    """Get a workspace-scoped environment by ID."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        return env
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.put(
    "/api/workspaces/{workspace_id}/environments/{environment_id}",
    response_model=Environment,
)
async def update_workspace_environment(
    workspace_id: str,
    environment_id: str,
    data: ScopedEnvironmentUpdate,
    _user: User = require_scoped_permission("environments", "update"),
) -> Environment:
    """Update a workspace-scoped environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        return await svc.update_scoped_environment(environment_id, data)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.delete(
    "/api/workspaces/{workspace_id}/environments/{environment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_workspace_environment(
    workspace_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "delete"),
):
    """Delete a workspace-scoped environment.

    Cannot delete the default workspace environment.
    """
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        await svc.delete_scoped_environment(environment_id)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.post(
    "/api/workspaces/{workspace_id}/environments/{environment_id}/duplicate",
    response_model=Environment,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_workspace_environment(
    workspace_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "create"),
) -> Environment:
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        return await svc.duplicate_scoped_environment(environment_id)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise






@router.get(
    "/api/workspaces/{workspace_id}/environments/{environment_id}/protection",
    response_model=EnvironmentProtection | dict[str, str],
)
async def get_environment_protection(
    workspace_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "read"),
) -> EnvironmentProtection | dict[str, str]:
    """Get protection config for a workspace environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        protection = await svc.get_environment_protection(environment_id)
        if not protection:
            return {"status": "unprotected"}
        return protection
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.put(
    "/api/workspaces/{workspace_id}/environments/{environment_id}/protection",
    response_model=EnvironmentProtection,
)
async def update_environment_protection(
    workspace_id: str,
    environment_id: str,
    data: EnvironmentProtectionUpdate,
    _user: User = require_scoped_permission("environments", "update"),
) -> EnvironmentProtection:
    """Create or update protection config for a workspace environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        return await svc.update_environment_protection(environment_id, data)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise


@router.delete(
    "/api/workspaces/{workspace_id}/environments/{environment_id}/protection",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_environment_protection(
    workspace_id: str,
    environment_id: str,
    _user: User = require_scoped_permission("environments", "update"),
):
    """Remove protection config from a workspace environment."""
    try:
        env = await svc.get_scoped_environment(environment_id)
        if env.scopeType != "workspace" or env.scopeId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Environment {environment_id} not found in workspace scope",
            )
        await svc.delete_environment_protection(environment_id)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise



