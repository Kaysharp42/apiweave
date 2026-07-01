"""MCP workflow environment assignment regressions."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.tools import workflows as workflow_tools
from app.models import Environment, Workflow

_T = datetime(2026, 6, 26, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _mcp_env(monkeypatch):
    async def _noop() -> None:
        return None

    monkeypatch.setattr(workflow_tools, "ensure_mcp_database", _noop)
    yield
    clear_scope()


def _scope_alice() -> None:
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id="alice",
            scope_type="workspace",
            scope_id="ws-alice",
            permissions=[],
        )
    )


async def test_set_environment_updates_workflow_by_public_uuid(seeded) -> None:
    workflow_id = "c017ad79-52a5-42fc-97ae-9c9cd47a1ab2"
    environment_id = "env-ac502b06354e"

    await Workflow(
        workflowId=workflow_id,
        name="Local API smoke test",
        workspaceId="ws-alice",
        ownerType="user",
        createdAt=_T,
        updatedAt=_T,
    ).insert()
    await Environment(
        environmentId=environment_id,
        name="Local Dev",
        scopeType="workspace",
        scopeId="ws-alice",
        ownerType="user",
        variables={"BASE_URL": "http://localhost:8000"},
        createdAt=_T,
        updatedAt=_T,
    ).insert()

    _scope_alice()

    response = await workflow_tools.workflow_set_environment(
        workflow_id=workflow_id,
        environment_id=environment_id,
    )

    updated = await Workflow.find_one(Workflow.workflowId == workflow_id)
    assert response.environment_id == environment_id
    assert updated is not None
    assert updated.selectedEnvironmentId == environment_id
