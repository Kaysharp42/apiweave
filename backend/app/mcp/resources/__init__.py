"""
MCP resources — read-only data snapshots for AI agents.
"""
from app.mcp.resources.environments import register_environment_resources
from app.mcp.resources.runs import register_run_resources
from app.mcp.resources.workflows import register_workflow_resources

__all__ = [
    "register_environment_resources",
    "register_run_resources",
    "register_workflow_resources",
]
