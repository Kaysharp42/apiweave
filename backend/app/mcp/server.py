"""
FastMCP server instance and tool registration.
"""
import logging

from mcp.server.fastmcp import FastMCP

from app.config import settings

logger = logging.getLogger(__name__)

mcp_server = FastMCP(
    name="APIWeave",
    stateless_http=True,
    json_response=True,
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
    # Phase 2 tools — imported and registered when that phase is implemented
    # from app.mcp.tools.workflows import register_workflow_tools
    # register_workflow_tools(mcp_server)
    # from app.mcp.tools.environments import register_environment_tools
    # register_environment_tools(mcp_server)
    # from app.mcp.tools.collections import register_collection_tools
    # register_collection_tools(mcp_server)

    # Phase 3 tools
    # from app.mcp.tools.runs import register_run_tools
    # register_run_tools(mcp_server)

    # Phase 4 tools
    # from app.mcp.tools.imports import register_import_tools
    # register_import_tools(mcp_server)

    logger.info("MCP tools registered (placeholder — Phase 2+ tools pending)")
