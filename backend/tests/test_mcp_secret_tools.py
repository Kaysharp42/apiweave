"""
Tests for MCP secret tools — verifies scoped encrypted tools and
old plaintext tools are removed.

QA Scenario: MCP secret write requires encrypted scoped API
- Old plaintext tools (environment_set_secret, environment_delete_secret) absent
- New scoped tools (secret_create, secret_list, etc.) present
- New tools require ciphertext (not plaintext)
"""

import pytest

from app.mcp.scope_context import McpScopeContext, clear_scope, set_scope
from app.mcp.server import mcp_server, register_tools


@pytest.fixture(autouse=True)
def _register():
    """Ensure tools are registered before each test."""
    register_tools()


@pytest.fixture(autouse=True)
def _clear_scope():
    """Clear scope context after each test."""
    yield
    clear_scope()


@pytest.mark.asyncio
async def test_old_secret_tools_not_registered():
    """Old plaintext secret tools are no longer registered."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    assert "environment_set_secret" not in tool_names
    assert "environment_delete_secret" not in tool_names


@pytest.mark.asyncio
async def test_scoped_secret_tools_registered():
    """New scoped encrypted secret tools are registered."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    expected = [
        "secret_get_public_key",
        "secret_list",
        "secret_create",
        "secret_update",
        "secret_delete",
    ]
    for name in expected:
        assert name in tool_names, f"Scoped secret tool '{name}' not found"


@pytest.mark.asyncio
async def test_secret_list_requires_scope():
    """secret_list raises PermissionError without scope context."""
    from app.mcp.tools.secrets import secret_list

    clear_scope()
    with pytest.raises(PermissionError, match="not authenticated"):
        await secret_list()


@pytest.mark.asyncio
async def test_secret_create_requires_scope():
    """secret_create raises PermissionError without scope context."""
    from app.mcp.tools.secrets import secret_create

    clear_scope()
    with pytest.raises(PermissionError, match="not authenticated"):
        await secret_create(
            name="TEST_SECRET",
            ciphertext="base64ciphertext==",
            key_id="kp-test",
        )


@pytest.mark.asyncio
async def test_secret_get_public_key_requires_scope():
    """secret_get_public_key raises PermissionError without scope context."""
    from app.mcp.tools.secrets import secret_get_public_key

    clear_scope()
    with pytest.raises(PermissionError, match="not authenticated"):
        await secret_get_public_key()


@pytest.mark.asyncio
async def test_secret_get_public_key_cross_scope_denied():
    """secret_get_public_key denies cross-scope access."""
    from app.mcp.tools.secrets import secret_get_public_key

    # Set scope to workspace A
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id="st-test",
            scope_type="workspace",
            scope_id="ws-workspace-a",
            permissions=["secrets:write"],
        )
    )

    # Try to get public key for workspace B — should be denied
    with pytest.raises(PermissionError, match="Access denied"):
        await secret_get_public_key(
            scope_type="workspace",
            scope_id="ws-workspace-b",
        )
