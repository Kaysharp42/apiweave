"""
Transport helpers for MCP stdio and Streamable HTTP.

Stdio transport supports local service-token configuration for authentication
when running the MCP server as a local subprocess. The token's scope is
propagated to MCP tool functions via scope_context contextvars.
"""

import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from mcp.server.fastmcp import FastMCP

from app.mcp.scope_context import McpScopeContext, set_scope

logger = logging.getLogger(__name__)

MCP_STDIO_TOKEN_ENV = "APIWEAVE_MCP_TOKEN"


def get_stdio_service_token() -> str | None:
    """
    Retrieve the local service token from environment for stdio transport.

    The token is passed via the APIWEAVE_MCP_TOKEN environment variable
    when launching the MCP server as a local subprocess.
    """
    return os.environ.get(MCP_STDIO_TOKEN_ENV)


async def validate_stdio_token(raw_token: str) -> bool:
    """
    Validate a service token for stdio transport and set scope context.

    Returns True if the token is valid (not revoked/expired).
    On success, sets the McpScopeContext for downstream tool authorization.
    """
    from app.services import service_token_service

    token = await service_token_service.validate_token(raw_token)
    if token is None:
        return False

    # Set scope context for all subsequent MCP tool calls in this process
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id=token.tokenId,
            scope_type=token.scopeType,
            scope_id=token.scopeId,
            permissions=list(token.permissions),
        )
    )
    return True


async def run_stdio(server: FastMCP) -> None:
    """
    Run the MCP server over stdio transport.

    If APIWEAVE_MCP_TOKEN is set, validates it on startup and sets the
    scope context for all subsequent tool calls. The token's scope
    (workspace/organization) determines which resources are accessible.
    """
    from mcp.server.stdio import stdio_server

    local_token = get_stdio_service_token()
    if local_token:
        is_valid = await validate_stdio_token(local_token)
        if not is_valid:
            logger.error(
                "MCP stdio: invalid or expired service token in %s",
                MCP_STDIO_TOKEN_ENV,
            )
            raise RuntimeError("Invalid MCP service token")
        logger.info("MCP stdio: authenticated with scoped service token")
    else:
        logger.warning(
            "MCP stdio: no service token in %s. "
            "Scoped service token required for production use.",
            MCP_STDIO_TOKEN_ENV,
        )

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
    server.streamable_http_app()
    async with server.session_manager.run():
        try:
            yield
        finally:
            logger.info("MCP Streamable HTTP session ending")
