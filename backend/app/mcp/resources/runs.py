"""
MCP run resources — read-only run snapshots for agent context.
"""
import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from app.mcp.database import ensure_mcp_database
from app.services.run_service import get_run

logger = logging.getLogger(__name__)


def _run_to_dict(run: Any) -> dict:
    """Convert a run document to a serializable dict."""
    data = run.model_dump(by_alias=True) if hasattr(run, "model_dump") else dict(run)
    data.pop("_id", None)
    data.pop("nodeResults", None)
    return data


def register_run_resources(server: FastMCP) -> None:
    """Register run resources on the MCP server."""

    @server.resource("run://{run_id}")
    async def run_resource(run_id: str) -> str:
        """Read-only snapshot of a workflow run status and metadata."""
        await ensure_mcp_database()
        try:
            run = await get_run(run_id)
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps(_run_to_dict(run), indent=2)

    logger.info("MCP run resources registered")
