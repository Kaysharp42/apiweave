"""
MCP prompts — pre-built templates for common APIWeave tasks.
"""
from app.mcp.prompts.debug import register_debug_prompts
from app.mcp.prompts.workflow import register_workflow_prompts

__all__ = [
    "register_debug_prompts",
    "register_workflow_prompts",
]
