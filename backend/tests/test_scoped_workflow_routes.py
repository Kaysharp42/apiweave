"""
Scoped workflow route parity tests.

Verifies:
- Scoped workflow run returns run id (202 + runId field)
- Scoped import dry-run preserves response shape (nodes + stats)
- All expected scoped routes are registered
"""
import json
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import scoped_workflow_service


class FakeWorkspace:
    def __init__(self, workspace_id: str = "ws-1", org_id: str = "org-1", owner_type: str = "user"):
        self.workspaceId = workspace_id
        self.orgId = org_id
        self.ownerType = owner_type


class FakeWorkflow:
    def __init__(self, workflow_id: str = "wf-1", workspace_id: str = "ws-1"):
        self.workflowId = workflow_id
        self.workspaceId = workspace_id
        self.orgId = "org-1"
        self.ownerType = "user"
        self.name = "Test Workflow"
        self.description = ""
        self.nodes = [SimpleNamespace(nodeId="start_1", type="start")]
        self.edges = []
        self.variables = {}
        self.tags = []
        self.selectedEnvironmentId = None
        self.collectionId = None
        self.nodeTemplates = []
        self.version = 1
        self.createdAt = None
        self.updatedAt = None

    async def save(self) -> None:
        pass


class FakeUser:
    def __init__(self, user_id: str = "user-1"):
        self.userId = user_id


def _patch_workspace_access(monkeypatch: pytest.MonkeyPatch, workspace_id: str = "ws-1"):
    fake_ws = FakeWorkspace(workspace_id)

    async def fake_get_by_id(wid):
        return fake_ws if wid == workspace_id else None

    async def fake_access(ws, user_id):
        pass

    monkeypatch.setattr(
        scoped_workflow_service.WorkspaceRepository, "get_by_id", fake_get_by_id
    )
    monkeypatch.setattr(
        "app.services.scoped_workflow_service._assert_workspace_access", fake_access
    )
    return fake_ws


def _patch_workflow_in_workspace(monkeypatch: pytest.MonkeyPatch, workflow_id: str = "wf-1", workspace_id: str = "ws-1"):
    fake_wf = FakeWorkflow(workflow_id, workspace_id)

    async def fake_get_in_workspace(wid, ws_id):
        if wid == workflow_id and ws_id == workspace_id:
            return fake_wf
        return None

    monkeypatch.setattr(
        scoped_workflow_service.WorkflowRepository, "get_by_id_in_workspace", fake_get_in_workspace
    )
    return fake_wf


@pytest.mark.asyncio
async def test_scoped_run_returns_run_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/workspaces/{ws}/workflows/{wf}/run returns 202 with runId."""
    _patch_workspace_access(monkeypatch)
    _patch_workflow_in_workspace(monkeypatch)

    expected_run_id = "run-abc-123"

    async def fake_trigger(workflow_id, **kwargs):
        return {
            "runId": expected_run_id,
            "workflowId": workflow_id,
            "status": "pending",
            "workspaceId": kwargs.get("workspace_id"),
        }

    monkeypatch.setattr(
        "app.services.run_service.trigger_workflow_run",
        fake_trigger,
    )

    result = await scoped_workflow_service.trigger_scoped_run(
        workspace_id="ws-1",
        workflow_id="wf-1",
        actor_user_id="user-1",
        environment_id="env-1",
    )

    assert result["runId"] == expected_run_id
    assert result["runId"]
    assert result["status"] == "pending"
    assert result["workspaceId"] == "ws-1"


@pytest.mark.asyncio
async def test_scoped_run_rejects_workflow_not_in_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scoped run must verify workflow belongs to workspace."""
    _patch_workspace_access(monkeypatch)

    async def fake_get_in_workspace(wid, ws_id):
        return None

    monkeypatch.setattr(
        scoped_workflow_service.WorkflowRepository, "get_by_id_in_workspace", fake_get_in_workspace
    )

    from app.services.exceptions import ResourceNotFoundError

    with pytest.raises(ResourceNotFoundError, match="not found in workspace"):
        await scoped_workflow_service.trigger_scoped_run(
            workspace_id="ws-1",
            workflow_id="wf-missing",
            actor_user_id="user-1",
        )


@pytest.mark.asyncio
async def test_scoped_import_dry_run_preserves_response_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/workspaces/{ws}/workflows/import/dry-run returns valid + stats."""
    bundle = {
        "workflow": {
            "name": "Imported Workflow",
            "nodes": [
                {"nodeId": "start_1", "type": "start"},
                {"nodeId": "http_1", "type": "http-request"},
                {"nodeId": "end_1", "type": "end"},
            ],
            "edges": [
                {"source": "start_1", "target": "http_1"},
                {"source": "http_1", "target": "end_1"},
            ],
            "variables": {"token": "abc"},
        },
        "environments": [],
        "secretReferences": ["variables.token"],
    }

    async def fake_dry_run(b):
        return {
            "valid": True,
            "errors": [],
            "warnings": ["Workflow contains 1 secret references that must be re-entered"],
            "stats": {
                "nodes": 3,
                "edges": 2,
                "variables": 1,
                "secretReferences": 1,
                "environmentsIncluded": 0,
            },
        }

    monkeypatch.setattr(
        "app.services.workflow_service.import_workflow_dry_run",
        fake_dry_run,
    )

    result = await scoped_workflow_service.import_scoped_workflow_dry_run(bundle)

    assert result["valid"] is True
    assert "stats" in result
    assert result["stats"]["nodes"] == 3
    assert result["stats"]["edges"] == 2
    assert isinstance(result["errors"], list)
    assert isinstance(result["warnings"], list)


@pytest.mark.asyncio
async def test_scoped_openapi_dry_run_preserves_response_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scoped OpenAPI dry-run returns nodes + stats.totalEndpoints."""
    _patch_workspace_access(monkeypatch)

    openapi_data = {
        "openapi": "3.0.0",
        "info": {"title": "Pet Store", "version": "1.0.0"},
        "paths": {
            "/pets": {
                "get": {"summary": "List pets", "responses": {"200": {"description": "OK"}}},
            },
        },
        "tags": [{"name": "pets", "description": "Pet operations"}],
        "servers": [{"url": "https://api.example.com", "description": "Production"}],
    }

    def fake_parse(data, base_url, tags, sanitize):
        return {
            "name": "Pet Store Import",
            "description": "",
            "nodes": [
                {"nodeId": "start_1", "type": "start"},
                {"nodeId": "http_1", "type": "http-request"},
                {"nodeId": "end_1", "type": "end"},
            ],
            "edges": [
                {"source": "start_1", "target": "http_1"},
                {"source": "http_1", "target": "end_1"},
            ],
        }

    monkeypatch.setattr(
        "app.services.import_service.parse_openapi_to_workflow",
        fake_parse,
    )

    result = await scoped_workflow_service.import_scoped_openapi_dry_run(
        workspace_id="ws-1",
        openapi_data=openapi_data,
        actor_user_id="user-1",
    )

    assert "nodes" in result
    assert "stats" in result
    assert result["stats"]["totalEndpoints"] == 1
    assert result["stats"]["apiTitle"] == "Pet Store"
    assert result["stats"]["apiVersion"] == "1.0.0"
    assert "availableTags" in result
    assert "availableServers" in result
    assert len(result["availableTags"]) == 1
    assert result["availableTags"][0]["name"] == "pets"


@pytest.mark.asyncio
async def test_scoped_templates_crud(monkeypatch: pytest.MonkeyPatch) -> None:
    """Template CRUD operations work through scoped service."""
    _patch_workspace_access(monkeypatch)
    fake_wf = _patch_workflow_in_workspace(monkeypatch)

    result = await scoped_workflow_service.get_scoped_templates("ws-1", "wf-1", "user-1")
    assert result["workflowId"] == "wf-1"
    assert result["templates"] == []

    templates = [{"name": "GET Request", "type": "http-request", "config": {"method": "GET"}}]
    result = await scoped_workflow_service.add_scoped_templates("ws-1", "wf-1", "user-1", templates)
    assert result["totalTemplates"] == 1

    result = await scoped_workflow_service.clear_scoped_templates("ws-1", "wf-1", "user-1")
    assert result["message"] == "Templates cleared successfully"


def test_scoped_routes_registered() -> None:
    """All expected scoped workflow routes are registered on the router."""
    from app.routes.workspaces import router

    route_paths = [r.path for r in router.routes if hasattr(r, "path")]

    expected_patterns = [
        "/workflows/{workflow_id}/run",
        "/workflows/{workflow_id}/runs/latest-failed",
        "/workflows/{workflow_id}/runs/{run_id}",
        "/workflows/{workflow_id}/runs/{run_id}/nodes/{node_id}/result",
        "/workflows/{workflow_id}/export",
        "/workflows/import",
        "/workflows/import/dry-run",
        "/workflows/import/har",
        "/workflows/import/har/dry-run",
        "/workflows/import/openapi",
        "/workflows/import/openapi/url",
        "/workflows/import/openapi/dry-run",
        "/workflows/import/curl",
        "/workflows/import/curl/dry-run",
        "/workflows/{workflow_id}/templates",
    ]

    for pattern in expected_patterns:
        full_pattern = f"/{{workspace_id}}{pattern}"
        assert any(full_pattern in p for p in route_paths), (
            f"Missing scoped route: {full_pattern}"
        )
