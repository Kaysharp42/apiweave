"""MCP collection-run tools scope binding (roadmap §3.6, MCP surface).

collection_run_list / _get / _latest returned collection-run metadata for any
collection_id with no scope check. They now bind the collection to the token's
workspace. Repos are monkeypatched, so no DB is needed.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.tools import collection_runs as tools


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


def _patch_collection(monkeypatch, workspace_id: str | None) -> None:
    async def get_by_id(collection_id: str):
        if workspace_id is None:
            return None
        return SimpleNamespace(collectionId=collection_id, workspaceId=workspace_id)

    monkeypatch.setattr(tools.CollectionRepository, "get_by_id", get_by_id)


async def test_list_denied_for_out_of_scope_collection(monkeypatch) -> None:
    _patch_collection(monkeypatch, "ws-other")
    with pytest.raises(ValueError):
        await tools.collection_run_list(collection_id="coll-x")


async def test_latest_denied_for_out_of_scope_collection(monkeypatch) -> None:
    _patch_collection(monkeypatch, "ws-other")
    with pytest.raises(ValueError):
        await tools.collection_run_latest(collection_id="coll-x")


async def test_get_denied_for_out_of_scope_run(monkeypatch) -> None:
    _patch_collection(monkeypatch, "ws-other")

    async def get_run(run_id: str):
        return SimpleNamespace(collectionId="coll-x")

    monkeypatch.setattr(tools.CollectionRunRepository, "get_by_id", get_run)
    with pytest.raises(ValueError):
        await tools.collection_run_get(collection_run_id="crun-x")


async def test_list_allowed_for_in_scope_collection(monkeypatch) -> None:
    _patch_collection(monkeypatch, "ws-alice")

    async def get_by_collection(collection_id: str, skip: int, limit: int):
        return []

    async def count_by_collection(collection_id: str):
        return 0

    monkeypatch.setattr(tools.CollectionRunRepository, "get_by_collection", get_by_collection)
    monkeypatch.setattr(tools.CollectionRunRepository, "count_by_collection", count_by_collection)

    result = await tools.collection_run_list(collection_id="coll-alice")
    assert result["total"] == 0
