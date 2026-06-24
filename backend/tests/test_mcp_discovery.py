"""
Tests for the MCP capability discovery tool (mcp_describe_capabilities).
"""

import pytest
from mcp.server.fastmcp import FastMCP

from app.mcp.tools.discovery import (
    CAPABILITIES_SCHEMA_VERSION,
    DOCS_RESOURCES,
    NODE_TYPES,
    PLACEHOLDER_NAMESPACES,
    RESOURCE_URIS,
    CapabilitiesResponse,
    make_describe_capabilities,
    register_discovery_tools,
)
from app.mcp.tools.workflows import register_workflow_tools
from app.runner.dynamic_functions import DynamicFunctions


@pytest.mark.asyncio
async def test_describe_capabilities_returns_versioned_response():
    server = FastMCP(name="test-discovery")
    register_workflow_tools(server)
    register_discovery_tools(server)

    describe = make_describe_capabilities(server)
    response = await describe()

    assert isinstance(response, CapabilitiesResponse)
    assert response.schema_version == CAPABILITIES_SCHEMA_VERSION
    assert response.server_name == "APIWeave"


@pytest.mark.asyncio
async def test_describe_capabilities_includes_every_registered_tool():
    server = FastMCP(name="test-discovery-tools")
    register_workflow_tools(server)
    register_discovery_tools(server)

    describe = make_describe_capabilities(server)
    response = await describe()

    tool_names = {entry.name for entry in response.tools}
    expected_subset = {
        "workflow_list",
        "workflow_get",
        "workflow_create",
        "workflow_update",
        "workflow_import",
        "mcp_describe_capabilities",
    }
    assert expected_subset.issubset(tool_names), (
        f"Discovery tool missed entries: {expected_subset - tool_names}"
    )
    for entry in response.tools:
        assert entry.description, f"Tool {entry.name} has empty description"


@pytest.mark.asyncio
async def test_describe_capabilities_enumerates_four_namespaces():
    server = FastMCP(name="test-discovery-ns")
    register_discovery_tools(server)
    describe = make_describe_capabilities(server)

    response = await describe()
    namespaces = {ns.namespace for ns in response.placeholder_namespaces}
    assert namespaces == {"variables", "env", "prev", "secrets"}


@pytest.mark.asyncio
async def test_describe_capabilities_lists_all_dynamic_functions():
    server = FastMCP(name="test-discovery-fn")
    register_discovery_tools(server)
    describe = make_describe_capabilities(server)

    response = await describe()
    fn_names = {f.name for f in response.dynamic_functions}
    expected = set(DynamicFunctions.get_all_functions().keys())
    expected_names = {sig.split("(", 1)[0] for sig in expected}
    assert fn_names == expected_names
    assert len(response.dynamic_functions) == 13


@pytest.mark.asyncio
async def test_describe_capabilities_lists_all_node_types():
    server = FastMCP(name="test-discovery-nodes")
    register_discovery_tools(server)
    describe = make_describe_capabilities(server)

    response = await describe()
    node_type_names = {nt.type for nt in response.node_types}
    expected = {"start", "end", "http-request", "assertion", "delay", "merge", "condition"}
    assert node_type_names == expected
    for nt in response.node_types:
        assert nt.purpose, f"Node type {nt.type} missing purpose"
        assert nt.handles, f"Node type {nt.type} missing handles description"


@pytest.mark.asyncio
async def test_describe_capabilities_lists_doc_resources():
    server = FastMCP(name="test-discovery-docs")
    register_discovery_tools(server)
    describe = make_describe_capabilities(server)

    response = await describe()
    doc_uris = {d.uri for d in response.docs}
    assert "apiweave://docs/placeholders" in doc_uris
    assert "apiweave://docs/dynamic-functions" in doc_uris
    assert "apiweave://docs/variables-and-extractors" in doc_uris
    assert "apiweave://docs/workflows-and-nodes" in doc_uris


def test_module_level_catalogs_are_consistent():
    # Catch drift between the module-level lists and the response schema.
    assert all("namespace" in ns and "syntax" in ns for ns in PLACEHOLDER_NAMESPACES)
    assert all("uri" in d and "title" in d for d in DOCS_RESOURCES)
    assert all("uri" in r and "purpose" in r for r in RESOURCE_URIS)
    assert set(NODE_TYPES) == {
        "start",
        "end",
        "http-request",
        "assertion",
        "delay",
        "merge",
        "condition",
    }
