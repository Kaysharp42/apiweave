"""
Environment service — shared business logic for environment CRUD with secret-safe DTOs.
Called by both FastAPI routes and MCP tools.
"""

from typing import Any

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.repositories import EnvironmentRepository
from app.services.exceptions import ConflictError
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


async def create_environment(data: EnvironmentCreate) -> Environment:
    """Create a new environment."""
    return await EnvironmentRepository.create(data)


async def update_environment(environment_id: str, data: EnvironmentUpdate) -> Environment:
    """Update an environment. Raises ValueError if not found."""
    updated = await EnvironmentRepository.update(environment_id, data)
    if not updated:
        raise ValueError(f"Environment {environment_id} not found")
    return updated


async def delete_environment(environment_id: str) -> None:
    """Delete an environment. Raises ValueError if not found, ConflictError if referenced."""
    env = await EnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ValueError(f"Environment {environment_id} not found")

    from app.models import Workflow

    count = await Workflow.find(Workflow.selectedEnvironmentId == environment_id).count()
    if count > 0:
        raise ConflictError(
            f"Cannot delete environment. {count} workflow(s) are still attached to it."
        )

    success = await EnvironmentRepository.delete(environment_id)
    if not success:
        raise ValueError("Failed to delete environment")


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
    return dict(env_dict)


async def list_environments_redacted() -> list[dict[str, Any]]:
    """List all environments with secrets redacted."""
    envs = await list_environments()
    return [redact_environment_for_export(e) for e in envs]


async def get_environment_redacted(environment_id: str) -> dict[str, Any]:
    """Get an environment by ID with secrets redacted."""
    env = await get_environment(environment_id)
    return redact_environment_for_export(env)


async def set_environment_secret(environment_id: str, key: str, value: str) -> Environment:
    """Set a single secret key on an environment. Write-only — value is never returned."""
    env = await EnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ValueError(f"Environment {environment_id} not found")

    secrets = dict(env.secrets or {})
    secrets[key] = value
    update_data = EnvironmentUpdate(secrets=secrets)
    updated = await EnvironmentRepository.update(environment_id, update_data)
    if not updated:
        raise ValueError(f"Failed to update environment {environment_id}")
    return updated


async def delete_environment_secret(environment_id: str, key: str) -> Environment:
    """Delete a single secret key from an environment."""
    env = await EnvironmentRepository.get_by_id(environment_id)
    if not env:
        raise ValueError(f"Environment {environment_id} not found")

    secrets = dict(env.secrets or {})
    if key not in secrets:
        raise ValueError(f"Secret key '{key}' not found on environment {environment_id}")

    secrets.pop(key)
    update_data = EnvironmentUpdate(secrets=secrets)
    updated = await EnvironmentRepository.update(environment_id, update_data)
    if not updated:
        raise ValueError(f"Failed to update environment {environment_id}")
    return updated
