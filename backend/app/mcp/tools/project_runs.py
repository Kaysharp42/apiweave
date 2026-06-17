"""
MCP project-run read tools — scoped read-only surface.

Replaces collection_run tools. Lists runs for projects within
the authenticated workspace scope.
"""
from typing import Annotated, Any

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.database import ensure_mcp_database
from app.mcp.scope_context import require_scope


async def project_run_list(
    project_id: Annotated[str, Field(description="Project ID to list runs for.")],
    skip: Annotated[int, Field(ge=0, description="Number of runs to skip.")] = 0,
    limit: Annotated[int, Field(ge=1, le=50, description="Maximum runs to return.")] = 20,
) -> dict:
    """List runs for workflows in a project, scoped to the authenticated workspace."""
    await ensure_mcp_database()
    scope = require_scope()
    workspace_id = scope.scope_id

    # Verify project belongs to workspace
    from app.services.project_service import get_project
    try:
        await get_project(
            project_id=project_id,
            actor_user_id=scope.actor_id,
        )
    except Exception as exc:
        raise ValueError(str(exc)) from exc

    # List runs for workflows in this project
    from app.repositories.run_repository import RunRepository
    from app.repositories.workflow_repository import WorkflowRepository

    workflows, _ = await WorkflowRepository.list_by_workspace_and_project(
        workspace_id, project_id, 0, 1000
    )
    workflow_ids = [wf.workflowId for wf in workflows]

    all_runs: list[Any] = []
    for wf_id in workflow_ids:
        runs = await RunRepository.list_by_workflow(wf_id, skip=0, limit=limit)
        all_runs.extend(runs)

    # Sort by creation time descending
    all_runs.sort(key=lambda r: getattr(r, "createdAt", ""), reverse=True)
    paginated = all_runs[skip : skip + limit]

    return {
        "projectId": project_id,
        "workspaceId": workspace_id,
        "runs": [
            {
                "runId": r.runId,
                "workflowId": r.workflowId,
                "status": r.status,
                "createdAt": r.createdAt.isoformat() if r.createdAt else None,
                "duration": r.duration,
            }
            for r in paginated
        ],
        "total": len(all_runs),
        "skip": skip,
        "limit": limit,
        "hasMore": (skip + limit) < len(all_runs),
    }


def register_project_run_tools(server: FastMCP) -> None:
    """Register scoped project-run read-only tools."""
    server.tool(
        name="project_run_list",
        description="List runs for workflows in a project, scoped to the authenticated workspace.",
    )(project_run_list)
