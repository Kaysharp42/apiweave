"""
Transport helpers for MCP stdio and Streamable HTTP.
"""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP

logger = logging.getLogger(__name__)


async def run_stdio(server: FastMCP) -> None:
    """Run the MCP server over stdio transport."""
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server._mcp_server.run(
            read_stream,
            write_stream,
            server._mcp_server.create_initialization_options(),
        )


@asynccontextmanager
async def streamable_http_lifespan(server: FastMCP) -> AsyncGenerator[None, None]:
    """Context manager for Streamable HTTP session lifecycle."""
    logger.info("MCP Streamable HTTP session starting")
    # Initialize the Streamable HTTP app before starting the session manager
    server.streamable_http_app()
    async with server.session_manager.run():
        try:
            yield
        finally:
            logger.info("MCP Streamable HTTP session ending")
