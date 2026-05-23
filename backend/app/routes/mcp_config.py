"""
MCP configuration endpoint for frontend UI.
"""
import logging
from fastapi import APIRouter

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


@router.get("/config")
async def get_mcp_config():
    """Return MCP server configuration for the frontend UI."""
    from app.mcp.server import mcp_server

    tools = []
    try:
        tool_list = mcp_server._tool_manager.list_tools()
        tools = [
            {"name": t.name, "description": t.description or ""}
            for t in tool_list
        ]
    except Exception:
        logger.debug("Could not list MCP tools", exc_info=True)

    resource_count = 0
    try:
        resource_count = len(mcp_server._resource_manager.list_resources())
    except Exception:
        logger.debug("Could not list MCP resources", exc_info=True)

    prompt_count = 0
    try:
        prompt_count = len(mcp_server._prompt_manager.list_prompts())
    except Exception:
        logger.debug("Could not list MCP prompts", exc_info=True)

    return {
        "enabled": settings.MCP_ENABLED,
        "httpEnabled": settings.MCP_HTTP_ENABLED,
        "baseUrl": settings.BASE_URL.rstrip("/"),
        "apiKeyConfigured": bool(settings.MCP_API_KEY),
        "toolCount": len(tools),
        "resourceCount": resource_count,
        "promptCount": prompt_count,
        "tools": tools,
    }
