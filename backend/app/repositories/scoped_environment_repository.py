"""
Scoped Environment Repository — data access for scoped environments.

Handles user, organization, and workspace scoped environments with
support for default environments, allowed-workspace policies, and
protection configuration.
"""
from datetime import UTC, datetime

from app.models import (
    Environment,
    EnvironmentProtection,
    EnvironmentProtectionUpdate,
    ScopedEnvironmentCreate,
    ScopedEnvironmentUpdate,
)


class ScopedEnvironmentRepository:
    """Repository for scoped Environment CRUD and policy operations."""

    # ------------------------------------------------------------------
    # Create
    # ------------------------------------------------------------------

    @staticmethod
    async def create(
        environment_id: str,
        name: str,
        scope_type: str,
        scope_id: str,
        owner_type: str | None = None,
        variables: dict | None = None,
        is_default: bool = False,
        allowed_workspace_ids: list[str] | None = None,
        description: str | None = None,
    ) -> Environment:
        now = datetime.now(UTC)
        env = Environment(
            environmentId=environment_id,
            name=name,
            description=description,
            scopeType=scope_type,
            scopeId=scope_id,
            ownerType=owner_type,
            variables=variables or {},
            isDefault=is_default,
            allowedWorkspaceIds=allowed_workspace_ids or [],
            createdAt=now,
            updatedAt=now,
        )
        await env.insert()
        return env

    @staticmethod
    async def create_from_dto(
        environment_id: str,
        data: ScopedEnvironmentCreate,
        scope_type: str,
        scope_id: str,
        owner_type: str | None = None,
        is_default: bool = False,
    ) -> Environment:
        """Create from a ScopedEnvironmentCreate DTO."""
        return await ScopedEnvironmentRepository.create(
            environment_id=environment_id,
            name=data.name,
            scope_type=scope_type,
            scope_id=scope_id,
            owner_type=owner_type,
            variables=data.variables,
            is_default=is_default,
            allowed_workspace_ids=data.allowedWorkspaceIds,
            description=data.description,
        )

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    @staticmethod
    async def get_by_id(environment_id: str) -> Environment | None:
        return await Environment.find_one(
            Environment.environmentId == environment_id
        )

    @staticmethod
    async def list_by_scope(scope_type: str, scope_id: str) -> list[Environment]:
        return await Environment.find(
            Environment.scopeType == scope_type,
            Environment.scopeId == scope_id,
        ).sort("-createdAt").to_list()  # type: ignore[misc]

    @staticmethod
    async def get_default_for_workspace(workspace_id: str) -> Environment | None:
        return await Environment.find_one(
            Environment.scopeType == "workspace",
            Environment.scopeId == workspace_id,
            Environment.isDefault == True,  # noqa: E712
        )

    @staticmethod
    async def get_default_for_scope(scope_type: str, scope_id: str) -> Environment | None:
        """Get the default environment for any scope (workspace preferred)."""
        return await Environment.find_one(
            Environment.scopeType == scope_type,
            Environment.scopeId == scope_id,
            Environment.isDefault == True,  # noqa: E712
        )

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    @staticmethod
    async def update(
        environment_id: str,
        data: ScopedEnvironmentUpdate,
    ) -> Environment | None:
        env = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if not env:
            return None

        update_dict = data.model_dump(exclude_unset=True)
        update_dict["updatedAt"] = datetime.now(UTC)

        for key, value in update_dict.items():
            setattr(env, key, value)

        await env.save()
        return env

    @staticmethod
    async def update_variables(
        environment_id: str,
        variables: dict,
    ) -> Environment | None:
        env = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if not env:
            return None
        env.variables = variables
        env.updatedAt = datetime.now(UTC)
        await env.save()
        return env

    @staticmethod
    async def set_allowed_workspaces(
        environment_id: str,
        workspace_ids: list[str],
    ) -> Environment | None:
        """Set the allowed-workspace policy for an org environment."""
        env = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if not env:
            return None
        env.allowedWorkspaceIds = workspace_ids
        env.updatedAt = datetime.now(UTC)
        await env.save()
        return env

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    @staticmethod
    async def delete(environment_id: str) -> bool:
        env = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if not env:
            return False
        await env.delete()
        return True

    # ------------------------------------------------------------------
    # Org environment policy
    # ------------------------------------------------------------------

    @staticmethod
    async def is_workspace_allowed_for_org_env(
        environment_id: str,
        workspace_id: str,
    ) -> bool:
        """Check if a workspace is allowed to use an org environment.

        If allowedWorkspaceIds is empty, the org env is available to all
        workspaces in the org. Otherwise, only listed workspaces can use it.
        """
        env = await ScopedEnvironmentRepository.get_by_id(environment_id)
        if not env:
            return False
        if env.scopeType != "organization":
            # Non-org environments don't have workspace restrictions
            return True
        if not env.allowedWorkspaceIds:
            # Empty list means available to all org workspaces
            return True
        return workspace_id in env.allowedWorkspaceIds

    @staticmethod
    async def list_org_envs_for_workspace(
        org_id: str,
        workspace_id: str,
    ) -> list[Environment]:
        """List org environments available to a specific workspace."""
        all_org_envs = await ScopedEnvironmentRepository.list_by_scope(
            "organization", org_id
        )
        available = []
        for env in all_org_envs:
            if not env.allowedWorkspaceIds or workspace_id in env.allowedWorkspaceIds:
                available.append(env)
        return available

    # ------------------------------------------------------------------
    # Protection config
    # ------------------------------------------------------------------

    @staticmethod
    async def get_protection(environment_id: str) -> EnvironmentProtection | None:
        return await EnvironmentProtection.find_one(
            EnvironmentProtection.environmentId == environment_id
        )

    @staticmethod
    async def upsert_protection(
        protection_id: str,
        environment_id: str,
        data: EnvironmentProtectionUpdate,
    ) -> EnvironmentProtection:
        existing = await ScopedEnvironmentRepository.get_protection(environment_id)
        now = datetime.now(UTC)

        if existing:
            update_dict = data.model_dump(exclude_unset=True)
            update_dict["updatedAt"] = now
            for key, value in update_dict.items():
                setattr(existing, key, value)
            await existing.save()
            return existing

        protection = EnvironmentProtection(
            protectionId=protection_id,
            environmentId=environment_id,
            requiredReviewers=data.requiredReviewers or [],
            allowSelfApproval=(
                data.allowSelfApproval if data.allowSelfApproval is not None else False
            ),
            bypassPolicy=data.bypassPolicy or "none",
            bypassAllowlist=data.bypassAllowlist or [],
            createdAt=now,
            updatedAt=now,
        )
        await protection.insert()
        return protection

    @staticmethod
    async def delete_protection(environment_id: str) -> bool:
        protection = await ScopedEnvironmentRepository.get_protection(environment_id)
        if not protection:
            return False
        await protection.delete()
        return True
