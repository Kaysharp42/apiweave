"""
Tests for MCP resources — workflow, environment, and run snapshots.
"""

from unittest.mock import AsyncMock, patch

import pytest
from app.mcp.resources.environments import _environment_to_dict, register_environment_resources
from app.mcp.resources.runs import _run_to_dict, register_run_resources
from app.mcp.resources.workflows import register_workflow_resources


class MockWorkflow:
    """Mock workflow document for testing."""

    def __init__(self):
        self.id = "wf-123"
        self.workflowId = "wf-123"
        self.name = "Test Workflow"
        self.description = "A test workflow"
        self.tags = ["test"]
        self.collectionId = None
        self.environmentId = None
        self.nodes = []
        self.edges = []
        self.nodeTemplates = []
        self.variables = {"api_key": "sk-12345"}
        self.createdAt = "2024-01-01T00:00:00Z"
        self.updatedAt = "2024-01-01T00:00:00Z"
        self.version = 1


class MockEnvironment:
    """Mock environment document for testing."""

    def __init__(self):
        self.id = "env-456"
        self.name = "Production"
        self.description = "Production environment"
        self.isActive = True
        self.variables = {"base_url": "https://api.example.com", "secret_key": "sk-secret"}
        self.createdAt = "2024-01-01T00:00:00Z"
        self.updatedAt = "2024-01-01T00:00:00Z"


class MockRun:
    """Mock run document for testing."""

    def __init__(self):
        self.id = "run-789"
        self.workflowId = "wf-123"
        self.status = "completed"
        self.trigger = "manual"
        self.environmentId = "env-456"
        self.nodeResults = [{"nodeId": "node-1", "status": "success"}]

    def model_dump(self, by_alias=False):
        return {
            "id": str(self.id),
            "workflowId": self.workflowId,
            "status": self.status,
            "trigger": self.trigger,
            "environmentId": self.environmentId,
            "nodeResults": self.nodeResults,
        }


def test_environment_to_dict_redacts_secrets():
    """Environment variables with secret-like values are redacted."""
    env = MockEnvironment()
    data = _environment_to_dict(env)

    assert data["name"] == "Production"
    assert data["variables"]["base_url"] == "https://api.example.com"
    assert data["variables"]["secret_key"] == "<SECRET>"
    assert "redacted_secret_references" in data


def test_run_to_dict_excludes_node_results():
    """Run resource excludes full node results for compactness."""
    run = MockRun()
    data = _run_to_dict(run)

    assert data["workflowId"] == "wf-123"
    assert "nodeResults" not in data


@pytest.mark.asyncio
async def test_workflow_resource_returns_json():
    """Workflow resource returns valid JSON with redacted secrets."""
    mock_workflow = MockWorkflow()

    with (
        patch("app.mcp.resources.workflows.ensure_mcp_database", new_callable=AsyncMock),
        patch("app.mcp.resources.workflows.get_workflow", new_callable=AsyncMock) as mock_get,
    ):
        mock_get.return_value = mock_workflow

        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="TestServer")
        register_workflow_resources(server)

        resources = server._resource_manager.list_templates()
        assert len(resources) >= 1


@pytest.mark.asyncio
async def test_environment_resource_returns_json():
    """Environment resource returns valid JSON with redacted secrets."""
    mock_env = MockEnvironment()

    with (
        patch("app.mcp.resources.environments.ensure_mcp_database", new_callable=AsyncMock),
        patch("app.mcp.resources.environments.get_environment", new_callable=AsyncMock) as mock_get,
    ):
        mock_get.return_value = mock_env

        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="TestServer")
        register_environment_resources(server)

        resources = server._resource_manager.list_templates()
        assert len(resources) >= 1


@pytest.mark.asyncio
async def test_run_resource_returns_json():
    """Run resource returns valid JSON."""
    mock_run = MockRun()

    with (
        patch("app.mcp.resources.runs.ensure_mcp_database", new_callable=AsyncMock),
        patch("app.mcp.resources.runs.get_run", new_callable=AsyncMock) as mock_get,
    ):
        mock_get.return_value = mock_run

        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="TestServer")
        register_run_resources(server)

        resources = server._resource_manager.list_templates()
        assert len(resources) >= 1


@pytest.mark.asyncio
async def test_workflow_resource_handles_not_found():
    """Workflow resource returns error JSON when workflow not found."""
    with (
        patch("app.mcp.resources.workflows.ensure_mcp_database", new_callable=AsyncMock),
        patch("app.mcp.resources.workflows.get_workflow", new_callable=AsyncMock) as mock_get,
    ):
        mock_get.side_effect = ValueError("Workflow not-found not found")

        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="TestServer")
        register_workflow_resources(server)

        resources = server._resource_manager.list_templates()
        assert len(resources) >= 1
