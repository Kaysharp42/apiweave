"""
Task 8 QA: Workspace-scoped workflow isolation.

Verifies that:
- A user with access to workspace A can read/write workflows in A
- The same user CANNOT access workflows in workspace B (returns 404)
- Outside collaborators can only access their assigned workspace
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import UTC, datetime


def _make_workspace(workspace_id: str, owner_user_id: str, slug: str = "test-ws") -> MagicMock:
    ws = MagicMock()
    ws.workspaceId = workspace_id
    ws.slug = slug
    ws.name = "Test Workspace"
    ws.ownerType = "user"
    ws.ownerUserId = owner_user_id
    ws.orgId = None
    ws.isPersonal = False
    ws.deletedAt = None
    ws.createdAt = datetime.now(UTC)
    ws.updatedAt = datetime.now(UTC)
    return ws


def _make_workflow(workflow_id: str, workspace_id: str, name: str = "Test WF") -> MagicMock:
    wf = MagicMock()
    wf.workflowId = workflow_id
    wf.name = name
    wf.description = None
    wf.workspaceId = workspace_id
    wf.collectionId = None
    wf.orgId = None
    wf.ownerType = "user"
    wf.nodes = []
    wf.edges = []
    wf.variables = {}
    wf.tags = []
    wf.selectedEnvironmentId = None
    wf.createdAt = datetime.now(UTC)
    wf.updatedAt = datetime.now(UTC)
    wf.version = 1
    return wf


@pytest.mark.asyncio
async def test_user_can_access_own_workspace_workflow():
    """User who owns workspace A can read a workflow in workspace A."""
    from app.services import scoped_workflow_service

    user_id = "user-1"
    ws_a = _make_workspace("ws-a", user_id, slug="ws-a")
    wf = _make_workflow("wf-1", "ws-a")

    with (
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws_a),
        ),
        patch.object(
            scoped_workflow_service.WorkflowRepository,
            "get_by_id_in_workspace",
            new=AsyncMock(return_value=wf),
        ),
    ):
        result = await scoped_workflow_service.get_scoped_workflow("ws-a", "wf-1", user_id)
        assert result["workflowId"] == "wf-1"
        assert result["workspaceId"] == "ws-a"


@pytest.mark.asyncio
async def test_user_cannot_access_other_workspace_workflow():
    """User who owns workspace A gets 404 when trying to read workflow in workspace B."""
    from app.services import scoped_workflow_service
    from app.services.exceptions import ResourceNotFoundError
    from app.repositories import workspace_repository, outside_collaborator_repository, organization_repository

    user_id = "user-1"
    ws_b = _make_workspace("ws-b", "user-2", slug="ws-b")

    with (
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws_b),
        ),
        patch.object(
            workspace_repository.WorkspaceRepository,
            "get_member",
            new=AsyncMock(return_value=None),
        ),
        patch.object(
            outside_collaborator_repository.OutsideCollaboratorRepository,
            "get_by_workspace_and_user",
            new=AsyncMock(return_value=None),
        ),
        patch.object(
            organization_repository.OrganizationRepository,
            "get_member",
            new=AsyncMock(return_value=None),
        ),
    ):
        with pytest.raises(ResourceNotFoundError, match="not found"):
            await scoped_workflow_service.get_scoped_workflow("ws-b", "wf-2", user_id)


@pytest.mark.asyncio
async def test_outside_collaborator_can_access_assigned_workspace():
    """Outside collaborator can access their assigned workspace."""
    from app.services import scoped_workflow_service
    from app.repositories import workspace_repository, outside_collaborator_repository, organization_repository

    collab_user_id = "collab-user"
    ws_a = _make_workspace("ws-a", "owner-user", slug="ws-a")
    wf = _make_workflow("wf-1", "ws-a")

    mock_collab = MagicMock()
    mock_collab.workspaceId = "ws-a"
    mock_collab.userId = collab_user_id
    mock_collab.role = "read"

    with (
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws_a),
        ),
        patch.object(
            workspace_repository.WorkspaceRepository,
            "get_member",
            new=AsyncMock(return_value=None),
        ),
        patch.object(
            organization_repository.OrganizationRepository,
            "get_member",
            new=AsyncMock(return_value=None),
        ),
        patch.object(
            outside_collaborator_repository.OutsideCollaboratorRepository,
            "get_by_workspace_and_user",
            new=AsyncMock(return_value=mock_collab),
        ),
        patch.object(
            scoped_workflow_service.WorkflowRepository,
            "get_by_id_in_workspace",
            new=AsyncMock(return_value=wf),
        ),
    ):
        result = await scoped_workflow_service.get_scoped_workflow("ws-a", "wf-1", collab_user_id)
        assert result["workflowId"] == "wf-1"


@pytest.mark.asyncio
async def test_outside_collaborator_cannot_access_other_workspace():
    """Outside collaborator of workspace A cannot access workspace B."""
    from app.services import scoped_workflow_service
    from app.services.exceptions import ResourceNotFoundError
    from app.repositories import workspace_repository, outside_collaborator_repository, organization_repository

    collab_user_id = "collab-user"
    ws_b = _make_workspace("ws-b", "owner-user-2", slug="ws-b")

    with (
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws_b),
        ),
        patch.object(
            workspace_repository.WorkspaceRepository,
            "get_member",
            new=AsyncMock(return_value=None),
        ),
        patch.object(
            organization_repository.OrganizationRepository,
            "get_member",
            new=AsyncMock(return_value=None),
        ),
        patch.object(
            outside_collaborator_repository.OutsideCollaboratorRepository,
            "get_by_workspace_and_user",
            new=AsyncMock(return_value=None),
        ),
    ):
        with pytest.raises(ResourceNotFoundError, match="not found"):
            await scoped_workflow_service.get_scoped_workflow("ws-b", "wf-2", collab_user_id)


@pytest.mark.asyncio
async def test_workspace_member_can_access_workflows():
    """A workspace member with 'write' role can access workflows."""
    from app.services import scoped_workflow_service

    member_user_id = "member-user"
    ws_a = _make_workspace("ws-a", "owner-user", slug="ws-a")
    wf = _make_workflow("wf-1", "ws-a")

    mock_member = MagicMock()
    mock_member.workspaceId = "ws-a"
    mock_member.userId = member_user_id
    mock_member.role = "write"

    with (
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws_a),
        ),
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_member",
            new=AsyncMock(return_value=mock_member),
        ),
        patch.object(
            scoped_workflow_service.WorkflowRepository,
            "get_by_id_in_workspace",
            new=AsyncMock(return_value=wf),
        ),
    ):
        result = await scoped_workflow_service.get_scoped_workflow("ws-a", "wf-1", member_user_id)
        assert result["workflowId"] == "wf-1"


@pytest.mark.asyncio
async def test_list_workflows_scoped_to_workspace():
    """Listing workflows returns only workflows from the specified workspace."""
    from app.services import scoped_workflow_service

    user_id = "user-1"
    ws_a = _make_workspace("ws-a", user_id, slug="ws-a")
    wf1 = _make_workflow("wf-1", "ws-a", "WF 1")
    wf2 = _make_workflow("wf-2", "ws-a", "WF 2")

    with (
        patch.object(
            scoped_workflow_service.WorkspaceRepository,
            "get_by_id",
            new=AsyncMock(return_value=ws_a),
        ),
        patch.object(
            scoped_workflow_service.WorkflowRepository,
            "list_by_workspace",
            new=AsyncMock(return_value=([wf1, wf2], 2)),
        ),
    ):
        result = await scoped_workflow_service.list_scoped_workflows("ws-a", user_id)
        assert result["total"] == 2
        assert len(result["workflows"]) == 2
        assert all(w["workspaceId"] == "ws-a" for w in result["workflows"])
