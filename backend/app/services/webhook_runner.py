"""
Webhook async runner service.

Provides an in-process asyncio.Queue-based runner that decouples webhook
HTTP responses from workflow/collection execution.  Route handlers call
``enqueue()`` which returns immediately with a run ID; a long-lived
background task drains the queue and dispatches to the executor.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Optional

from app.idempotency import get_idempotency_entry, store_idempotency_entry
from app.models import WebhookLog
from app.repositories import (
    CollectionRepository,
    CollectionRunRepository,
    RunRepository,
)
from app.services.secret_utils import mask_secrets_structural


# ---------------------------------------------------------------------------
# Public exceptions
# ---------------------------------------------------------------------------

class QueueFull(Exception):
    """Raised when the webhook delivery queue has reached capacity.

    Route handlers should map this to HTTP 503.
    """


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WebhookDelivery:
    """Immutable description of a webhook-triggered execution."""

    webhook_id: str
    resource_type: str  # "workflow" | "collection"
    resource_id: str
    environment_id: str
    payload: dict[str, Any]
    idempotency_key: Optional[str] = None
    webhook_log_id: str = ""


@dataclass(frozen=True)
class _QueueItem:
    """Internal pairing of a delivery with its persisted run identifier."""

    delivery: WebhookDelivery
    run_id: str  # runId for workflows, collectionRunId for collections
    triggered_at: datetime


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

_QUEUE_MAXSIZE = 1000

logger = logging.getLogger(__name__)


class WebhookRunner:
    """Async queue-based runner for webhook-triggered executions.

    Lifecycle
    ---------
    1. ``start()`` is called once during application lifespan startup.
    2. Route handlers call ``await enqueue(delivery)`` which persists a Run
       (or CollectionRun), records idempotency, and pushes a ``_QueueItem``
       onto the internal queue.
    3. The background ``_consume()`` loop drains the queue and dispatches
       each item to the appropriate executor.
    4. ``stop()`` cancels the background task during shutdown.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[_QueueItem] = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
        self._task: Optional[asyncio.Task[None]] = None
        self.logger = logging.getLogger(f"{__name__}.WebhookRunner")

    # -- public API ---------------------------------------------------------

    async def enqueue(self, delivery: WebhookDelivery) -> str:
        """Persist a run, record idempotency, and queue for execution.

        Returns the ``runId`` (workflow) or ``collectionRunId`` (collection).

        Raises
        ------
        QueueFull
            If the internal queue has reached ``_QUEUE_MAXSIZE``.
        """
        # ── Idempotency dedup ────────────────────────────────────────────────
        if delivery.idempotency_key:
            existing = await get_idempotency_entry(
                delivery.webhook_id, delivery.idempotency_key
            )
            if existing is not None:
                self.logger.info(
                    "Idempotency hit for webhook=%s key=%s -> run=%s",
                    delivery.webhook_id,
                    delivery.idempotency_key,
                    existing.run_id,
                )
                return existing.run_id

        # ── Secret-mask the payload before storing on the Run ────────────────
        masked_payload = mask_secrets_structural(delivery.payload, [])

        # ── Persist run document ─────────────────────────────────────────────
        triggered_at = datetime.now(UTC)

        if delivery.resource_type == "workflow":
            run_id = f"run-{uuid.uuid4().hex[:12]}"
            await RunRepository.create_webhook_run(
                run_id=run_id,
                workflow_id=delivery.resource_id,
                environment_id=delivery.environment_id,
                variables=masked_payload,
            )
        elif delivery.resource_type == "collection":
            run_id = f"crun-{uuid.uuid4().hex[:12]}"
            collection = await CollectionRepository.get_by_id(delivery.resource_id)
            collection_name = collection.name if collection else delivery.resource_id
            enabled_count = (
                len([i for i in collection.workflowOrder if i.enabled])
                if collection
                else 0
            )
            await CollectionRunRepository.create(
                {
                    "collectionRunId": run_id,
                    "collectionId": delivery.resource_id,
                    "collectionName": collection_name,
                    "status": "pending",
                    "startTime": triggered_at,
                    "environmentId": delivery.environment_id,
                    "totalWorkflows": enabled_count,
                    "executedWorkflows": 0,
                    "passedWorkflows": 0,
                    "failedWorkflows": 0,
                    "workflowResults": [],
                    "webhookId": delivery.webhook_id,
                    "triggeredBy": "webhook",
                }
            )
        else:
            raise ValueError(f"Unknown resource_type: {delivery.resource_type}")

        # ── Store idempotency entry ──────────────────────────────────────────
        if delivery.idempotency_key:
            response_body: dict[str, Any] = {
                "status": "accepted",
            }
            if delivery.resource_type == "workflow":
                response_body["runId"] = run_id
                response_body["workflowId"] = delivery.resource_id
            else:
                response_body["collectionRunId"] = run_id
                response_body["collectionId"] = delivery.resource_id

            await store_idempotency_entry(
                webhook_id=delivery.webhook_id,
                idempotency_key=delivery.idempotency_key,
                run_id=run_id,
                collection_run_id=run_id if delivery.resource_type == "collection" else None,
                status_code=202,
                response_body=response_body,
            )

        # ── Enqueue ──────────────────────────────────────────────────────────
        item = _QueueItem(
            delivery=delivery,
            run_id=run_id,
            triggered_at=triggered_at,
        )
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            self.logger.warning(
                "Webhook queue full (%d/%d) — rejecting webhook=%s",
                self._queue.qsize(),
                _QUEUE_MAXSIZE,
                delivery.webhook_id,
            )
            raise QueueFull(
                f"Webhook queue is full ({_QUEUE_MAXSIZE}). Retry later."
            )

        self.logger.info(
            "Enqueued %s delivery webhook=%s run=%s (queue_depth=%d)",
            delivery.resource_type,
            delivery.webhook_id,
            run_id,
            self._queue.qsize(),
        )
        return run_id

    async def start(self) -> None:
        """Start the background consumer task."""
        if self._task is not None and not self._task.done():
            self.logger.warning("WebhookRunner already running")
            return
        self._task = asyncio.create_task(self._consume(), name="webhook-runner-consume")
        self.logger.info("WebhookRunner started")

    async def stop(self) -> None:
        """Cancel the background consumer task and wait for it to finish."""
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
            self.logger.info("WebhookRunner stopped")

    # -- internal -----------------------------------------------------------

    async def _consume(self) -> None:
        """Long-running loop that drains the queue and dispatches executions."""
        self.logger.info("Consumer loop started")
        while True:
            item = await self._queue.get()
            try:
                await self._dispatch(item)
            except Exception:
                self.logger.exception(
                    "Unhandled error dispatching run=%s webhook=%s",
                    item.run_id,
                    item.delivery.webhook_id,
                )
            finally:
                self._queue.task_done()

    async def _dispatch(self, item: _QueueItem) -> None:
        """Route a queue item to the correct executor."""
        delivery = item.delivery

        if delivery.resource_type == "workflow":
            await self._dispatch_workflow(item)
        elif delivery.resource_type == "collection":
            await self._dispatch_collection(item)
        else:
            self.logger.error("Unknown resource_type=%s for run=%s", delivery.resource_type, item.run_id)

    async def _dispatch_workflow(self, item: _QueueItem) -> None:
        """Execute a single workflow run."""
        from app.runner.executor import WorkflowExecutor
        from app.routes.webhooks import _run_workflow_and_update_webhook

        executor = WorkflowExecutor(
            run_id=item.run_id,
            workflow_id=item.delivery.resource_id,
        )

        # Fetch the pre-created WebhookLog so the helper can update it
        log_doc = await WebhookLog.find_one(
            WebhookLog.logId == item.delivery.webhook_log_id
        )
        if log_doc is None:
            self.logger.warning(
                "WebhookLog %s not found for run=%s; creating minimal stub",
                item.delivery.webhook_log_id,
                item.run_id,
            )
            log_doc = WebhookLog(
                logId=item.delivery.webhook_log_id or f"log-{uuid.uuid4().hex[:12]}",
                webhookId=item.delivery.webhook_id,
                timestamp=item.triggered_at,
                status="success",
                duration=0,
                httpMethod="POST",
                responseStatus=202,
            )

        await _run_workflow_and_update_webhook(
            executor=executor,
            webhook_id=item.delivery.webhook_id,
            log_doc=log_doc,
            triggered_at=item.triggered_at,
        )

    async def _dispatch_collection(self, item: _QueueItem) -> None:
        """Execute a collection run."""
        from app.routes.webhooks import _run_collection_and_update_webhook

        await _run_collection_and_update_webhook(
            collection_run_id=item.run_id,
            webhook_id=item.delivery.webhook_id,
            log_id=item.delivery.webhook_log_id,
            payload=item.delivery.payload,
            triggered_at=item.triggered_at,
        )


# ---------------------------------------------------------------------------
# Module-level singleton — imported by app/main.py and route handlers
# ---------------------------------------------------------------------------

webhook_runner = WebhookRunner()
