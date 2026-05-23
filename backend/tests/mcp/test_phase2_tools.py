from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from mcp.server.fastmcp import FastMCP

from app.mcp.tools import collections as collection_tools
from app.mcp.tools import environments as environment_tools
from app.mcp.tools import workflows as workflow_tools
from app.models import Edge, Node


@pytest.fixture(autouse=True)
def skip_database_initialization(monkeypatch):
    async def fake_ensure_mcp_database():
        return None

    monkeypatch.setattr(workflow_tools, "ensure_mcp_database", fake_ensure_mcp_database)
    monkeypatch.setattr(environment_tools, "ensure_mcp_database", fake_ensure_mcp_database)
    monkeypatch.setattr(collection_tools, "ensure_mcp_database", fake_ensure_mcp_database)


def sample_workflow(**overrides):
    data = {
        "workflowId": "wf-1",
        "name": "Login flow",
        "description": "Checks login",
        "nodes": [
            Node(
                nodeId="n1",
                type="http-request",
                label="Login",
                position={"x": 10, "y": 20},
                config={"Authorization": "Bearer abc123", "method": "POST"},
            )
        ],
        "edges": [Edge(edgeId="e1", source="n1", target="n2")],
        "variables": {"token": "Bearer abc123", "baseUrl": "https://example.com"},
        "tags": ["smoke"],
        "collectionId": "col-1",
        "environmentId": "env-1",
        "nodeTemplates": [{"name": "Imported request"}],
        "createdAt": datetime(2026, 1, 1, tzinfo=UTC),
        "updatedAt": datetime(2026, 1, 2, tzinfo=UTC),
        "version": 3,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def sample_collection(**overrides):
    data = {
        "collectionId": "col-1",
        "name": "Smoke tests",
        "description": "Critical checks",
        "color": "#3B82F6",
        "workflowCount": 1,
        "createdAt": datetime(2026, 1, 1, tzinfo=UTC),
        "updatedAt": datetime(2026, 1, 2, tzinfo=UTC),
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def sample_environment(**overrides):
    data = {
        "environmentId": "env-1",
        "name": "Local",
        "description": "Local development",
        "swaggerDocUrl": "https://example.com/openapi.json",
        "variables": {"baseUrl": "https://example.com"},
        "secrets": {"API_TOKEN": "<SECRET>"},
        "isActive": True,
        "createdAt": datetime(2026, 1, 1, tzinfo=UTC),
        "updatedAt": datetime(2026, 1, 2, tzinfo=UTC),
    }
    data.update(overrides)
    return data


@pytest.mark.asyncio
async def test_workflow_list_passes_filters_and_returns_summaries(monkeypatch):
    captured = {}

    async def fake_list_workflows(skip, limit, tag, name):
        captured.update({"skip": skip, "limit": limit, "tag": tag, "name": name})
        return SimpleNamespace(
            workflows=[sample_workflow()],
            total=1,
            skip=skip,
            limit=limit,
            hasMore=False,
        )

    monkeypatch.setattr(workflow_tools, "svc_list_workflows", fake_list_workflows)

    response = await workflow_tools.workflow_list(skip=2, limit=5, tag="smoke", name="login")

    assert captured == {"skip": 2, "limit": 5, "tag": "smoke", "name": "login"}
    assert response.total == 1
    assert response.has_more is False
    assert response.workflows[0].workflow_id == "wf-1"
    assert response.workflows[0].node_count == 1


@pytest.mark.asyncio
async def test_workflow_get_redacts_secret_like_values(monkeypatch):
    async def fake_get_workflow(workflow_id):
        assert workflow_id == "wf-1"
        return sample_workflow()

    monkeypatch.setattr(workflow_tools, "svc_get_workflow", fake_get_workflow)

    response = await workflow_tools.workflow_get("wf-1")

    assert response.variables["token"] == "<SECRET>"
    assert response.variables["baseUrl"] == "https://example.com"
    assert response.nodes[0]["config"]["Authorization"] == "<SECRET>"
    assert "variables.token" in response.redacted_secret_references
    assert "nodes.n1.config.Authorization" in response.redacted_secret_references


@pytest.mark.asyncio
async def test_workflow_create_uses_shared_service(monkeypatch):
    captured = {}

    async def fake_create_workflow(workflow):
        captured["workflow"] = workflow
        return sample_workflow(name=workflow.name, tags=workflow.tags)

    monkeypatch.setattr(workflow_tools, "svc_create_workflow", fake_create_workflow)

    response = await workflow_tools.workflow_create(
        name="Created",
        tags=["api"],
        variables={"plain": "value"},
        collection_id="col-1",
    )

    workflow = captured["workflow"]
    assert workflow.name == "Created"
    assert workflow.tags == ["api"]
    assert workflow.collectionId == "col-1"
    assert response.name == "Created"


@pytest.mark.asyncio
async def test_workflow_update_omits_unset_fields(monkeypatch):
    captured = {}

    async def fake_update_workflow(workflow_id, update):
        captured["workflow_id"] = workflow_id
        captured["update"] = update
        return sample_workflow(name=update.name, variables=update.variables)

    monkeypatch.setattr(workflow_tools, "svc_update_workflow", fake_update_workflow)

    response = await workflow_tools.workflow_update(
        workflow_id="wf-1",
        name="Renamed",
        variables={},
    )

    update_dump = captured["update"].model_dump(exclude_unset=True)
    assert captured["workflow_id"] == "wf-1"
    assert update_dump == {"name": "Renamed", "variables": {}}
    assert response.name == "Renamed"


@pytest.mark.asyncio
async def test_workflow_export_wraps_sanitized_bundle(monkeypatch):
    captured = {}

    async def fake_export_workflow(workflow_id, include_environment, app_version):
        captured.update(
            {
                "workflow_id": workflow_id,
                "include_environment": include_environment,
                "app_version": app_version,
            }
        )
        return {"workflow": {"workflowId": workflow_id}, "secretReferences": ["variables.token"]}

    monkeypatch.setattr(workflow_tools, "svc_export_workflow", fake_export_workflow)

    response = await workflow_tools.workflow_export("wf-1", include_environment=False)

    assert captured["workflow_id"] == "wf-1"
    assert captured["include_environment"] is False
    assert response.bundle["secretReferences"] == ["variables.token"]


@pytest.mark.asyncio
async def test_workflow_import_defaults_to_sanitize(monkeypatch):
    captured = {}

    async def fake_import_workflow(
        bundle,
        environment_mapping,
        create_missing_environments,
        sanitize,
    ):
        captured.update(
            {
                "bundle": bundle,
                "environment_mapping": environment_mapping,
                "create_missing_environments": create_missing_environments,
                "sanitize": sanitize,
            }
        )
        return {
            "message": "Workflow imported successfully",
            "workflowId": "wf-new",
            "environmentId": "env-new",
            "secretReferences": ["variables.token"],
        }

    monkeypatch.setattr(workflow_tools, "svc_import_workflow", fake_import_workflow)

    response = await workflow_tools.workflow_import({"workflow": {"name": "Imported"}})

    assert captured["sanitize"] is True
    assert response.workflow_id == "wf-new"
    assert response.environment_id == "env-new"
    assert response.secret_references == ["variables.token"]


@pytest.mark.asyncio
async def test_workflow_import_dry_run_returns_validation_result(monkeypatch):
    async def fake_import_workflow_dry_run(bundle):
        assert bundle == {"workflow": {"name": "Imported"}}
        return {"valid": True, "errors": [], "warnings": ["ok"], "stats": {"nodes": 1}}

    monkeypatch.setattr(
        workflow_tools,
        "svc_import_workflow_dry_run",
        fake_import_workflow_dry_run,
    )

    response = await workflow_tools.workflow_import_dry_run({"workflow": {"name": "Imported"}})

    assert response.valid is True
    assert response.warnings == ["ok"]
    assert response.stats == {"nodes": 1}


@pytest.mark.asyncio
async def test_environment_tools_return_redacted_environments(monkeypatch):
    async def fake_list_environments_redacted():
        return [sample_environment()]

    async def fake_get_active_environment_redacted():
        return sample_environment(name="Active")

    monkeypatch.setattr(
        environment_tools,
        "svc_list_environments_redacted",
        fake_list_environments_redacted,
    )
    monkeypatch.setattr(
        environment_tools,
        "svc_get_active_environment_redacted",
        fake_get_active_environment_redacted,
    )

    listed = await environment_tools.environment_list()
    active = await environment_tools.environment_get_active()

    assert listed.total == 1
    assert listed.environments[0].secrets == {"API_TOKEN": "<SECRET>"}
    assert active.environment.name == "Active"
    assert active.environment.secrets == {"API_TOKEN": "<SECRET>"}


@pytest.mark.asyncio
async def test_collection_tools_return_counts_and_workflows(monkeypatch):
    async def fake_list_collections():
        return [sample_collection()]

    async def fake_list_collection_workflows(collection_id):
        assert collection_id == "col-1"
        return [sample_workflow(collectionId=collection_id)]

    monkeypatch.setattr(collection_tools, "svc_list_collections", fake_list_collections)
    monkeypatch.setattr(
        collection_tools,
        "svc_list_collection_workflows",
        fake_list_collection_workflows,
    )

    listed = await collection_tools.collection_list()
    workflows = await collection_tools.collection_list_workflows("col-1")

    assert listed.collections[0].workflow_count == 1
    assert workflows.collection_id == "col-1"
    assert workflows.workflows[0].collection_id == "col-1"


@pytest.mark.asyncio
async def test_registers_all_phase2_tools():
    server = FastMCP(name="test")

    workflow_tools.register_workflow_tools(server)
    environment_tools.register_environment_tools(server)
    collection_tools.register_collection_tools(server)

    tool_names = {tool.name for tool in await server.list_tools()}

    assert {
        "workflow_list",
        "workflow_get",
        "workflow_create",
        "workflow_update",
        "workflow_export",
        "workflow_import",
        "workflow_import_dry_run",
        "environment_list",
        "environment_get_active",
        "collection_list",
        "collection_list_workflows",
    }.issubset(tool_names)
