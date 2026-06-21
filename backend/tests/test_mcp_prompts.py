"""
Tests for MCP prompts — workflow creation and debugging templates.
"""

import pytest
from app.mcp.prompts.debug import register_debug_prompts
from app.mcp.prompts.workflow import register_workflow_prompts


@pytest.mark.asyncio
async def test_workflow_prompts_registered():
    """Workflow prompts are registered on the server."""
    from mcp.server.fastmcp import FastMCP

    server = FastMCP(name="TestServer")
    register_workflow_prompts(server)

    prompts = await server.list_prompts()
    prompt_names = [p.name for p in prompts]

    assert "create_test_from_openapi" in prompt_names
    assert "create_test_from_curl" in prompt_names


@pytest.mark.asyncio
async def test_debug_prompts_registered():
    """Debug prompts are registered on the server."""
    from mcp.server.fastmcp import FastMCP

    server = FastMCP(name="TestServer")
    register_debug_prompts(server)

    prompts = await server.list_prompts()
    prompt_names = [p.name for p in prompts]

    assert "debug_failed_run" in prompt_names
    assert "resume_failed_workflow" in prompt_names


@pytest.mark.asyncio
async def test_create_test_from_openapi_has_required_args():
    """Create test from OpenAPI prompt requires openapi_url argument."""
    from mcp.server.fastmcp import FastMCP

    server = FastMCP(name="TestServer")
    register_workflow_prompts(server)

    prompts = await server.list_prompts()
    openapi_prompt = next(p for p in prompts if p.name == "create_test_from_openapi")

    assert openapi_prompt is not None
    arg_names = [a.name for a in (openapi_prompt.arguments or [])]
    assert "openapi_url" in arg_names


@pytest.mark.asyncio
async def test_debug_failed_run_has_required_args():
    """Debug failed run prompt requires workflow_id argument."""
    from mcp.server.fastmcp import FastMCP

    server = FastMCP(name="TestServer")
    register_debug_prompts(server)

    prompts = await server.list_prompts()
    debug_prompt = next(p for p in prompts if p.name == "debug_failed_run")

    assert debug_prompt is not None
    arg_names = [a.name for a in (debug_prompt.arguments or [])]
    assert "workflow_id" in arg_names
