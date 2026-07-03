"""MCP environment tools scope binding (roadmap §3.6, MCP surface).

environment_get / environment_update / environment_delete operated by id with
no token-scope check (cross-tenant read/modify/delete). They now require the
env to belong to the token's scope. Service is monkeypatched, so no DB.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.tools import environments as tools

_T = datetime(2026, 6, 26, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _mcp_env(monkeypatch):
    async def _noop() -> None:
        return None

    monkeypatch.setattr(tools, "ensure_mcp_database", _noop)
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id="alice",
            scope_type="workspace",
            scope_id="ws-alice",
            permissions=[],
        )
    )
    yield
    clear_scope()


def _patch_env(monkeypatch, scope_type: str, scope_id: str) -> None:
    async def get_scoped_environment(environment_id: str):
        return SimpleNamespace(
            environmentId=environment_id,
            name="prod",
            description=None,
            swaggerDocUrl=None,
            variables={},
            scopeType=scope_type,
            scopeId=scope_id,
            createdAt=_T,
            updatedAt=_T,
        )

    monkeypatch.setattr(
        tools.scoped_environment_service, "get_scoped_environment", get_scoped_environment
    )


async def test_get_denied_for_out_of_scope_env(monkeypatch) -> None:
    _patch_env(monkeypatch, "workspace", "ws-other")
    with pytest.raises(ValueError):
        await tools.environment_get(environment_id="env-x")


async def test_delete_denied_for_out_of_scope_env(monkeypatch) -> None:
    _patch_env(monkeypatch, "workspace", "ws-other")
    with pytest.raises(ValueError):
        await tools.environment_delete(environment_id="env-x")


async def test_get_allowed_for_in_scope_env(monkeypatch) -> None:
    _patch_env(monkeypatch, "workspace", "ws-alice")
    result = await tools.environment_get(environment_id="env-mine")
    assert result.environment.environment_id == "env-mine"
