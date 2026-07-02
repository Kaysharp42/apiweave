from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.tools import environments as environment_tools
from app.mcp.tools import runs as run_tools
from app.mcp.tools import workflows as workflow_tools
from mcp.server.fastmcp import FastMCP


@pytest.fixture(autouse=True)
def skip_database_initialization(monkeypatch):
    async def fake_ensure_mcp_database():
        return None

    monkeypatch.setattr(workflow_tools, "ensure_mcp_database", fake_ensure_mcp_database)
    monkeypatch.setattr(environment_tools, "ensure_mcp_database", fake_ensure_mcp_database)
    monkeypatch.setattr(run_tools, "ensure_mcp_database", fake_ensure_mcp_database)


@pytest.fixture(autouse=True)
def _mcp_scope():
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id="token-test",
            scope_type="workspace",
            scope_id="ws-test",
            permissions=[
                "workflows:read",
                "workflows:write",
                "environments:read",
                "environments:write",
            ],
        )
    )
    yield
    clear_scope()


def sample_workflow(**overrides):
    data = {
        "workflowId": "wf-1",
        "name": "Login flow",
        "orgId": None,
        "workspaceId": "ws-test",
        "ownerType": "user",
    }
    data.update(overrides)
    return data


def sample_run(**overrides):
    data = {
        "runId": "run-1",
        "workflowId": "wf-1",
        "status": "completed",
        "trigger": "manual",
        "environmentId": "env-1",
        "createdAt": datetime(2026, 1, 1, tzinfo=UTC),
        "duration": 1234,
        "error": None,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def sample_environment_doc(**overrides):
    data = SimpleNamespace(
        environmentId="env-1",
        name="Local",
        description="Local development",
        swaggerDocUrl="https://example.com/openapi.json",
        variables={"baseUrl": "https://example.com"},
        scopeType="workspace",
        scopeId="ws-test",
        createdAt=datetime(2026, 1, 1, tzinfo=UTC),
        updatedAt=datetime(2026, 1, 2, tzinfo=UTC),
    )
    for k, v in overrides.items():
        setattr(data, k, v)
    return data


# --- Workflow Phase 5 tools ---


@pytest.mark.asyncio
async def test_workflow_delete_calls_service(monkeypatch):
    captured = {}

    async def fake_delete(*, workspace_id, workflow_id, actor_user_id):
        captured.update({"workspace_id": workspace_id, "workflow_id": workflow_id})

    monkeypatch.setattr(workflow_tools, "delete_scoped_workflow", fake_delete)

    response = await workflow_tools.workflow_delete("wf-1")

    assert captured["workflow_id"] == "wf-1"
    assert captured["workspace_id"] == "ws-test"
    assert response.workflow_id == "wf-1"
    assert "deleted" in response.message.lower()


@pytest.mark.asyncio
async def test_workflow_attach_collection_calls_service(monkeypatch):
    captured = {}

    async def fake_get_scoped_workflow(*, workspace_id, workflow_id, actor_user_id):
        return sample_workflow()

    async def fake_update(workflow_id, collection_id):
        captured.update({"workflow_id": workflow_id, "collection_id": collection_id})
        return SimpleNamespace(workflowId=workflow_id, collectionId=collection_id)

    monkeypatch.setattr(
        "app.services.scoped_workflow_service.get_scoped_workflow", fake_get_scoped_workflow
    )
    monkeypatch.setattr(
        workflow_tools.WorkflowRepository, "update_collection_assignment", fake_update
    )

    response = await workflow_tools.workflow_attach_collection("wf-1", "col-1")

    assert captured["workflow_id"] == "wf-1"
    assert captured["collection_id"] == "col-1"
    assert response.collection_id == "col-1"


@pytest.mark.asyncio
async def test_workflow_detach_collection(monkeypatch):
    captured = {}

    async def fake_get_scoped_workflow(*, workspace_id, workflow_id, actor_user_id):
        return sample_workflow()

    async def fake_update(workflow_id, collection_id):
        captured.update({"workflow_id": workflow_id, "collection_id": collection_id})
        return SimpleNamespace(workflowId=workflow_id, collectionId=None)

    monkeypatch.setattr(
        "app.services.scoped_workflow_service.get_scoped_workflow", fake_get_scoped_workflow
    )
    monkeypatch.setattr(
        workflow_tools.WorkflowRepository, "update_collection_assignment", fake_update
    )

    response = await workflow_tools.workflow_attach_collection("wf-1", None)

    assert captured["collection_id"] is None
    assert response.collection_id is None


@pytest.mark.asyncio
async def test_workflow_set_environment_calls_service(monkeypatch):
    captured = {}

    async def fake_get_scoped_workflow(*, workspace_id, workflow_id, actor_user_id):
        return sample_workflow()

    async def fake_resolve(*, workspace_id, org_id, explicit_environment_id):
        return SimpleNamespace(environmentId=explicit_environment_id)

    async def fake_update(workflow_id, environment_id):
        captured.update({"workflow_id": workflow_id, "environment_id": environment_id})
        return SimpleNamespace(workflowId=workflow_id, environmentId=environment_id)

    monkeypatch.setattr(
        "app.services.scoped_workflow_service.get_scoped_workflow", fake_get_scoped_workflow
    )
    monkeypatch.setattr(workflow_tools, "resolve_run_environment", fake_resolve)
    monkeypatch.setattr(
        workflow_tools.WorkflowRepository, "update_environment_assignment", fake_update
    )

    response = await workflow_tools.workflow_set_environment("wf-1", "env-2")

    assert captured["environment_id"] == "env-2"
    assert response.environment_id == "env-2"


@pytest.mark.asyncio
async def test_workflow_clear_environment(monkeypatch):
    captured = {}

    async def fake_get_scoped_workflow(*, workspace_id, workflow_id, actor_user_id):
        return sample_workflow()

    async def fake_update(workflow_id, environment_id):
        captured.update({"workflow_id": workflow_id, "environment_id": environment_id})
        return SimpleNamespace(workflowId=workflow_id, environmentId=None)

    monkeypatch.setattr(
        "app.services.scoped_workflow_service.get_scoped_workflow", fake_get_scoped_workflow
    )
    monkeypatch.setattr(
        workflow_tools.WorkflowRepository, "update_environment_assignment", fake_update
    )

    response = await workflow_tools.workflow_set_environment("wf-1", None)

    assert captured["environment_id"] is None
    assert response.environment_id is None


# --- Run Phase 5 tools ---


@pytest.mark.asyncio
async def test_run_list_with_filters(monkeypatch):
    captured = {}

    async def fake_list_runs(*, workflow_id, status_filter, skip, limit):
        captured.update(
            {
                "workflow_id": workflow_id,
                "status_filter": status_filter,
                "skip": skip,
                "limit": limit,
            }
        )
        return [sample_run(status="completed"), sample_run(status="failed")]

    async def fake_get_scoped_workflow(*, workspace_id, workflow_id, actor_user_id):
        return {"workflowId": workflow_id}

    monkeypatch.setattr(run_tools, "svc_list_runs", fake_list_runs)
    monkeypatch.setattr(
        "app.services.scoped_workflow_service.get_scoped_workflow", fake_get_scoped_workflow
    )

    response = await run_tools.run_list(
        workflow_id="wf-1", status_filter="completed", skip=0, limit=10
    )

    assert captured["workflow_id"] == "wf-1"
    assert captured["status_filter"] == "completed"
    assert response.total == 2
    assert response.runs[0].run_id == "run-1"


@pytest.mark.asyncio
async def test_run_list_requires_workflow_id():
    # Omitting workflow_id is rejected — an unfiltered list would cross tenants.
    with pytest.raises(ValueError):
        await run_tools.run_list()


# --- Environment Phase 5 tools ---


@pytest.mark.asyncio
async def test_environment_create_calls_service(monkeypatch):
    captured = {}

    async def fake_create(*, scope_type, scope_id, data):
        captured["data"] = data
        return sample_environment_doc(name=data.name, variables=data.variables)

    monkeypatch.setattr(
        environment_tools.scoped_environment_service, "create_scoped_environment", fake_create
    )

    response = await environment_tools.environment_create(
        name="Staging",
        description="Staging env",
        variables={"baseUrl": "https://staging.example.com"},
    )

    assert captured["data"].name == "Staging"
    assert response.environment.name == "Staging"
    assert response.environment.secrets == {}


@pytest.mark.asyncio
async def test_environment_get_redacts_secrets(monkeypatch):
    async def fake_get(environment_id):
        return sample_environment_doc(environmentId=environment_id, name="Prod")

    monkeypatch.setattr(
        environment_tools.scoped_environment_service, "get_scoped_environment", fake_get
    )

    response = await environment_tools.environment_get("env-1")

    assert response.environment.environment_id == "env-1"
    # Scoped env summaries never expose plaintext secrets.
    assert response.environment.secrets == {}


@pytest.mark.asyncio
async def test_environment_update_calls_service(monkeypatch):
    captured = {}

    async def fake_get(environment_id):
        return sample_environment_doc(environmentId=environment_id)

    async def fake_update(environment_id, data):
        captured.update({"environment_id": environment_id, "data": data})
        return sample_environment_doc(
            environmentId=environment_id,
            name=data.name or "Local",
            variables=data.variables or {},
        )

    monkeypatch.setattr(
        environment_tools.scoped_environment_service, "get_scoped_environment", fake_get
    )
    monkeypatch.setattr(
        environment_tools.scoped_environment_service, "update_scoped_environment", fake_update
    )

    response = await environment_tools.environment_update(
        environment_id="env-1",
        name="Updated",
        variables={"newVar": "value"},
    )

    assert captured["environment_id"] == "env-1"
    update_dump = captured["data"].model_dump(exclude_unset=True)
    assert update_dump["name"] == "Updated"
    assert update_dump["variables"] == {"newVar": "value"}
    assert response.environment.name == "Updated"


@pytest.mark.asyncio
async def test_environment_delete_calls_service(monkeypatch):
    captured = {}

    async def fake_get(environment_id):
        return sample_environment_doc(environmentId=environment_id)

    async def fake_delete(environment_id):
        captured["environment_id"] = environment_id

    monkeypatch.setattr(
        environment_tools.scoped_environment_service, "get_scoped_environment", fake_get
    )
    monkeypatch.setattr(
        environment_tools.scoped_environment_service, "delete_scoped_environment", fake_delete
    )

    response = await environment_tools.environment_delete("env-1")

    assert captured["environment_id"] == "env-1"
    assert response.environment_id == "env-1"


# --- Registration test ---


@pytest.mark.asyncio
async def test_registers_all_phase5_tools():
    server = FastMCP(name="test")

    workflow_tools.register_workflow_tools(server)
    environment_tools.register_environment_tools(server)
    run_tools.register_run_tools(server)

    tool_names = {tool.name for tool in await server.list_tools()}

    expected_phase5 = {
        "workflow_delete",
        "workflow_attach_collection",
        "workflow_set_environment",
        "run_list",
        "environment_create",
        "environment_get",
        "environment_update",
        "environment_delete",
    }

    assert expected_phase5.issubset(tool_names)
