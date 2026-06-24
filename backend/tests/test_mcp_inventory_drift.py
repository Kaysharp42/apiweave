"""
MCP inventory drift detection test — scoped tool inventory.

Ensures the registered MCP tool inventory matches the expected scoped
tool set. Old flat tools (collection_*, environment_set_secret,
environment_get_active, environment_activate) must NOT be present.
"""

import pytest

from app.mcp.server import mcp_server, register_tools

# ── Source-of-truth: expected scoped tool inventory ──────────────────────────

EXPECTED_SCOPED_TOOLS = sorted(
    [
        # Server info
        "server_info",
        # Capability discovery (catalogs tools/resources/grammar for agents)
        "mcp_describe_capabilities",
        # Scoped workflow tools (10)
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
        # Scoped environment tools (7)
        "environment_list",
        "environment_create",
        "environment_get",
        "environment_update",
        "environment_delete",
        "environment_duplicate",
        "mcp_get_config_summary",
        # Scoped project tools (5) — replaces collection tools
        "project_list",
        "project_create",
        "project_get",
        "project_update",
        "project_delete",
        # Scoped project-run tools (1) — replaces collection-run tools
        "project_run_list",
        # Scoped run tools (7) — no runtime_secrets
        "workflow_run",
        "run_get_status",
        "run_get_results",
        "run_get_node_result",
        "run_latest_failed",
        "run_list",
        "run_cancel",
        # Import tools (6) — utility, no scope needed
        "import_openapi_url",
        "import_openapi",
        "import_openapi_dry_run",
        "import_har",
        "import_har_dry_run",
        "import_curl",
        # Scoped secret tools (5) — encrypted, metadata-only
        "secret_get_public_key",
        "secret_list",
        "secret_create",
        "secret_update",
        "secret_delete",
        # Scoped webhook tools (7)
        "webhook_list",
        "webhook_get",
        "webhook_create",
        "webhook_update",
        "webhook_delete",
        "webhook_regenerate_credentials",
        "webhook_get_logs",
    ]
)

# Old flat tools that MUST NOT be present
FORBIDDEN_TOOLS = sorted(
    [
        # Old collection tools
        "collection_list",
        "collection_list_workflows",
        "collection_create",
        "collection_get",
        "collection_update",
        "collection_delete",
        "collection_export",
        "collection_import",
        "collection_import_dry_run",
        "collection_add_workflow",
        "collection_remove_workflow",
        # Old collection-run tools
        "collection_run_list",
        "collection_run_get",
        "collection_run_latest",
        # Old plaintext secret tools
        "environment_set_secret",
        "environment_delete_secret",
        # Old flat environment tools
        "environment_get_active",
        "environment_activate",
    ]
)

EXPECTED_TOOL_COUNT = len(EXPECTED_SCOPED_TOOLS)


@pytest.fixture(autouse=True)
def _register():
    """Ensure tools are registered before each test."""
    register_tools()


@pytest.mark.asyncio
async def test_scoped_tool_count():
    """Verify the total scoped tool count matches expected."""
    tools = await mcp_server.list_tools()
    tool_names = sorted([t.name for t in tools])
    assert len(tool_names) == EXPECTED_TOOL_COUNT, (
        f"Expected {EXPECTED_TOOL_COUNT} scoped tools but found {len(tool_names)}. "
        f"Tools: {tool_names}"
    )


@pytest.mark.asyncio
async def test_all_scoped_tools_registered():
    """Verify every expected scoped tool is registered."""
    tools = await mcp_server.list_tools()
    tool_names = sorted([t.name for t in tools])

    missing = set(EXPECTED_SCOPED_TOOLS) - set(tool_names)
    extra = set(tool_names) - set(EXPECTED_SCOPED_TOOLS)

    assert not missing, f"Expected scoped tools NOT registered: {sorted(missing)}"
    assert not extra, f"Unexpected tools registered: {sorted(extra)}"


@pytest.mark.asyncio
async def test_no_old_flat_tools():
    """Verify old flat tools are NOT registered."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    present_forbidden = set(FORBIDDEN_TOOLS) & set(tool_names)
    assert not present_forbidden, (
        f"Old flat tools still registered: {sorted(present_forbidden)}. "
        f"These must be removed in the scoped refactor."
    )


@pytest.mark.asyncio
async def test_no_plaintext_secret_tools():
    """Verify old plaintext secret tools are absent."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    assert (
        "environment_set_secret" not in tool_names
    ), "environment_set_secret was removed in scoped secrets refactor"
    assert (
        "environment_delete_secret" not in tool_names
    ), "environment_delete_secret was removed in scoped secrets refactor"


@pytest.mark.asyncio
async def test_scoped_secret_tools_present():
    """Verify new scoped encrypted secret tools are registered."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    expected_secret_tools = [
        "secret_get_public_key",
        "secret_list",
        "secret_create",
        "secret_update",
        "secret_delete",
    ]
    for tool_name in expected_secret_tools:
        assert tool_name in tool_names, f"Scoped secret tool '{tool_name}' not registered"


@pytest.mark.asyncio
async def test_project_tools_replace_collection_tools():
    """Verify project tools exist and collection tools do not."""
    tools = await mcp_server.list_tools()
    tool_names = [t.name for t in tools]

    # Project tools should exist
    for tool_name in [
        "project_list",
        "project_create",
        "project_get",
        "project_update",
        "project_delete",
    ]:
        assert tool_name in tool_names, f"Project tool '{tool_name}' not registered"

    # Collection tools should NOT exist
    for tool_name in ["collection_list", "collection_create", "collection_get"]:
        assert tool_name not in tool_names, f"Old collection tool '{tool_name}' still registered"
