"""
Environment service — shared business logic for environment CRUD with secret-safe DTOs.
Called by both FastAPI routes and MCP tools.
"""
from typing import Any

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.repositories import EnvironmentRepository
from app.services.secret_utils import sanitize_secrets_in_dict


async def list_environments() -> list[Environment]:
    """List all environments."""
    envs, _ = await EnvironmentRepository.list_all(skip=0, limit=1000)
    return envs


async def get_environment(environment_id: str) -> Environment:
    """Get an environment by ID. Raises ValueError if not found."""
    env = await EnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ValueError(f"Environment {environment_id} not found")
    return env


async def get_active_environment() -> Environment:
    """Get the currently active environment. Raises ValueError if none set."""
    env = await EnvironmentRepository.get_active()
    if not env:
        raise ValueError("No active environment set")
    return env


async def create_environment(data: EnvironmentCreate) -> Environment:
    """Create a new environment."""
    return await EnvironmentRepository.create(data)


async def update_environment(
    environment_id: str, data: EnvironmentUpdate
) -> Environment:
    """Update an environment. Raises ValueError if not found."""
    if data.isActive:
        await EnvironmentRepository.set_active(environment_id)
    updated = await EnvironmentRepository.update(environment_id, data)
    if not updated:
        raise ValueError(f"Environment {environment_id} not found")
    return updated


async def delete_environment(environment_id: str) -> None:
    """Delete an environment. Raises ValueError if not found or referenced."""
    env = await EnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ValueError(f"Environment {environment_id} not found")

    from app.models import Workflow

    count = await Workflow.find(Workflow.environmentId == environment_id).count()
    if count > 0:
        raise ValueError(
            f"Cannot delete environment. {count} workflow(s) are still attached to it."
        )

    success = await EnvironmentRepository.delete(environment_id)
    if not success:
        raise ValueError("Failed to delete environment")


async def activate_environment(environment_id: str) -> Environment:
    """Set an environment as active. Raises ValueError if not found."""
    env = await EnvironmentRepository.set_active(environment_id)
    if not env:
        raise ValueError(f"Environment {environment_id} not found")
    return env


async def duplicate_environment(environment_id: str) -> Environment:
    """Duplicate an environment. Raises ValueError if not found."""
    source = await EnvironmentRepository.get_by_id(environment_id)
    if not source:
        raise ValueError(f"Environment {environment_id} not found")

    dup = EnvironmentCreate(
        name=f"{source.name} (Copy)",
        description=source.description,
        swaggerDocUrl=source.swaggerDocUrl,
        variables=source.variables.copy() if source.variables else {},
        secrets=source.secrets.copy() if source.secrets else {},
    )
    return await EnvironmentRepository.create(dup)


def redact_environment_for_export(env: Environment) -> dict[str, Any]:
    """Return an environment dict with secrets redacted for MCP/export responses."""
    env_dict = env.model_dump(by_alias=True)
    secret_refs: list[str] = []
    if env_dict.get("secrets"):
        env_dict["secrets"] = {k: "<SECRET>" for k in env_dict["secrets"]}
    if env_dict.get("variables"):
        env_dict["variables"] = sanitize_secrets_in_dict(
            env_dict["variables"], secret_refs, "variables"
        )
    return env_dict


async def list_environments_redacted() -> list[dict[str, Any]]:
    """List all environments with secrets redacted."""
    envs = await list_environments()
    return [redact_environment_for_export(e) for e in envs]


async def get_active_environment_redacted() -> dict[str, Any]:
    """Get active environment with secrets redacted."""
    env = await get_active_environment()
    return redact_environment_for_export(env)
