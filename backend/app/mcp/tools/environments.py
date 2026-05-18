"""
MCP environment tools.
"""
from typing import Annotated, Any, cast

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.datetime_utils import utc_datetime
from app.mcp.schemas.environments import (
    EnvironmentActivateRequest,
    EnvironmentActivateResponse,
    EnvironmentActiveResponse,
    EnvironmentCreateRequest,
    EnvironmentCreateResponse,
    EnvironmentDeleteRequest,
    EnvironmentDeleteResponse,
    EnvironmentGetRequest,
    EnvironmentGetResponse,
    EnvironmentListResponse,
    EnvironmentSummary,
    EnvironmentUpdateRequest,
    EnvironmentUpdateResponse,
)
from app.models import EnvironmentCreate, EnvironmentUpdate
from app.services.environment_service import (
    activate_environment as svc_activate_environment,
)
from app.services.environment_service import (
    create_environment as svc_create_environment,
)
from app.services.environment_service import (
    delete_environment as svc_delete_environment,
)
from app.services.environment_service import (
    get_active_environment_redacted as svc_get_active_environment_redacted,
)
from app.services.environment_service import (
    get_environment_redacted as svc_get_environment_redacted,
)
from app.services.environment_service import (
    list_environments_redacted as svc_list_environments_redacted,
)
from app.services.environment_service import (
    update_environment as svc_update_environment,
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
        created_at=utc_datetime(environment.get("createdAt")),
        updated_at=utc_datetime(environment.get("updatedAt")),
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


async def environment_create(
    name: Annotated[str, Field(description="Environment name.")],
    description: Annotated[str | None, Field(description="Environment description.")] = None,
    swagger_doc_url: Annotated[str | None, Field(description="Swagger/OpenAPI source URL.")] = None,
    variables: Annotated[dict[str, Any] | None, Field(description="Environment variables.")] = None,
) -> EnvironmentCreateResponse:
    """Create a new environment. Persisted secrets are not accepted;
    use runtime secrets during execution instead."""
    await ensure_mcp_database()
    request = EnvironmentCreateRequest(
        name=name,
        description=description,
        swagger_doc_url=swagger_doc_url,
        variables=variables or {},
    )
    created = await svc_create_environment(
        EnvironmentCreate(
            name=request.name,
            description=request.description,
            swaggerDocUrl=request.swagger_doc_url,
            variables=request.variables,
            secrets={},
        )
    )
    redacted = {
        "environmentId": created.environmentId,
        "name": created.name,
        "description": created.description,
        "swaggerDocUrl": created.swaggerDocUrl,
        "variables": created.variables or {},
        "secrets": {},
        "isActive": created.isActive,
        "createdAt": created.createdAt,
        "updatedAt": created.updatedAt,
    }
    return EnvironmentCreateResponse(
        message="Environment created successfully",
        environment=environment_from_dict(redacted),
    )


async def environment_get(
    environment_id: Annotated[str, Field(description="Environment ID to retrieve.")],
) -> EnvironmentGetResponse:
    """Get an environment by ID with persisted secrets redacted."""
    await ensure_mcp_database()
    request = EnvironmentGetRequest(environment_id=environment_id)
    try:
        environment = await svc_get_environment_redacted(request.environment_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return EnvironmentGetResponse(environment=environment_from_dict(environment))


async def environment_update(
    environment_id: Annotated[str, Field(description="Environment ID to update.")],
    name: Annotated[str | None, Field(description="New environment name.")] = None,
    description: Annotated[str | None, Field(description="New description.")] = None,
    swagger_doc_url: Annotated[str | None, Field(description="New Swagger/OpenAPI URL.")] = None,
    variables: Annotated[dict[str, Any] | None, Field(description="Replacement variables.")] = None,
) -> EnvironmentUpdateResponse:
    """Update environment metadata and variables.
    Persisted secrets cannot be modified through MCP."""
    await ensure_mcp_database()
    request = EnvironmentUpdateRequest(
        environment_id=environment_id,
        name=name,
        description=description,
        swagger_doc_url=swagger_doc_url,
        variables=variables,
    )
    update_data: dict[str, Any] = {}
    for source_name, target_name in (
        ("name", "name"),
        ("description", "description"),
        ("swagger_doc_url", "swaggerDocUrl"),
        ("variables", "variables"),
    ):
        value = getattr(request, source_name)
        if value is not None:
            update_data[target_name] = value

    try:
        updated = await svc_update_environment(
            request.environment_id, EnvironmentUpdate(**update_data)
        )
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    redacted = {
        "environmentId": updated.environmentId,
        "name": updated.name,
        "description": updated.description,
        "swaggerDocUrl": updated.swaggerDocUrl,
        "variables": updated.variables or {},
        "secrets": {k: "<SECRET>" for k in (updated.secrets or {})},
        "isActive": updated.isActive,
        "createdAt": updated.createdAt,
        "updatedAt": updated.updatedAt,
    }
    return EnvironmentUpdateResponse(
        message="Environment updated successfully",
        environment=environment_from_dict(redacted),
    )


async def environment_delete(
    environment_id: Annotated[str, Field(description="Environment ID to delete.")],
) -> EnvironmentDeleteResponse:
    """Delete an environment. Blocked if any workflows reference it."""
    await ensure_mcp_database()
    request = EnvironmentDeleteRequest(environment_id=environment_id)
    try:
        await svc_delete_environment(request.environment_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    return EnvironmentDeleteResponse(
        message="Environment deleted successfully",
        environment_id=request.environment_id,
    )


async def environment_activate(
    environment_id: Annotated[str, Field(description="Environment ID to activate.")],
) -> EnvironmentActivateResponse:
    """Set an environment as active. Deactivates any previously active environment."""
    await ensure_mcp_database()
    request = EnvironmentActivateRequest(environment_id=environment_id)
    try:
        activated = await svc_activate_environment(request.environment_id)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
    redacted = {
        "environmentId": activated.environmentId,
        "name": activated.name,
        "description": activated.description,
        "swaggerDocUrl": activated.swaggerDocUrl,
        "variables": activated.variables or {},
        "secrets": {k: "<SECRET>" for k in (activated.secrets or {})},
        "isActive": True,
        "createdAt": activated.createdAt,
        "updatedAt": activated.updatedAt,
    }
    return EnvironmentActivateResponse(
        message="Environment activated successfully",
        environment=environment_from_dict(redacted),
    )


def register_environment_tools(server: FastMCP) -> None:
    """Register environment tools."""
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
    server.tool(
        name="environment_create",
        description=(
            "Create a new environment with variables. Persisted secrets are not accepted; "
            "use runtime secrets during workflow execution instead."
        ),
    )(environment_create)
    server.tool(
        name="environment_get",
        description="Get an environment by ID with persisted secrets redacted.",
    )(environment_get)
    server.tool(
        name="environment_update",
        description=(
            "Update environment metadata and variables. "
            "Persisted secrets cannot be modified through MCP."
        ),
    )(environment_update)
    server.tool(
        name="environment_delete",
        description="Delete an environment. Blocked if any workflows reference it.",
    )(environment_delete)
    server.tool(
        name="environment_activate",
        description="Set an environment as active. Deactivates any previously active environment.",
    )(environment_activate)
