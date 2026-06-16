from datetime import UTC, datetime
from typing import Optional

from app.models import Environment, EnvironmentCreate


class ScopedEnvironmentRepository:
    @staticmethod
    async def create(
        environment_id: str,
        name: str,
        scope_type: str,
        scope_id: str,
        owner_type: str | None = None,
        variables: dict | None = None,
    ) -> Environment:
        now = datetime.now(UTC)
        env = Environment(
            environmentId=environment_id,
            name=name,
            scopeType=scope_type,
            scopeId=scope_id,
            ownerType=owner_type,
            variables=variables or {},
            createdAt=now,
            updatedAt=now,
        )
        await env.insert()
        return env

    @staticmethod
    async def get_by_id(environment_id: str) -> Optional[Environment]:
        return await Environment.find_one(
            Environment.environmentId == environment_id
        )

    @staticmethod
    async def list_by_scope(scope_type: str, scope_id: str) -> list[Environment]:
        return await Environment.find(
            Environment.scopeType == scope_type,
            Environment.scopeId == scope_id,
        ).sort(-Environment.createdAt).to_list()

    @staticmethod
    async def get_default_for_workspace(workspace_id: str) -> Optional[Environment]:
        return await Environment.find_one(
            Environment.scopeType == "workspace",
            Environment.scopeId == workspace_id,
            Environment.name == "Default",
        )
