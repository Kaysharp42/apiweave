"""
Tests for the webhook async runner service.

Covers:
- Enqueue creates a Run document and returns a run ID
- Idempotency dedup returns the same run ID without creating duplicates
- Queue-full condition raises QueueFull
- Secret masking is applied to the payload before storage
- Start/stop lifecycle of the consumer task
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from app.services.webhook_runner import (
    QueueFull,
    WebhookDelivery,
    WebhookRunner,
    webhook_runner,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_delivery(**overrides: object) -> WebhookDelivery:
    """Create a WebhookDelivery with sensible defaults, overridable."""
    defaults = dict(
        webhook_id="wh-test001",
        resource_type="workflow",
        resource_id="wf-abc123",
        environment_id="env-001",
        payload={"key": "value", "authorization": "Bearer super-secret"},
        idempotency_key=None,
        webhook_log_id="log-abc123",
    )
    defaults.update(overrides)
    return WebhookDelivery(**defaults)  # type: ignore[arg-type]


def _fresh_runner(maxsize: int = 1000) -> WebhookRunner:
    """Return a WebhookRunner with a custom queue size for testing."""
    runner = WebhookRunner()
    runner._queue = asyncio.Queue(maxsize=maxsize)
    return runner


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestEnqueueCreatesRun:
    """Verify that enqueue persists a Run document via the repository."""

    @pytest.mark.asyncio
    async def test_enqueue_creates_run(self) -> None:
        """enqueue() must call RunRepository.create_webhook_run exactly once."""
        runner = _fresh_runner()
        delivery = _make_delivery()

        with (
            patch(
                "app.services.webhook_runner.RunRepository.create_webhook_run",
                new_callable=AsyncMock,
            ) as mock_create,
            patch(
                "app.services.webhook_runner.get_idempotency_entry",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.webhook_runner.store_idempotency_entry",
                new_callable=AsyncMock,
            ),
        ):
            mock_create.return_value = SimpleNamespace(runId="run-test123")
            run_id = await runner.enqueue(delivery)

        assert run_id.startswith("run-")
        mock_create.assert_awaited_once()
        call_kwargs = mock_create.call_args.kwargs
        assert call_kwargs["workflow_id"] == "wf-abc123"
        assert call_kwargs["environment_id"] == "env-001"

    @pytest.mark.asyncio
    async def test_enqueue_returns_run_id(self) -> None:
        """enqueue() must return a non-empty run ID string."""
        runner = _fresh_runner()
        delivery = _make_delivery()

        with (
            patch(
                "app.services.webhook_runner.RunRepository.create_webhook_run",
                new_callable=AsyncMock,
            ),
            patch(
                "app.services.webhook_runner.get_idempotency_entry",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.webhook_runner.store_idempotency_entry",
                new_callable=AsyncMock,
            ),
        ):
            run_id = await runner.enqueue(delivery)

        assert isinstance(run_id, str)
        assert len(run_id) > 0
        assert run_id.startswith("run-")


class TestIdempotencyDedup:
    """Verify that duplicate idempotency keys return the original run ID."""

    @pytest.mark.asyncio
    async def test_idempotency_dedup(self) -> None:
        """Second enqueue with same key returns existing runId, no new Run."""
        runner = _fresh_runner()
        delivery = _make_delivery(idempotency_key="idem-key-001")

        existing_entry = SimpleNamespace(
            run_id="run-existing-999",
            collection_run_id=None,
        )

        with (
            patch(
                "app.services.webhook_runner.get_idempotency_entry",
                new_callable=AsyncMock,
                return_value=existing_entry,
            ),
            patch(
                "app.services.webhook_runner.RunRepository.create_webhook_run",
                new_callable=AsyncMock,
            ) as mock_create,
        ):
            run_id = await runner.enqueue(delivery)

        assert run_id == "run-existing-999"
        mock_create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_idempotency_miss_creates_new_run(self) -> None:
        """First call with a new idempotency key creates a fresh Run."""
        runner = _fresh_runner()
        delivery = _make_delivery(idempotency_key="idem-key-new")

        with (
            patch(
                "app.services.webhook_runner.get_idempotency_entry",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.webhook_runner.RunRepository.create_webhook_run",
                new_callable=AsyncMock,
            ) as mock_create,
            patch(
                "app.services.webhook_runner.store_idempotency_entry",
                new_callable=AsyncMock,
            ) as mock_store,
        ):
            run_id = await runner.enqueue(delivery)

        assert run_id.startswith("run-")
        mock_create.assert_awaited_once()
        mock_store.assert_awaited_once()
        store_kwargs = mock_store.call_args.kwargs
        assert store_kwargs["idempotency_key"] == "idem-key-new"


class TestQueueFullRaises:
    """Verify that a full queue raises QueueFull."""

    @pytest.mark.asyncio
    async def test_queue_full_raises(self) -> None:
        """When queue is at capacity, enqueue raises QueueFull."""
        runner = _fresh_runner(maxsize=2)
        delivery = _make_delivery()

        with (
            patch(
                "app.services.webhook_runner.RunRepository.create_webhook_run",
                new_callable=AsyncMock,
            ),
            patch(
                "app.services.webhook_runner.get_idempotency_entry",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.webhook_runner.store_idempotency_entry",
                new_callable=AsyncMock,
            ),
        ):
            # Fill the queue to capacity
            await runner.enqueue(delivery)
            await runner.enqueue(delivery)

            # Third enqueue should fail
            with pytest.raises(QueueFull, match="queue is full"):
                await runner.enqueue(delivery)


class TestSecretMaskingInPayload:
    """Verify that secrets in the payload are masked before storage."""

    @pytest.mark.asyncio
    async def test_secret_masking_in_payload(self) -> None:
        """Payload keys matching secret patterns are masked in Run.variables."""
        runner = _fresh_runner()
        delivery = _make_delivery(
            payload={
                "username": "alice",
                "authorization": "Bearer sk-live-abc123",
                "api_key": "super-secret-key",
                "data": {"nested_token": "tok_xyz"},
            }
        )

        captured_variables: dict = {}

        async def _capture_create(**kwargs: object) -> SimpleNamespace:
            captured_variables.update(kwargs.get("variables", {}))  # type: ignore[arg-type]
            return SimpleNamespace(runId="run-mask-test")

        with (
            patch(
                "app.services.webhook_runner.RunRepository.create_webhook_run",
                side_effect=_capture_create,
            ),
            patch(
                "app.services.webhook_runner.get_idempotency_entry",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.webhook_runner.store_idempotency_entry",
                new_callable=AsyncMock,
            ),
        ):
            await runner.enqueue(delivery)

        # Key-name based masking: "authorization" and "api_key" match SECRET_KEY_PATTERNS
        assert captured_variables["authorization"] == "<REDACTED>"
        assert captured_variables["api_key"] == "<REDACTED>"
        # Non-secret keys are preserved
        assert captured_variables["username"] == "alice"
        # Nested secret-key pattern
        assert captured_variables["data"]["nested_token"] == "<REDACTED>"


class TestStartStop:
    """Verify the lifecycle of the consumer task."""

    @pytest.mark.asyncio
    async def test_start_creates_task(self) -> None:
        """start() creates an asyncio task."""
        runner = _fresh_runner()
        assert runner._task is None
        await runner.start()
        assert runner._task is not None
        assert not runner._task.done()
        await runner.stop()

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self) -> None:
        """stop() cancels the asyncio task and waits for it."""
        runner = _fresh_runner()
        await runner.start()
        task = runner._task
        assert task is not None
        await runner.stop()
        assert runner._task is None
        assert task.cancelled() or task.done()

    @pytest.mark.asyncio
    async def test_start_idempotent(self) -> None:
        """Calling start() twice does not create a second task."""
        runner = _fresh_runner()
        await runner.start()
        task1 = runner._task
        await runner.start()
        task2 = runner._task
        assert task1 is task2
        await runner.stop()


class TestSingleton:
    """Verify the module-level singleton is importable."""

    def test_singleton_exists(self) -> None:
        """The module-level webhook_runner singleton is a WebhookRunner."""
        assert isinstance(webhook_runner, WebhookRunner)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
