"""
Task 8 QA: Project naming — verifies that the API uses "project" terminology
instead of "collection" in all DTOs and responses.

Also verifies that old collection API routes are not mounted in the new scoped routes.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _make_workspace(workspace_id: str, owner_user_id: str) -> MagicMock:
    ws = MagicMock()
    ws.workspaceId = workspace_id
    ws.slug = "test-ws"
    ws.name = "Test Workspace"
    ws.ownerType = "user"
    ws.ownerUserId = owner_user_id
    ws.orgId = None
    ws.isPersonal = False
    ws.deletedAt = None
    ws.createdAt = datetime.now(UTC)
    ws.updatedAt = datetime.now(UTC)
    return ws


def _make_project(project_id: str, workspace_id: str, name: str = "Test Project") -> MagicMock:
    p = MagicMock()
    p.collectionId = project_id
    p.projectId = project_id
    p.name = name
    p.description = None
    p.color = None
    p.workspaceId = workspace_id
    p.orgId = None
    p.ownerType = "user"
    p.workflowCount = 0
    p.createdAt = datetime.now(UTC)
    p.updatedAt = datetime.now(UTC)
    return p


@pytest.mark.asyncio
async def test_project_response_uses_project_terminology():
    """Project API response uses 'projectId' not 'collectionId'."""
    from app.services import project_service

    user_id = "user-1"
    ws = _make_workspace("ws-1", user_id)
    project = _make_project("prj-1", "ws-1", "My Project")

    with (
        patch.object(
            project_service.ProjectRepository,
            "get_by_id",
            new=AsyncMock(return_value=project),
        ),
        patch.object(
            project_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws),
        ),
    ):
        result = await project_service.get_project("prj-1", user_id)
        assert "projectId" in result
        assert result["projectId"] == "prj-1"
        assert "collectionId" not in result
        assert result["name"] == "My Project"


@pytest.mark.asyncio
async def test_create_project_returns_project_dto():
    """Creating a project returns a DTO with project terminology."""
    from app.services import project_service

    user_id = "user-1"
    ws = _make_workspace("ws-1", user_id)
    project = _make_project("prj-new", "ws-1", "New Project")

    with (
        patch.object(
            project_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws),
        ),
        patch.object(
            project_service.ProjectRepository,
            "create",
            new=AsyncMock(return_value=project),
        ),
        patch("app.services.audit_service.append_event", new=AsyncMock()),
        patch("app.services.entitlements.require_can_create_project", new=AsyncMock()),
    ):
        result = await project_service.create_project(
            name="New Project",
            workspace_id="ws-1",
            actor_user_id=user_id,
        )
        assert "projectId" in result
        assert "collectionId" not in result
        assert result["workspaceId"] == "ws-1"


@pytest.mark.asyncio
async def test_list_projects_returns_project_list():
    """Listing projects returns a list with project terminology."""
    from app.services import project_service

    user_id = "user-1"
    ws = _make_workspace("ws-1", user_id)
    p1 = _make_project("prj-1", "ws-1", "Project 1")
    p2 = _make_project("prj-2", "ws-1", "Project 2")

    with (
        patch.object(
            project_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws),
        ),
        patch.object(
            project_service.ProjectRepository,
            "list_by_workspace",
            new=AsyncMock(return_value=[p1, p2]),
        ),
    ):
        result = await project_service.list_projects("ws-1", user_id)
        assert len(result) == 2
        for p in result:
            assert "projectId" in p
            assert "collectionId" not in p


def test_scoped_routes_use_project_not_collection():
    """Verify that the workspace routes module uses 'projects' in route paths."""
    from app.routes.workspaces import router

    route_paths = [route.path for route in router.routes]
    project_routes = [p for p in route_paths if "project" in p.lower()]
    collection_routes = [p for p in route_paths if "collection" in p.lower()]

    assert len(project_routes) > 0, "Expected project routes in workspace router"
    assert (
        len(collection_routes) == 0
    ), "Found old 'collection' routes in workspace router — should be 'project'"


def test_projects_router_exists():
    """Verify that the projects router exists and has correct prefix."""
    from app.routes.projects import router

    assert router.prefix == "/api/projects"


def test_no_collection_routes_in_projects_router():
    """Verify that the projects router does not expose collection terminology."""
    from app.routes.projects import router

    route_paths = [route.path for route in router.routes]
    for path in route_paths:
        assert "collection" not in path.lower(), f"Found 'collection' in route path: {path}"
