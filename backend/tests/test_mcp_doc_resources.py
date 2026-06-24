"""
Tests for the MCP documentation resources (apiweave://docs/*).
"""

import pytest
from mcp.server.fastmcp import FastMCP

from app.mcp.resources.docs import _read_doc, register_doc_resources


def test_read_doc_returns_existing_placeholder_reference():
    content = _read_doc("reference/placeholders.md")
    assert content.startswith("# Placeholders"), (
        "placeholders.md should start with the '# Placeholders' heading"
    )
    # Sanity checks: the 4 namespaces and their syntax should all appear.
    for fragment in (
        "{{env.NAME}}",
        "{{variables.token}}",
        "{{prev.response",
        "{{secrets.API_KEY}}",
    ):
        assert fragment in content, f"placeholders.md missing {fragment}"


def test_read_doc_returns_existing_dynamic_functions_reference():
    content = _read_doc("reference/dynamic-functions.md")
    assert "Dynamic Functions Reference" in content
    for fn in ("uuid()", "randomString", "timestamp()", "iso_timestamp()"):
        assert fn in content, f"dynamic-functions.md missing {fn}"


def test_read_doc_returns_existing_workflows_and_nodes_guide():
    content = _read_doc("features/workflows-and-nodes.md")
    assert "Workflows and Nodes" in content
    for node_type in ("HTTP Request", "Assertion", "Merge"):
        assert node_type in content, (
            f"workflows-and-nodes.md missing {node_type} section"
        )


def test_read_doc_returns_existing_variables_and_extractors_guide():
    content = _read_doc("features/variables-and-extractors.md")
    assert "Variables and Extractors" in content
    assert "extractor" in content.lower()


def test_read_doc_handles_missing_file_gracefully():
    content = _read_doc("nonexistent/this-doc-does-not-exist.md")
    assert content.startswith("# error reading")


@pytest.mark.asyncio
async def test_register_doc_resources_adds_five_templates():
    server = FastMCP(name="test-doc-resources")
    register_doc_resources(server)

    # FastMCP exposes resources via the internal resource manager. Static
    # resources (no URI placeholder) appear in list_resources, not templates.
    static = server._resource_manager.list_resources()
    uris = {str(r.uri) for r in static}
    expected = {
        "apiweave://docs/placeholders",
        "apiweave://docs/dynamic-functions",
        "apiweave://docs/variables-and-extractors",
        "apiweave://docs/workflows-and-nodes",
        "apiweave://docs/environments-and-secrets",
    }
    assert expected.issubset(uris), f"Missing doc resource URIs: {expected - uris}"
