"""
MCP Scope Context — contextvars-based scope propagation.

Bridges the gap between the auth middleware (which validates service tokens
on HTTP requests) and MCP tool functions (which are called through the MCP
protocol and don't have direct access to the request object).

The auth middleware and stdio transport set the scope context before MCP
tools are invoked. Tool functions read the scope context to enforce
workspace/organization isolation.

Usage in tool functions:
    from app.mcp.scope_context import get_scope, require_workspace_scope

    scope = get_scope()
    workspace_id = require_workspace_scope()  # Raises if not workspace-scoped
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass

# Context variable holding the current MCP actor scope.
# Set by auth middleware (HTTP) or stdio transport startup.
_mcp_scope: ContextVar[McpScopeContext | None] = ContextVar("mcp_scope", default=None)


@dataclass(frozen=True)
class McpScopeContext:
    """Immutable scope context for the current MCP session/request."""

    actor_type: str  # "service_token" | "stdio"
    actor_id: str  # tokenId or "stdio-local"
    scope_type: str  # "workspace" | "organization"
    scope_id: str  # workspaceId or orgId
    permissions: list[str]

    def has_permission(self, permission: str) -> bool:
        """Check if the scope context includes a specific permission."""
        return permission in self.permissions

    def matches_scope(self, scope_type: str, scope_id: str) -> bool:
        """Check if the scope context matches the expected scope."""
        return self.scope_type == scope_type and self.scope_id == scope_id


def set_scope(context: McpScopeContext) -> None:
    """Set the scope context for the current async task."""
    _mcp_scope.set(context)


def get_scope() -> McpScopeContext | None:
    """Get the current scope context, or None if not set."""
    return _mcp_scope.get()


def require_scope() -> McpScopeContext:
    """Get the current scope context, raising if not authenticated.

    Raises:
        PermissionError: If no scope context is set (unauthenticated).
    """
    ctx = _mcp_scope.get()
    if ctx is None:
        raise PermissionError(
            "MCP request not authenticated. " "A scoped service token is required."
        )
    return ctx


def require_workspace_scope() -> str:
    """Get the workspace ID from the scope context.

    Returns the workspace_id if the token is workspace-scoped.
    For organization-scoped tokens, returns the org scope_id
    (callers should use require_scope() for finer control).

    Raises:
        PermissionError: If not authenticated.
    """
    ctx = require_scope()
    return ctx.scope_id


def require_scope_matches(
    expected_scope_type: str,
    expected_scope_id: str,
) -> None:
    """Assert the current scope matches the expected scope.

    Raises:
        PermissionError: If scope doesn't match (cross-workspace access).
    """
    ctx = require_scope()
    if not ctx.matches_scope(expected_scope_type, expected_scope_id):
        raise PermissionError(
            f"Access denied: token scope is {ctx.scope_type}/{ctx.scope_id}, "
            f"but resource requires {expected_scope_type}/{expected_scope_id}"
        )


def require_permission(permission: str) -> None:
    """Assert the current scope has a specific permission.

    Raises:
        PermissionError: If the permission is not granted.
    """
    ctx = require_scope()
    if not ctx.has_permission(permission):
        raise PermissionError(
            f"Access denied: token lacks permission '{permission}'. "
            f"Token permissions: {ctx.permissions}"
        )


def clear_scope() -> None:
    """Clear the scope context. Used for testing."""
    _mcp_scope.set(None)
