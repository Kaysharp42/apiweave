"""
MCP environment secret tools — config-gated, write-only secret management.
"""
import logging
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.config import settings
from app.mcp.database import ensure_mcp_database
from app.services.environment_service import (
    delete_environment_secret as svc_delete_secret,
)
from app.services.environment_service import (
    set_environment_secret as svc_set_secret,
)

logger = logging.getLogger(__name__)

_SECRET_WRITE_DISABLED = (
    "Persisted secret writes are disabled. Set MCP_ALLOW_SECRET_WRITES=true to enable."
)


async def environment_set_secret(
    environment_id: Annotated[str, Field(description="Environment ID to update.")],
    key: Annotated[str, Field(description="Secret key name.")],
    value: Annotated[str, Field(description="Secret value. This is write-only and never returned.")],
) -> dict[str, str]:
    """Set a persisted secret on an environment.

    WARNING: This tool is write-only. The value is stored but never echoed back.
    Requires MCP_ALLOW_SECRET_WRITES=true in server configuration.
    """
    if not settings.MCP_ALLOW_SECRET_WRITES:
        raise PermissionError(_SECRET_WRITE_DISABLED)

    await ensure_mcp_database()
    await svc_set_secret(environment_id, key, value)
    return {
        "message": f"Secret '{key}' set on environment {environment_id}",
        "environment_id": environment_id,
        "key": key,
        "note": "Value stored but not returned for security.",
    }


async def environment_delete_secret(
    environment_id: Annotated[str, Field(description="Environment ID to update.")],
    key: Annotated[str, Field(description="Secret key to delete.")],
) -> dict[str, str]:
    """Delete a persisted secret from an environment.

    Requires MCP_ALLOW_SECRET_WRITES=true in server configuration.
    """
    if not settings.MCP_ALLOW_SECRET_WRITES:
        raise PermissionError(_SECRET_WRITE_DISABLED)

    await ensure_mcp_database()
    await svc_delete_secret(environment_id, key)
    return {
        "message": f"Secret '{key}' deleted from environment {environment_id}",
        "environment_id": environment_id,
        "key": key,
    }


def register_secret_tools(server: FastMCP) -> None:
    """Register environment secret management tools."""
    server.tool(
        name="environment_set_secret",
        description=(
            "Set a persisted secret on an environment. Write-only — the value is stored "
            "but never returned. Requires MCP_ALLOW_SECRET_WRITES=true."
        ),
    )(environment_set_secret)

    server.tool(
        name="environment_delete_secret",
        description=(
            "Delete a persisted secret from an environment. "
            "Requires MCP_ALLOW_SECRET_WRITES=true."
        ),
    )(environment_delete_secret)

    logger.info("MCP environment secret tools registered")
