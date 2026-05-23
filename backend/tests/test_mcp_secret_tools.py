"""
Tests for MCP environment secret tools — config-gated write-only secret management.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app.mcp.tools.secrets import (
    environment_delete_secret,
    environment_set_secret,
    register_secret_tools,
)


@pytest.mark.asyncio
async def test_set_secret_blocked_when_disabled():
    """Setting a secret raises PermissionError when MCP_ALLOW_SECRET_WRITES is False."""
    with patch("app.mcp.tools.secrets.settings") as mock_settings:
        mock_settings.MCP_ALLOW_SECRET_WRITES = False

        with pytest.raises(PermissionError, match="Persisted secret writes are disabled"):
            await environment_set_secret("env-123", "api_key", "secret-value")


@pytest.mark.asyncio
async def test_delete_secret_blocked_when_disabled():
    """Deleting a secret raises PermissionError when MCP_ALLOW_SECRET_WRITES is False."""
    with patch("app.mcp.tools.secrets.settings") as mock_settings:
        mock_settings.MCP_ALLOW_SECRET_WRITES = False

        with pytest.raises(PermissionError, match="Persisted secret writes are disabled"):
            await environment_delete_secret("env-123", "api_key")


@pytest.mark.asyncio
async def test_set_secret_succeeds_when_enabled():
    """Setting a secret succeeds when MCP_ALLOW_SECRET_WRITES is True."""
    with patch("app.mcp.tools.secrets.settings") as mock_settings:
        mock_settings.MCP_ALLOW_SECRET_WRITES = True

        with patch("app.mcp.tools.secrets.ensure_mcp_database", new_callable=AsyncMock), \
             patch("app.mcp.tools.secrets.svc_set_secret", new_callable=AsyncMock):
            result = await environment_set_secret("env-123", "api_key", "secret-value")

            assert result["environment_id"] == "env-123"
            assert result["key"] == "api_key"
            assert "not returned" in result["note"]


@pytest.mark.asyncio
async def test_delete_secret_succeeds_when_enabled():
    """Deleting a secret succeeds when MCP_ALLOW_SECRET_WRITES is True."""
    with patch("app.mcp.tools.secrets.settings") as mock_settings:
        mock_settings.MCP_ALLOW_SECRET_WRITES = True

        with patch("app.mcp.tools.secrets.ensure_mcp_database", new_callable=AsyncMock), \
             patch("app.mcp.tools.secrets.svc_delete_secret", new_callable=AsyncMock):
            result = await environment_delete_secret("env-123", "api_key")

            assert result["environment_id"] == "env-123"
            assert result["key"] == "api_key"


@pytest.mark.asyncio
async def test_secret_tools_registered():
    """Secret tools are registered on the server."""
    from mcp.server.fastmcp import FastMCP
    server = FastMCP(name="TestServer")
    register_secret_tools(server)

    tools = await server.list_tools()
    tool_names = [t.name for t in tools]

    assert "environment_set_secret" in tool_names
    assert "environment_delete_secret" in tool_names
