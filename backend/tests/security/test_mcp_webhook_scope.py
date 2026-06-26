"""MCP webhook tools scope binding (roadmap §3.6, MCP surface).

webhook_get / webhook_update / webhook_delete / webhook_regenerate_credentials /
webhook_get_logs operated by id with no token-scope check — allowing
cross-tenant read, credential rotation, and deletion. They now require the
webhook to belong to the token's workspace. Repos monkeypatched, no DB.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.tools import webhooks as tools


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


def _patch_webhook(monkeypatch, workspace_id: str) -> None:
    async def get_by_id(webhook_id: str):
        return SimpleNamespace(webhookId=webhook_id, workspaceId=workspace_id)

    monkeypatch.setattr(tools.WebhookRepository, "get_by_id", get_by_id)


async def test_get_denied_for_out_of_scope_webhook(monkeypatch) -> None:
    _patch_webhook(monkeypatch, "ws-other")
    with pytest.raises(ValueError):
        await tools.webhook_get(webhook_id="wh-x")


async def test_delete_denied_for_out_of_scope_webhook(monkeypatch) -> None:
    _patch_webhook(monkeypatch, "ws-other")

    async def _fail_delete(webhook_id: str):
        raise AssertionError("delete must not be reached for out-of-scope webhook")

    monkeypatch.setattr(tools.WebhookRepository, "delete", _fail_delete)
    with pytest.raises(ValueError):
        await tools.webhook_delete(webhook_id="wh-x")


async def test_regenerate_denied_for_out_of_scope_webhook(monkeypatch) -> None:
    _patch_webhook(monkeypatch, "ws-other")
    with pytest.raises(ValueError):
        await tools.webhook_regenerate_credentials(webhook_id="wh-x")


async def test_delete_allowed_for_in_scope_webhook(monkeypatch) -> None:
    _patch_webhook(monkeypatch, "ws-alice")

    async def delete(webhook_id: str):
        return True

    monkeypatch.setattr(tools.WebhookRepository, "delete", delete)
    result = await tools.webhook_delete(webhook_id="wh-mine")
    assert result.webhook_id == "wh-mine"
