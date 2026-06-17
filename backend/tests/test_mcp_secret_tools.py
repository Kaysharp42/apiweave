"""
Tests for MCP secret tools — verifies old plaintext tools are removed.

The old environment_set_secret and environment_delete_secret tools have been
removed as part of the GitHub-style scoped secrets refactor. Secret management
is now through scoped API routes with client-encrypted writes only.
"""
import pytest

from app.mcp.tools.secrets import register_secret_tools


@pytest.mark.asyncio
async def test_old_secret_tools_not_registered():
    """Old plaintext secret tools are no longer registered."""
    from mcp.server.fastmcp import FastMCP
    server = FastMCP(name="TestServer")
    register_secret_tools(server)

    tools = await server.list_tools()
    tool_names = [t.name for t in tools]

    # Old tools should NOT be present
    assert "environment_set_secret" not in tool_names
    assert "environment_delete_secret" not in tool_names
