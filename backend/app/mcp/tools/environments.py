"""
MCP environment tools — scoped to workspace/organization via service token.

All environment operations use the scoped environment service.
Each workspace has exactly one default environment.
"""

from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.config import settings
from app.mcp.database import ensure_mcp_database
from app.mcp.datetime_utils import utc_datetime
from app.mcp.schemas.environments import (
    EnvironmentCreateResponse,
    EnvironmentDeleteResponse,
    EnvironmentGetResponse,
    EnvironmentListResponse,
    EnvironmentSummary,
    EnvironmentUpdateResponse,
)
from app.mcp.scope_context import require_scope
from app.models import ScopedEnvironmentCreate, ScopedEnvironmentUpdate
from app.services import scoped_environment_service


def _env_to_summary(env: Any) -> EnvironmentSummary:
    """Convert a scoped Environment document to an MCP summary."""
    return EnvironmentSummary(
        environment_id=env.environmentId,
        name=env.name,
        description=getattr(env, "description", None),
        swagger_doc_url=getattr(env, "swaggerDocUrl", None),
        variables=getattr(env, "variables", {}) or {},
        secrets={},  # Scoped secrets are separate — no plaintext secrets in env
        created_at=utc_datetime(getattr(env, "createdAt")),
        updated_at=utc_datetime(getattr(env, "updatedAt")),
    )


async def _assert_environment_in_scope(environment_id: str) -> Any:
    """Load an environment and require it to belong to the token's scope.

    environment_get/update/delete previously operated by id with no scope
    check, allowing cross-tenant read/modify/delete. Returns the env on success.
    """
    scope = require_scope()
    try:
        env = await scoped_environment_service.get_scoped_environment(environment_id)
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    if (
        getattr(env, "scopeType", None) != scope.scope_type
        or getattr(env, "scopeId", None) != scope.scope_id
    ):
        raise ValueError(f"Environment not found: {environment_id}")
    return env


async def environment_list() -> EnvironmentListResponse:
    """List environments accessible from the authenticated scope."""
    await ensure_mcp_database()
    scope = require_scope()

    envs = await scoped_environment_service.list_scoped_environments(
        scope_type=scope.scope_type,
        scope_id=scope.scope_id,
    )
    summaries = [_env_to_summary(env) for env in envs]
    return EnvironmentListResponse(environments=summaries, total=len(summaries))


async def environment_create(
    name: Annotated[str, Field(description="Environment name.")],
    description: Annotated[str | None, Field(description="Environment description.")] = None,
    swagger_doc_url: Annotated[str | None, Field(description="Swagger/OpenAPI source URL.")] = None,
    variables: Annotated[dict[str, Any] | None, Field(description="Environment variables.")] = None,
) -> EnvironmentCreateResponse:
    """Create a new environment scoped to the authenticated workspace/org."""
    await ensure_mcp_database()
    scope = require_scope()

    created = await scoped_environment_service.create_scoped_environment(
        scope_type=scope.scope_type,
        scope_id=scope.scope_id,
        data=ScopedEnvironmentCreate(
            name=name,
            description=description,
            swaggerDocUrl=swagger_doc_url,
            variables=variables or {},
        ),
    )

    return EnvironmentCreateResponse(
        message="Environment created successfully",
        environment=_env_to_summary(created),
    )


async def environment_get(
    environment_id: Annotated[str, Field(description="Environment ID to retrieve.")],
) -> EnvironmentGetResponse:
    """Get an environment by ID (scoped)."""
    await ensure_mcp_database()
    env = await _assert_environment_in_scope(environment_id)
    return EnvironmentGetResponse(environment=_env_to_summary(env))


async def environment_update(
    environment_id: Annotated[str, Field(description="Environment ID to update.")],
    name: Annotated[str | None, Field(description="New environment name.")] = None,
    description: Annotated[str | None, Field(description="New description.")] = None,
    swagger_doc_url: Annotated[str | None, Field(description="New Swagger/OpenAPI URL.")] = None,
    variables: Annotated[dict[str, Any] | None, Field(description="Replacement variables.")] = None,
) -> EnvironmentUpdateResponse:
    """Update environment metadata and variables (scoped)."""
    await ensure_mcp_database()
    await _assert_environment_in_scope(environment_id)

    update_fields: dict[str, Any] = {}
    if name is not None:
        update_fields["name"] = name
    if description is not None:
        update_fields["description"] = description
    if swagger_doc_url is not None:
        update_fields["swaggerDocUrl"] = swagger_doc_url
    if variables is not None:
        update_fields["variables"] = variables

    try:
        updated = await scoped_environment_service.update_scoped_environment(
            environment_id,
            ScopedEnvironmentUpdate(**update_fields),
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    return EnvironmentUpdateResponse(
        message="Environment updated successfully",
        environment=_env_to_summary(updated),
    )


async def environment_delete(
    environment_id: Annotated[str, Field(description="Environment ID to delete.")],
) -> EnvironmentDeleteResponse:
    """Delete an environment (scoped). Blocked if it's the workspace default."""
    await ensure_mcp_database()
    await _assert_environment_in_scope(environment_id)
    try:
        await scoped_environment_service.delete_scoped_environment(environment_id)
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return EnvironmentDeleteResponse(
        message="Environment deleted successfully",
        environment_id=environment_id,
    )


async def environment_duplicate(
    environment_id: Annotated[str, Field(description="Environment ID to duplicate.")],
) -> EnvironmentCreateResponse:
    """Duplicate an environment within the authenticated scope."""
    await ensure_mcp_database()
    scope = require_scope()

    # Get source environment
    source = await scoped_environment_service.get_scoped_environment(environment_id)

    # Create copy in same scope
    created = await scoped_environment_service.create_scoped_environment(
        scope_type=scope.scope_type,
        scope_id=scope.scope_id,
        data=ScopedEnvironmentCreate(
            name=f"{source.name} (copy)",
            description=source.description,
            swaggerDocUrl=getattr(source, "swaggerDocUrl", None),
            variables=source.variables or {},
        ),
    )

    return EnvironmentCreateResponse(
        message="Environment duplicated successfully",
        environment=_env_to_summary(created),
    )


async def mcp_get_config_summary() -> dict:
    """Get MCP server configuration summary. Returns capability flags only."""
    return {
        "mcp_enabled": settings.MCP_ENABLED,
        "http_enabled": settings.MCP_HTTP_ENABLED,
        "scoped_auth": True,
        "version": settings.VERSION,
        "note": "All MCP access requires scoped service tokens. No secret values returned.",
    }


def register_environment_tools(server: FastMCP) -> None:
    """Register scoped environment tools."""
    server.tool(
        name="environment_list",
        description="List environments accessible from the authenticated scope.",
    )(environment_list)
    server.tool(
        name="environment_create",
        description="Create a new environment scoped to the authenticated workspace/org.",
    )(environment_create)
    server.tool(
        name="environment_get",
        description="Get an environment by ID (scoped).",
    )(environment_get)
    server.tool(
        name="environment_update",
        description="Update environment metadata and variables (scoped).",
    )(environment_update)
    server.tool(
        name="environment_delete",
        description="Delete an environment (scoped). Blocked if it's the workspace default.",
    )(environment_delete)
    server.tool(
        name="environment_duplicate",
        description="Duplicate an environment within the authenticated scope.",
    )(environment_duplicate)
    server.tool(
        name="mcp_get_config_summary",
        description="Get MCP server configuration summary. Returns capability flags only.",
    )(mcp_get_config_summary)
