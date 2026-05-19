"""
FastMCP server instance and tool registration.
"""
import logging

from mcp.server.fastmcp import FastMCP

from app.config import settings

logger = logging.getLogger(__name__)
_tools_registered = False

mcp_server = FastMCP(
    name="APIWeave",
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
)


@mcp_server.tool()
async def server_info() -> dict:
    """Return information about the APIWeave MCP server."""
    return {
        "name": "APIWeave",
        "version": settings.VERSION,
        "mcp_enabled": settings.MCP_ENABLED,
        "http_enabled": settings.MCP_HTTP_ENABLED,
        "description": "Visual API Test Workflows MCP Server",
    }


def register_tools() -> None:
    """Register all MCP tools from tool modules."""
    global _tools_registered
    if _tools_registered:
        return

    from app.mcp.tools.collections import register_collection_tools
    from app.mcp.tools.environments import register_environment_tools
    from app.mcp.tools.imports import register_import_tools
    from app.mcp.tools.runs import register_run_tools
    from app.mcp.tools.secrets import register_secret_tools
    from app.mcp.tools.webhooks import register_webhook_tools
    from app.mcp.tools.workflows import register_workflow_tools

    register_workflow_tools(mcp_server)
    register_environment_tools(mcp_server)
    register_collection_tools(mcp_server)
    register_run_tools(mcp_server)
    register_import_tools(mcp_server)
    register_secret_tools(mcp_server)
    register_webhook_tools(mcp_server)

    _tools_registered = True
    logger.info("MCP tools registered")


def register_resources() -> None:
    """Register all MCP resources from resource modules."""
    from app.mcp.resources.environments import register_environment_resources
    from app.mcp.resources.runs import register_run_resources
    from app.mcp.resources.workflows import register_workflow_resources

    register_workflow_resources(mcp_server)
    register_environment_resources(mcp_server)
    register_run_resources(mcp_server)

    logger.info("MCP resources registered")


def register_prompts() -> None:
    """Register all MCP prompts from prompt modules."""
    from app.mcp.prompts.debug import register_debug_prompts
    from app.mcp.prompts.workflow import register_workflow_prompts

    register_workflow_prompts(mcp_server)
    register_debug_prompts(mcp_server)

    logger.info("MCP prompts registered")
