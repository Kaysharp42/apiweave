"""
Run service (lifecycle) — run creation and cancellation.
"""

import logging

from app.models import Run, RunCreate
from app.repositories import RunRepository, WorkflowRepository
from app.services.exceptions import ConflictError

logger = logging.getLogger(__name__)


async def create_run(run_request: RunCreate) -> Run:
    """Create a run, merging workflow variables."""
    workflow = await WorkflowRepository.get_by_id(run_request.workflowId)
    if not workflow:
        raise ValueError(f"Workflow {run_request.workflowId} not found")

    variables = workflow.variables.copy()
    if run_request.variables:
        variables.update(run_request.variables)
    run_request.variables = variables

    return await RunRepository.create(run_request)


async def cancel_run(run_id: str) -> dict[str, str]:
    """Cancel a pending or running run.

    Raises ValueError if not found, ConflictError if invalid state.
    """
    from .execution import _get_cancel_event, _get_executor

    run = await RunRepository.get_by_id(run_id)
    if not run:
        raise ValueError(f"Run {run_id} not found")
    if run.status not in ("pending", "running"):
        raise ConflictError(f"Cannot cancel run with status {run.status}")

    cancel_event = _get_cancel_event(run_id)
    if cancel_event:
        cancel_event.set()
        executor = _get_executor(run_id)
        if executor:
            executor.cancel()
        logger.info("Signalled cancellation for running run %s", run_id)

    await RunRepository.update_status(run_id, "cancelled")
    return {"message": f"Run {run_id} cancelled", "runId": run_id, "status": "cancelled"}
