"""
Webhook execution helpers - runs workflow/collection webhooks and updates
the webhook log + usage records.

This module breaks the previous circular dependency where
``app.services.webhook_runner`` lazy-imported these helpers from
``app.routes.webhooks`` (which itself imports ``webhook_runner``). The
helpers are pure execution + bookkeeping logic, so they belong in the
services layer alongside ``webhook_runner``.
"""

import contextlib
import json
import uuid
from datetime import UTC, datetime
from typing import Literal

from app.models import Run, WebhookLog
from app.repositories import (
    CollectionRepository,
    CollectionRunRepository,
    RunRepository,
    WebhookRepository,
    WorkflowRepository,
)
from app.runner.executor import WorkflowExecutor


async def _run_workflow_and_update_webhook(
    executor: "WorkflowExecutor",
    webhook_id: str,
    log_doc: "WebhookLog",
    triggered_at: datetime,
) -> None:
    terminal_status: Literal["success", "failure"] = "failure"
    run_id: str | None = executor.run_id
    error_message: str | None = None

    try:
        await executor.execute()

        if executor.has_failures:
            terminal_status = "failure"
            error_message = executor.first_error_message
        else:
            terminal_status = "success"

    except Exception as exc:
        terminal_status = "failure"
        error_message = str(exc)

    finally:
        duration_ms = int((datetime.now(UTC) - triggered_at).total_seconds() * 1000)

        with contextlib.suppress(Exception):
            await WebhookRepository.update_usage(webhook_id, terminal_status)

        try:
            log_doc.status = terminal_status
            log_doc.duration = duration_ms
            log_doc.runId = run_id
            if error_message:
                log_doc.errorMessage = error_message
            await log_doc.save()
        except Exception:  # noqa: S110 - intentional best-effort cleanup
            pass


async def _run_collection_and_update_webhook(  # noqa: C901, PLR0912, PLR0915 - pre-existing complex webhook orchestration
    collection_run_id: str,
    webhook_id: str,
    log_id: str,
    payload: dict,
    triggered_at: datetime,
) -> None:
    terminal_status: Literal["success", "failure"] = "failure"
    collection_status = "failed"
    error_message: str | None = None

    try:
        collection_run = await CollectionRunRepository.get_by_id(collection_run_id)
        if not collection_run:
            raise RuntimeError(f"Collection run not found: {collection_run_id}")

        collection = await CollectionRepository.get_by_id(collection_run.collectionId)
        if not collection:
            raise RuntimeError(f"Collection not found: {collection_run.collectionId}")

        await CollectionRunRepository.update_fields(collection_run_id, status="running")

        ordered_items = sorted(
            (item for item in collection.workflowOrder if item.enabled),
            key=lambda item: item.order,
        )

        if not ordered_items:
            collection_status = "completed"
            terminal_status = "success"
            return

        saw_failure = False
        should_stop = False

        for item in ordered_items:
            workflow = await WorkflowRepository.get_by_id(item.workflowId)
            run_id = f"run-{uuid.uuid4().hex[:12]}"
            workflow_name = workflow.name if workflow else item.workflowId
            workflow_start = datetime.now(UTC)
            workflow_error: str | None = None
            passed = False
            workflow_status = "failed"

            if workflow:
                run = Run(
                    runId=run_id,
                    workflowId=item.workflowId,
                    environmentId=collection_run.environmentId,
                    status="pending",
                    trigger="webhook",
                    variables=payload if isinstance(payload, dict) else {},
                    results=[],
                    createdAt=workflow_start,
                )
                await run.insert()

                executor = WorkflowExecutor(run_id, item.workflowId)
                try:
                    await executor.execute()
                except Exception as exc:
                    workflow_error = str(exc)

                run_doc = await RunRepository.get_by_id(run_id)
                if run_doc:
                    workflow_status = run_doc.status
                    workflow_error = workflow_error or run_doc.error or run_doc.failureMessage

                passed = workflow_status == "completed" and not workflow_error
            else:
                workflow_error = f"Workflow not found: {item.workflowId}"

            if not passed:
                saw_failure = True
                if not error_message:
                    error_message = workflow_error or f"Workflow failed: {item.workflowId}"
                if not collection.continueOnFail and not item.continueOnFail:
                    should_stop = True

            workflow_duration = int((datetime.now(UTC) - workflow_start).total_seconds() * 1000)

            await CollectionRunRepository.add_workflow_result(
                collection_run_id,
                {
                    "order": item.order,
                    "workflowId": item.workflowId,
                    "workflowName": workflow_name,
                    "runId": run_id if workflow else None,
                    "status": workflow_status,
                    "passed": passed,
                    "duration": workflow_duration,
                    "error": workflow_error,
                },
            )

            if should_stop:
                break

        if should_stop:
            collection_status = "failed"
            terminal_status = "failure"
        elif saw_failure:
            collection_status = "completed_with_errors"
            terminal_status = "success"
        else:
            collection_status = "completed"
            terminal_status = "success"

    except Exception as exc:
        collection_status = "failed"
        terminal_status = "failure"
        error_message = str(exc)

    finally:
        end_time = datetime.now(UTC)
        duration_ms = int((end_time - triggered_at).total_seconds() * 1000)

        with contextlib.suppress(Exception):
            await CollectionRunRepository.complete(
                collection_run_id,
                collection_status,
                end_time,
                duration_ms,
            )

        with contextlib.suppress(Exception):
            await WebhookRepository.update_usage(webhook_id, terminal_status)

        try:
            log_doc = await WebhookLog.find_one(WebhookLog.logId == log_id)
            if log_doc:
                log_doc.status = terminal_status  # type: ignore[assignment]
                log_doc.duration = duration_ms
                log_doc.collectionRunId = collection_run_id
                log_doc.responseBody = json.dumps({"collectionRunStatus": collection_status})
                if error_message:
                    log_doc.errorMessage = error_message
                await log_doc.save()
        except Exception:  # noqa: S110 - intentional best-effort cleanup
            pass
