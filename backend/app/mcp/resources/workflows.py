"""
MCP workflow resources — read-only workflow snapshots for agent context.
"""

import json
import logging

from mcp.server.fastmcp import FastMCP

from app.mcp.database import ensure_mcp_database
from app.mcp.tools.workflows import _workflow_dict_to_detail as workflow_to_detail
from app.services.workflow_service import get_workflow

logger = logging.getLogger(__name__)


async def _get_workflow_content(workflow_id: str) -> str:
    """Fetch and serialize a workflow with secrets redacted."""
    await ensure_mcp_database()
    try:
        workflow = await get_workflow(workflow_id)
    except ValueError as exc:
        return json.dumps({"error": str(exc)})

    detail = workflow_to_detail(workflow)
    return json.dumps(detail.model_dump(mode="json"), indent=2)


def register_workflow_resources(server: FastMCP) -> None:
    """Register workflow resources on the MCP server."""

    @server.resource("workflow://{workflow_id}")
    async def workflow_resource(workflow_id: str) -> str:
        """Read-only snapshot of a workflow definition with secrets redacted."""
        return await _get_workflow_content(workflow_id)

    logger.info("MCP workflow resources registered")
