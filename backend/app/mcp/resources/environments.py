"""
MCP environment resources — read-only environment snapshots for agent context.
"""
import json
import logging
from typing import Any

from mcp.server.fastmcp import FastMCP

from app.mcp.database import ensure_mcp_database
from app.services.environment_service import get_environment, list_environments
from app.services.secret_utils import sanitize_secrets_in_dict

logger = logging.getLogger(__name__)


def _environment_to_dict(env: Any) -> dict:
    """Convert an environment document to a redacted dict."""
    data = {
        "environment_id": env.id,
        "name": env.name,
        "description": getattr(env, "description", None),
        "variables": getattr(env, "variables", {}) or {},
        "created_at": str(getattr(env, "createdAt", "")),
        "updated_at": str(getattr(env, "updatedAt", "")),
    }
    secret_refs: list[str] = []
    data["variables"] = sanitize_secrets_in_dict(
        data["variables"], secret_refs, "variables"
    )
    if secret_refs:
        data["redacted_secret_references"] = secret_refs
    return data


def register_environment_resources(server: FastMCP) -> None:
    """Register environment resources on the MCP server."""

    @server.resource("environment://{environment_id}")
    async def environment_resource(environment_id: str) -> str:
        """Read-only snapshot of an environment with secrets redacted."""
        await ensure_mcp_database()
        try:
            env = await get_environment(environment_id)
        except ValueError as exc:
            return json.dumps({"error": str(exc)})
        return json.dumps(_environment_to_dict(env), indent=2)

    @server.resource("environments://list")
    async def environments_list_resource() -> str:
        """List all environments as a read-only reference."""
        await ensure_mcp_database()
        envs = await list_environments()
        return json.dumps(
            [_environment_to_dict(env) for env in envs],
            indent=2,
        )

    logger.info("MCP environment resources registered")
