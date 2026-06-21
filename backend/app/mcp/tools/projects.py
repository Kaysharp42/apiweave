"""
MCP project tools — scoped to workspace via service token.

Projects replace Collections in the scoped API. All operations are
scoped to the authenticated workspace.
"""

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.scope_context import require_scope
from app.services.project_service import (
    create_project,
    delete_project,
    get_project,
    list_projects,
    update_project,
)


async def project_list() -> dict:
    """List projects scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    projects = await list_projects(
        workspace_id=workspace_id,
        actor_user_id=scope.actor_id,
    )
    return {
        "workspaceId": workspace_id,
        "projects": projects,
        "total": len(projects),
    }


async def project_create(
    name: Annotated[str, Field(description="Project name.")],
    description: Annotated[str | None, Field(description="Project description.")] = None,
    color: Annotated[str | None, Field(description="Display color (hex).")] = None,
) -> dict:
    """Create a new project in the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    try:
        result = await create_project(
            name=name,
            workspace_id=workspace_id,
            description=description,
            color=color,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return {
        "message": "Project created successfully",
        "project": result,
    }


async def project_get(
    project_id: Annotated[str, Field(description="Project ID to retrieve.")],
) -> dict:
    """Get a project by ID (scoped)."""
    await ensure_mcp_database()
    scope = require_scope()

    try:
        result = await get_project(
            project_id=project_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return {"project": result}


async def project_update(
    project_id: Annotated[str, Field(description="Project ID to update.")],
    name: Annotated[str | None, Field(description="New project name.")] = None,
    description: Annotated[str | None, Field(description="New description.")] = None,
    color: Annotated[str | None, Field(description="New display color.")] = None,
) -> dict:
    """Update project metadata (scoped)."""
    await ensure_mcp_database()
    scope = require_scope()

    try:
        result = await update_project(
            project_id=project_id,
            name=name,
            description=description,
            color=color,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return {
        "message": "Project updated successfully",
        "project": result,
    }


async def project_delete(
    project_id: Annotated[str, Field(description="Project ID to delete.")],
) -> dict:
    """Delete a project (scoped). Blocked if any workflows are in it."""
    await ensure_mcp_database()
    scope = require_scope()

    try:
        await delete_project(
            project_id=project_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    return {
        "message": "Project deleted successfully",
        "projectId": project_id,
    }


def register_project_tools(server: FastMCP) -> None:
    """Register scoped project tools."""
    server.tool(
        name="project_list",
        description="List projects scoped to the authenticated workspace.",
    )(project_list)
    server.tool(
        name="project_create",
        description="Create a new project in the authenticated workspace.",
    )(project_create)
    server.tool(
        name="project_get",
        description="Get a project by ID (scoped).",
    )(project_get)
    server.tool(
        name="project_update",
        description="Update project metadata (scoped).",
    )(project_update)
    server.tool(
        name="project_delete",
        description="Delete a project (scoped). Blocked if any workflows are in it.",
    )(project_delete)
