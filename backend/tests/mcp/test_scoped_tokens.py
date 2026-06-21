"""
Task 28 — MCP scoped token enforcement.

Verifies that:
- MCP tools require a valid scope context
- Scope context is checked via require_scope() / require_scope_matches()
- Cross-workspace access is denied via scope_context functions
- Token permissions are checked via require_permission()
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.mcp.scope_context import (
    McpScopeContext,
    clear_scope,
    get_scope,
    require_permission,
    require_scope,
    require_scope_matches,
    require_workspace_scope,
    set_scope,
)


@pytest.fixture(autouse=True)
def _clear_scope():
    """Ensure scope is cleared before and after each test."""
    clear_scope()
    yield
    clear_scope()


class TestMcpScopeContext:
    """McpScopeContext dataclass and methods."""

    def test_scope_context_fields(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=["workflows:run", "secrets:read"],
        )
        assert ctx.actor_type == "service_token"
        assert ctx.actor_id == "tok-1"
        assert ctx.scope_type == "workspace"
        assert ctx.scope_id == "ws-A"
        assert "workflows:run" in ctx.permissions

    def test_has_permission_true(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=["workflows:run", "secrets:read"],
        )
        assert ctx.has_permission("workflows:run") is True
        assert ctx.has_permission("secrets:read") is True

    def test_has_permission_false(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=["workflows:run"],
        )
        assert ctx.has_permission("admin:delete") is False

    def test_matches_scope_true(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        assert ctx.matches_scope("workspace", "ws-A") is True

    def test_matches_scope_false_different_workspace(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        assert ctx.matches_scope("workspace", "ws-B") is False

    def test_matches_scope_false_different_type(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        assert ctx.matches_scope("organization", "ws-A") is False


class TestScopeEnforcement:
    """Scope context set/get/require functions."""

    def test_set_and_get_scope(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=["workflows:run"],
        )
        set_scope(ctx)
        retrieved = get_scope()
        assert retrieved is ctx
        assert retrieved.scope_id == "ws-A"

    def test_get_scope_returns_none_when_not_set(self):
        assert get_scope() is None

    def test_require_scope_raises_when_not_set(self):
        with pytest.raises(PermissionError, match="not authenticated"):
            require_scope()

    def test_require_scope_returns_context_when_set(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        set_scope(ctx)
        result = require_scope()
        assert result is ctx

    def test_require_workspace_scope_returns_scope_id(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-123",
            permissions=[],
        )
        set_scope(ctx)
        assert require_workspace_scope() == "ws-123"

    def test_require_workspace_scope_raises_when_not_set(self):
        with pytest.raises(PermissionError):
            require_workspace_scope()


class TestCrossWorkspaceDenied:
    """Cross-workspace access is denied via scope checks."""

    def test_require_scope_matches_same_workspace(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        set_scope(ctx)
        # Should not raise
        require_scope_matches("workspace", "ws-A")

    def test_require_scope_matches_different_workspace_raises(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        set_scope(ctx)
        with pytest.raises(PermissionError, match="Access denied"):
            require_scope_matches("workspace", "ws-B")

    def test_require_scope_matches_different_type_raises(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=[],
        )
        set_scope(ctx)
        with pytest.raises(PermissionError, match="Access denied"):
            require_scope_matches("organization", "ws-A")


class TestPermissionEnforcement:
    """Permission checks via require_permission."""

    def test_require_permission_granted(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=["workflows:run", "secrets:read"],
        )
        set_scope(ctx)
        # Should not raise
        require_permission("workflows:run")

    def test_require_permission_denied(self):
        ctx = McpScopeContext(
            actor_type="service_token",
            actor_id="tok-1",
            scope_type="workspace",
            scope_id="ws-A",
            permissions=["workflows:run"],
        )
        set_scope(ctx)
        with pytest.raises(PermissionError, match="Access denied"):
            require_permission("admin:delete")

    def test_require_permission_raises_when_not_authenticated(self):
        with pytest.raises(PermissionError):
            require_permission("workflows:run")


class TestMcpAuthHelpers:
    """MCP auth module helper functions."""

    def test_check_token_scope_match(self):
        from app.mcp.auth import check_token_scope

        token = MagicMock()
        token.scopeType = "workspace"
        token.scopeId = "ws-A"
        assert check_token_scope(token, "workspace", "ws-A") is True

    def test_check_token_scope_mismatch(self):
        from app.mcp.auth import check_token_scope

        token = MagicMock()
        token.scopeType = "workspace"
        token.scopeId = "ws-A"
        assert check_token_scope(token, "workspace", "ws-B") is False

    def test_check_token_scope_none_token(self):
        from app.mcp.auth import check_token_scope

        assert check_token_scope(None, "workspace", "ws-A") is False

    def test_check_token_permission_granted(self):
        from app.mcp.auth import check_token_permission

        token = MagicMock()
        token.permissions = {"workflows:run", "secrets:read"}
        assert check_token_permission(token, "workflows:run") is True

    def test_check_token_permission_denied(self):
        from app.mcp.auth import check_token_permission

        token = MagicMock()
        token.permissions = {"workflows:run"}
        assert check_token_permission(token, "admin:delete") is False

    def test_check_token_permission_none_token(self):
        from app.mcp.auth import check_token_permission

        assert check_token_permission(None, "workflows:run") is False
