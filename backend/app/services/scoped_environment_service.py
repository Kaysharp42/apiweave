"""
Scoped Environment Service — business logic for scoped environments.

Handles user/org/workspace environment CRUD, default environment creation,
run environment selection, org environment allowed-workspace policy, and
protection configuration storage.

Key invariants:
- Each workspace has exactly one default environment.
- Each run selects exactly one environment (defaulting to workspace default).
- Org environments can restrict access to specific workspaces.
- No global active environment exists.
"""
from __future__ import annotations

import logging
import uuid

from app.models import (
    Environment,
    EnvironmentProtection,
    EnvironmentProtectionUpdate,
    RunEnvironmentSelection,
    ScopedEnvironmentCreate,
    ScopedEnvironmentUpdate,
)
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.services.exceptions import ConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)


# ======================================================================
# CRUD
# ======================================================================


async def create_scoped_environment(
    scope_type: str,
    scope_id: str,
    data: ScopedEnvironmentCreate,
    owner_type: str | None = None,
    is_default: bool = False,
) -> Environment:
    """Create a new scoped environment.

    Args:
        scope_type: "user", "organization", or "workspace"
        scope_id: The userId, orgId, or workspaceId
        data: Environment creation data
        owner_type: "user" or "organization"
        is_default: Whether this is the default environment for the scope
    """
    environment_id = f"env-{uuid.uuid4().hex[:12]}"
    return await ScopedEnvironmentRepository.create_from_dto(
        environment_id=environment_id,
        data=data,
        scope_type=scope_type,
        scope_id=scope_id,
        owner_type=owner_type,
        is_default=is_default,
    )


async def get_scoped_environment(environment_id: str) -> Environment:
    """Get a scoped environment by ID. Raises ResourceNotFoundError if not found."""
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")
    return env


async def list_scoped_environments(
    scope_type: str,
    scope_id: str,
) -> list[Environment]:
    """List all environments for a given scope."""
    return await ScopedEnvironmentRepository.list_by_scope(scope_type, scope_id)


async def update_scoped_environment(
    environment_id: str,
    data: ScopedEnvironmentUpdate,
) -> Environment:
    """Update a scoped environment. Raises ResourceNotFoundError if not found."""
    updated = await ScopedEnvironmentRepository.update(environment_id, data)
    if not updated:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")
    return updated


async def duplicate_scoped_environment(environment_id: str) -> Environment:
    source = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not source:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")

    data = ScopedEnvironmentCreate(
        name=f"{source.name} (Copy)",
        description=source.description,
        swaggerDocUrl=source.swaggerDocUrl,
        variables=dict(source.variables or {}),
        allowedWorkspaceIds=list(source.allowedWorkspaceIds or []),
    )
    return await create_scoped_environment(
        scope_type=source.scopeType,
        scope_id=source.scopeId or "",
        data=data,
        owner_type=source.ownerType,
        is_default=False,
    )


async def delete_scoped_environment(environment_id: str) -> None:
    """Delete a scoped environment.

    Raises ResourceNotFoundError if not found.
    Raises ConflictError if it's the default environment for a workspace.
    """
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")

    # Prevent deleting the default workspace environment
    if env.isDefault and env.scopeType == "workspace":
        raise ConflictError(
            "Cannot delete the default workspace environment. "
            "Every workspace must have exactly one default environment."
        )

    # Clean up protection config if it exists
    await ScopedEnvironmentRepository.delete_protection(environment_id)

    deleted = await ScopedEnvironmentRepository.delete(environment_id)
    if not deleted:
        raise ResourceNotFoundError(f"Failed to delete environment {environment_id}")


# ======================================================================
# Default Environment
# ======================================================================


async def create_default_workspace_environment(
    workspace_id: str,
    owner_type: str | None = None,
) -> Environment:
    """Create the default environment for a workspace.

    Called automatically when a workspace is created. Each workspace
    has exactly one default environment named 'Default'.
    """
    # Check if default already exists
    existing = await ScopedEnvironmentRepository.get_default_for_workspace(workspace_id)
    if existing:
        logger.info(
            "Default environment already exists for workspace %s: %s",
            workspace_id,
            existing.environmentId,
        )
        return existing

    data = ScopedEnvironmentCreate(
        name="Default",
        description="Default workspace environment",
        variables={},
    )
    env = await create_scoped_environment(
        scope_type="workspace",
        scope_id=workspace_id,
        data=data,
        owner_type=owner_type,
        is_default=True,
    )
    logger.info(
        "Created default environment %s for workspace %s",
        env.environmentId,
        workspace_id,
    )
    return env


async def get_default_workspace_environment(workspace_id: str) -> Environment:
    """Get the default environment for a workspace.

    Raises ResourceNotFoundError if no default exists.
    """
    env = await ScopedEnvironmentRepository.get_default_for_workspace(workspace_id)
    if not env:
        raise ResourceNotFoundError(
            f"No default environment found for workspace {workspace_id}"
        )
    return env


# ======================================================================
# Run Environment Selection
# ======================================================================


async def resolve_run_environment(
    workspace_id: str,
    org_id: str | None = None,
    explicit_environment_id: str | None = None,
) -> RunEnvironmentSelection:
    """Resolve the environment for a run.

    Each run selects exactly one environment. Resolution order:
    1. If explicit_environment_id is provided, validate and use it.
    2. Otherwise, use the workspace default environment.

    For org environments, the allowed-workspace policy is enforced.

    Raises ResourceNotFoundError if no suitable environment is found.
    Raises ConflictError if the explicit environment is not allowed.
    """
    if explicit_environment_id:
        return await _resolve_explicit_environment(
            explicit_environment_id, workspace_id, org_id
        )

    # Default to workspace default environment
    default_env = await ScopedEnvironmentRepository.get_default_for_workspace(
        workspace_id
    )
    if not default_env:
        raise ResourceNotFoundError(
            f"No default environment for workspace {workspace_id}. "
            "Workspace creation should have created one."
        )

    return RunEnvironmentSelection(
        environmentId=default_env.environmentId,
        scopeType=default_env.scopeType,
        scopeId=default_env.scopeId or "",
        name=default_env.name,
    )


async def _resolve_explicit_environment(
    environment_id: str,
    workspace_id: str,
    org_id: str | None,
) -> RunEnvironmentSelection:
    """Resolve an explicitly specified environment for a run.

    Validates that the environment exists and is accessible from the workspace.
    """
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")

    # Validate scope access
    if env.scopeType == "workspace":
        if env.scopeId != workspace_id:
            raise ConflictError(
                f"Environment {environment_id} belongs to workspace {env.scopeId}, "
                f"not {workspace_id}"
            )
    elif env.scopeType == "organization":
        # Enforce org env allowed-workspace policy
        if org_id and env.scopeId != org_id:
            raise ConflictError(
                f"Environment {environment_id} belongs to org {env.scopeId}, "
                f"not {org_id}"
            )
        is_allowed = await ScopedEnvironmentRepository.is_workspace_allowed_for_org_env(
            environment_id, workspace_id
        )
        if not is_allowed:
            raise ConflictError(
                f"Environment {environment_id} is not available to workspace {workspace_id}. "
                "Check the organization environment's allowed-workspace policy."
            )
    elif env.scopeType == "user":
        # User environments are available to all user's workspaces
        pass

    return RunEnvironmentSelection(
        environmentId=env.environmentId,
        scopeType=env.scopeType,
        scopeId=env.scopeId or "",
        name=env.name,
    )


# ======================================================================
# Org Environment Policy
# ======================================================================


async def set_org_env_allowed_workspaces(
    environment_id: str,
    workspace_ids: list[str],
) -> Environment:
    """Set the allowed-workspace policy for an org environment.

    An empty list means the environment is available to all workspaces
    in the organization.

    Raises ResourceNotFoundError if the environment doesn't exist.
    Raises ConflictError if the environment is not an org environment.
    """
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")
    if env.scopeType != "organization":
        raise ConflictError(
            f"Environment {environment_id} is scope '{env.scopeType}', "
            "not 'organization'. Only org environments have allowed-workspace policy."
        )

    updated = await ScopedEnvironmentRepository.set_allowed_workspaces(
        environment_id, workspace_ids
    )
    if not updated:
        raise ResourceNotFoundError(f"Failed to update environment {environment_id}")
    return updated


async def list_org_envs_available_for_workspace(
    org_id: str,
    workspace_id: str,
) -> list[Environment]:
    """List org environments available to a specific workspace.

    Respects the allowed-workspace policy.
    """
    return await ScopedEnvironmentRepository.list_org_envs_for_workspace(
        org_id, workspace_id
    )


# ======================================================================
# Protection Configuration
# ======================================================================


async def get_environment_protection(
    environment_id: str,
) -> EnvironmentProtection | None:
    """Get protection config for an environment. Returns None if not configured."""
    # Verify environment exists
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")
    return await ScopedEnvironmentRepository.get_protection(environment_id)


async def update_environment_protection(
    environment_id: str,
    data: EnvironmentProtectionUpdate,
) -> EnvironmentProtection:
    """Create or update protection config for an environment.

    Raises ResourceNotFoundError if the environment doesn't exist.
    """
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")

    protection_id = f"prot-{uuid.uuid4().hex[:12]}"
    return await ScopedEnvironmentRepository.upsert_protection(
        protection_id=protection_id,
        environment_id=environment_id,
        data=data,
    )


async def delete_environment_protection(environment_id: str) -> None:
    """Remove protection config from an environment."""
    env = await ScopedEnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ResourceNotFoundError(f"Environment {environment_id} not found")
    await ScopedEnvironmentRepository.delete_protection(environment_id)


# ======================================================================
# Helpers
# ======================================================================


async def list_all_accessible_environments(
    workspace_id: str,
    user_id: str | None = None,
    org_id: str | None = None,
) -> list[Environment]:
    """List all environments accessible for a workspace.

    Includes:
    - Workspace environments
    - User environments (if user_id provided)
    - Org environments available to this workspace (if org_id provided)
    """
    envs: list[Environment] = []

    # Workspace environments
    ws_envs = await ScopedEnvironmentRepository.list_by_scope("workspace", workspace_id)
    envs.extend(ws_envs)

    # User environments
    if user_id:
        user_envs = await ScopedEnvironmentRepository.list_by_scope("user", user_id)
        envs.extend(user_envs)

    # Org environments (filtered by allowed-workspace policy)
    if org_id:
        org_envs = await ScopedEnvironmentRepository.list_org_envs_for_workspace(
            org_id, workspace_id
        )
        envs.extend(org_envs)

    return envs
