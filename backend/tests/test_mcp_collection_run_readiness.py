"""Tests for collection-run readiness gate."""
import pytest

from app.mcp.collection_run_readiness import COLLECTION_RUN_READINESS


def test_readiness_decision_exists():
    assert COLLECTION_RUN_READINESS["read_tools"] == "GO"
    assert COLLECTION_RUN_READINESS["execution_tools"] == "NO_GO"


def test_allowed_tools_are_read_only():
    allowed = COLLECTION_RUN_READINESS["allowed_mcp_tools"]
    assert "collection_run_list" in allowed
    assert "collection_run_get" in allowed
    assert "collection_run_latest" in allowed


def test_blocked_tools_are_execution():
    blocked = COLLECTION_RUN_READINESS["blocked_mcp_tools"]
    assert "collection_run_execute" in blocked
    assert "collection_run_trigger" in blocked


@pytest.mark.asyncio
async def test_no_execution_tool_registered():
    """Verify no collection execution tool is registered in MCP server."""
    from app.mcp.server import mcp_server
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]
    for blocked in COLLECTION_RUN_READINESS["blocked_mcp_tools"]:
        assert blocked not in tool_names, (
            f"Blocked tool '{blocked}' should not be registered"
        )
