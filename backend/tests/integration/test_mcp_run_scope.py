"""MCP run tools scope binding (roadmap §3.6, MCP surface).

The run read/cancel MCP tools previously checked only run.workflowId == the
supplied workflow_id — not that the run's workflow belongs to the token's
scope. A token scoped to one workspace could read or cancel another tenant's
runs. Each tool now binds the workflow to the token scope via
get_scoped_workflow (mirroring workflow_run).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.tools import runs as run_tools
from app.models import Run, Workflow

_T = datetime(2026, 6, 26, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _mcp_env(monkeypatch):
    # MCP tools call ensure_mcp_database(), which re-inits Beanie against a real
    # Mongo and would rebind the models away from the mongomock harness. The
    # `seeded` fixture already initialized Beanie, so make it a no-op.
    async def _noop() -> None:
        return None

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop)
    yield
    clear_scope()


async def _seed_workflows() -> None:
    await Workflow(
        workflowId="wf-alice",
        name="Alice WF",
        workspaceId="ws-alice",
        ownerType="user",
        createdAt=_T,
        updatedAt=_T,
    ).insert()
    await Workflow(
        workflowId="wf-other",
        name="Other WF",
        workspaceId="ws-other",
        ownerType="user",
        createdAt=_T,
        updatedAt=_T,
    ).insert()


def _scope_alice() -> None:
    # Set in the test's own task so the contextvar is visible to the tool call.
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id="alice",
            scope_type="workspace",
            scope_id="ws-alice",
            permissions=[],
        )
    )


async def test_status_denied_for_out_of_scope_workflow(seeded) -> None:
    await _seed_workflows()
    _scope_alice()
    with pytest.raises(ValueError):
        await run_tools.run_get_status(workflow_id="wf-other", run_id="run-x")


async def test_cancel_denied_for_out_of_scope_run(seeded) -> None:
    await _seed_workflows()
    await Run(
        runId="run-other",
        workflowId="wf-other",
        status="running",
        trigger="manual",
        workspaceId="ws-other",
        createdAt=_T,
    ).insert()
    _scope_alice()
    with pytest.raises(ValueError):
        await run_tools.run_cancel(run_id="run-other")


async def test_run_list_requires_workflow_id(seeded) -> None:
    await _seed_workflows()
    _scope_alice()
    with pytest.raises(ValueError):
        await run_tools.run_list()


async def test_in_scope_list_is_allowed(seeded) -> None:
    await _seed_workflows()
    _scope_alice()
    # Workflow is in the token's workspace and alice is a member → scope passes.
    # The seeded fixture already created one run for wf-alice.
    result = await run_tools.run_list(workflow_id="wf-alice")
    assert result.total == 1
