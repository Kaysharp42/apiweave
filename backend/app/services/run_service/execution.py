"""
Run service (execution) — executor lifecycle and node-id helpers.
"""

import asyncio
import logging
from typing import Any

from app.runner.executor import RunContext, WorkflowExecutor

logger = logging.getLogger(__name__)

VALID_RESUME_MODES = {"single", "all-failed"}

_active_executors: dict[str, WorkflowExecutor] = {}
_active_cancel_events: dict[str, asyncio.Event] = {}


def _register_executor(
    run_id: str,
    executor: WorkflowExecutor,
    cancel_event: asyncio.Event,
) -> None:
    _active_executors[run_id] = executor
    _active_cancel_events[run_id] = cancel_event


def _unregister_executor(run_id: str) -> None:
    _active_executors.pop(run_id, None)
    _active_cancel_events.pop(run_id, None)


def _get_executor(run_id: str) -> WorkflowExecutor | None:
    return _active_executors.get(run_id)


def _get_cancel_event(run_id: str) -> asyncio.Event | None:
    return _active_cancel_events.get(run_id)


async def _execute_workflow_background(
    run_id: str,
    workflow_id: str,
    start_node_ids: list[str] | None,
    resume_from_run_id: str | None,
    cancel_event: asyncio.Event,
    run_context: RunContext | None = None,
) -> None:
    """Run the workflow executor as a background task."""
    executor = WorkflowExecutor(
        run_id,
        workflow_id,
        start_node_ids=start_node_ids,
        resume_from_run_id=resume_from_run_id,
        cancel_event=cancel_event,
        run_context=run_context,
    )
    _register_executor(run_id, executor, cancel_event)
    try:
        await executor.execute()
    except Exception:
        logger.exception("Background workflow execution failed for run %s", run_id)
    finally:
        _unregister_executor(run_id)


def _node_id(node: Any) -> str | None:
    if isinstance(node, dict):
        return node.get("nodeId")
    return getattr(node, "nodeId", None)


def _node_label(node: Any, fallback: str) -> str:
    if isinstance(node, dict):
        return node.get("label", fallback)
    return getattr(node, "label", fallback)


def _node_type(node: Any) -> str | None:
    if isinstance(node, dict):
        return node.get("type")
    return getattr(node, "type", None)


def _derive_failed_node_ids(run: Any) -> list[str]:
    """Resolve failed node IDs from failedNodes, or fallback to nodeStatuses error states."""
    explicit_failed = list(getattr(run, "failedNodes", None) or [])
    explicit_failed = [nid for nid in explicit_failed if isinstance(nid, str) and nid]
    if explicit_failed:
        return explicit_failed

    node_statuses = getattr(run, "nodeStatuses", None) or {}
    if not isinstance(node_statuses, dict):
        return []

    error_like = {"error", "failed", "client_error", "server_error"}
    ordered = sorted(
        node_statuses.items(),
        key=lambda item: (item[1] or {}).get("timestamp") or "",
    )
    return [
        nid
        for nid, status_meta in ordered
        if isinstance(nid, str) and ((status_meta or {}).get("status") in error_like)
    ]
