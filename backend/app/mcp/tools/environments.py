"""
MCP environment tools.
"""
from datetime import datetime
from typing import Any, cast

from mcp.server.fastmcp import FastMCP

from app.mcp.database import ensure_mcp_database
from app.mcp.schemas.environments import (
    EnvironmentActiveResponse,
    EnvironmentListResponse,
    EnvironmentSummary,
)
from app.services.environment_service import (
    get_active_environment_redacted as svc_get_active_environment_redacted,
)
from app.services.environment_service import (
    list_environments_redacted as svc_list_environments_redacted,
)


def environment_from_dict(environment: dict[str, Any]) -> EnvironmentSummary:
    """Convert a redacted service environment dict into an MCP DTO."""
    return EnvironmentSummary(
        environment_id=str(environment.get("environmentId")),
        name=str(environment.get("name")),
        description=cast(str | None, environment.get("description")),
        swagger_doc_url=cast(str | None, environment.get("swaggerDocUrl")),
        variables=cast(dict[str, Any], environment.get("variables", {})),
        secrets=cast(dict[str, str], environment.get("secrets", {})),
        is_active=bool(environment.get("isActive", False)),
        created_at=cast(datetime, environment.get("createdAt")),
        updated_at=cast(datetime, environment.get("updatedAt")),
    )


async def environment_list() -> EnvironmentListResponse:
    """List all environments with persisted secrets redacted."""
    await ensure_mcp_database()
    environments = await svc_list_environments_redacted()
    summaries = [environment_from_dict(environment) for environment in environments]
    return EnvironmentListResponse(environments=summaries, total=len(summaries))


async def environment_get_active() -> EnvironmentActiveResponse:
    """Get the active environment with persisted secrets redacted."""
    await ensure_mcp_database()
    try:
        environment = await svc_get_active_environment_redacted()
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return EnvironmentActiveResponse(environment=environment_from_dict(environment))


def register_environment_tools(server: FastMCP) -> None:
    """Register Phase 2 environment read tools."""
    server.tool(
        name="environment_list",
        description=(
            "List environments for workflow context. Persisted secrets are always redacted."
        ),
    )(environment_list)
    server.tool(
        name="environment_get_active",
        description="Get the active environment for workflow context with secrets redacted.",
    )(environment_get_active)
