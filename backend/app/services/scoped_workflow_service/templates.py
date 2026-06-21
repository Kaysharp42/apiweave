"""
Scoped Templates — get, add, replace, clear node templates for a scoped workflow.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from ._helpers import _verify_workspace_and_workflow


async def get_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Get node templates for a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    return {
        "workflowId": workflow_id,
        "templates": workflow.nodeTemplates or [],
    }


async def add_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
    templates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Add node templates to a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    existing = workflow.nodeTemplates or []
    updated = existing + templates
    workflow.nodeTemplates = updated
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return {
        "message": f"Added {len(templates)} template(s) to workflow",
        "workflowId": workflow_id,
        "totalTemplates": len(updated),
    }


async def replace_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
    templates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Replace all node templates for a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    workflow.nodeTemplates = templates
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return {
        "message": "Templates replaced successfully",
        "workflowId": workflow_id,
        "totalTemplates": len(templates),
    }


async def clear_scoped_templates(
    workspace_id: str,
    workflow_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Clear all node templates for a workflow scoped to workspace."""
    workflow = await _verify_workspace_and_workflow(workspace_id, workflow_id, actor_user_id)
    workflow.nodeTemplates = []
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return {
        "message": "Templates cleared successfully",
        "workflowId": workflow_id,
    }
