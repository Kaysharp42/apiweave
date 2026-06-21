"""
Task 28 — MCP tool inventory verification.

Verifies that:
- All scoped tools are registered (no old flat tools remain)
- The tool inventory matches the expected scoped set
- Old tools (collection_*, environment_set_secret) are NOT present
"""

from __future__ import annotations

import pytest
from app.mcp.tools import environments as environment_tools
from app.mcp.tools import imports as import_tools
from app.mcp.tools import project_runs as project_run_tools
from app.mcp.tools import projects as project_tools
from app.mcp.tools import runs as run_tools
from app.mcp.tools import secrets as secret_tools
from app.mcp.tools import webhooks as webhook_tools
from app.mcp.tools import workflows as workflow_tools
from mcp.server.fastmcp import FastMCP

# Old tools that must NOT be present in the scoped inventory
OLD_FORBIDDEN_TOOLS = {
    "collection_create",
    "collection_get",
    "collection_update",
    "collection_delete",
    "collection_export",
    "collection_import",
    "collection_import_dry_run",
    "collection_add_workflow",
    "collection_remove_workflow",
    "collection_run_list",
    "collection_run_get",
    "collection_run_get_results",
    "environment_set_secret",
    "environment_delete_secret",
}


class TestMcpToolInventory:
    """Verify the MCP tool inventory matches the scoped version."""

    @pytest.mark.asyncio
    async def test_all_scoped_tools_registered(self):
        """All expected scoped tools are registered."""
        server = FastMCP(name="test-inventory")

        workflow_tools.register_workflow_tools(server)
        environment_tools.register_environment_tools(server)
        project_tools.register_project_tools(server)
        project_run_tools.register_project_run_tools(server)
        run_tools.register_run_tools(server)
        import_tools.register_import_tools(server)
        secret_tools.register_secret_tools(server)
        webhook_tools.register_webhook_tools(server)

        tool_names = {tool.name for tool in await server.list_tools()}

        # Core scoped tools that MUST be present
        expected_scoped = {
            # Workflow tools
            "workflow_list",
            "workflow_get",
            "workflow_create",
            "workflow_update",
            "workflow_export",
            "workflow_import",
            "workflow_import_dry_run",
            "workflow_delete",
            "workflow_attach_collection",
            "workflow_set_environment",
            # Run tools
            "workflow_run",
            "run_get_status",
            "run_get_results",
            "run_get_node_result",
            "run_latest_failed",
            "run_list",
            "run_cancel",
            # Environment tools
            "environment_list",
            "environment_create",
            "environment_get",
            "environment_update",
            "environment_delete",
            # Secret tools
            "secret_get_public_key",
            "secret_list",
            "secret_create",
            "secret_update",
            "secret_delete",
            # Project tools
            "project_list",
            "project_get",
            "project_create",
            "project_update",
            "project_delete",
            # Webhook tools
            "webhook_list",
            "webhook_get",
            "webhook_create",
            "webhook_update",
            "webhook_delete",
            "webhook_regenerate_credentials",
            "webhook_get_logs",
            # Import tools
            "import_openapi",
            "import_har",
            "import_curl",
        }

        missing = expected_scoped - tool_names
        assert not missing, f"Missing scoped tools: {sorted(missing)}"

    @pytest.mark.asyncio
    async def test_old_tools_not_registered(self):
        """Old flat tools are NOT in the scoped inventory."""
        server = FastMCP(name="test-no-old")

        workflow_tools.register_workflow_tools(server)
        environment_tools.register_environment_tools(server)
        project_tools.register_project_tools(server)
        project_run_tools.register_project_run_tools(server)
        run_tools.register_run_tools(server)
        import_tools.register_import_tools(server)
        secret_tools.register_secret_tools(server)
        webhook_tools.register_webhook_tools(server)

        tool_names = {tool.name for tool in await server.list_tools()}

        present_forbidden = OLD_FORBIDDEN_TOOLS & tool_names
        assert (
            not present_forbidden
        ), f"Old forbidden tools still registered: {sorted(present_forbidden)}"

    @pytest.mark.asyncio
    async def test_no_plaintext_secret_write_tools(self):
        """No tool allows writing plaintext secrets (all use encrypted ciphertext)."""
        server = FastMCP(name="test-no-plaintext")

        secret_tools.register_secret_tools(server)
        environment_tools.register_environment_tools(server)

        tool_names = {tool.name for tool in await server.list_tools()}

        # These old plaintext secret tools must not exist
        plaintext_tools = {"environment_set_secret", "environment_delete_secret"}
        assert not (plaintext_tools & tool_names), "Plaintext secret write tools still registered"

    @pytest.mark.asyncio
    async def test_run_tools_reject_runtime_secrets_description(self):
        """The workflow_run tool description mentions runtime secrets are NOT accepted."""
        server = FastMCP(name="test-run-desc")
        run_tools.register_run_tools(server)

        tools = await server.list_tools()
        run_tool = next((t for t in tools if t.name == "workflow_run"), None)
        assert run_tool is not None, "workflow_run tool not found"
        desc = run_tool.description or ""
        assert (
            "runtime" in desc.lower() and "secret" in desc.lower()
        ), "workflow_run description should mention runtime secrets are not accepted"

    @pytest.mark.asyncio
    async def test_server_info_reports_scoped_auth(self):
        """server_info tool reports scoped_auth=True."""
        from app.mcp.server import server_info

        result = await server_info()
        assert result["scoped_auth"] is True
        assert result["name"] == "APIWeave"
