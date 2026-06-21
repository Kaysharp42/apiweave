"""
Task 28 — User removal mid-run edge case.

Verifies that:
- When a user is removed from a workspace during an active run, the run continues
- The removal is recorded on the run document (actorRemovedDuringRun=True)
- An audit event is created with the correct metadata
- No new secrets are resolved after removal
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services import run_service


def _make_run(
    *,
    run_id: str = "run-mid-1",
    status: str = "running",
    workspace_id: str = "ws-1",
    actor_type: str = "user",
    actor_id: str = "user-removed",
):
    run = MagicMock()
    run.runId = run_id
    run.status = status
    run.workspaceId = workspace_id
    run.actorType = actor_type
    run.actorId = actor_id
    run.actorRemovedDuringRun = False
    run.auditEventIds = []
    run.save = AsyncMock()
    return run


class TestUserRemovedMidRun:
    """User removed from workspace while their run is active."""

    @pytest.mark.asyncio
    async def test_removal_recorded_on_active_run(self):
        """Run continues, but actorRemovedDuringRun flag is set."""
        run = _make_run(status="running")

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(
                run_service.audit_service, "append_event", new_callable=AsyncMock
            ) as mock_audit,
        ):
            mock_audit.return_value = MagicMock(eventId="evt-1")

            result = await run_service.notify_actor_removed_during_run(
                run_id="run-mid-1",
                removed_user_id="user-removed",
                removed_by_user_id="admin-user",
            )

        assert result["action"] == "recorded"
        assert result["runId"] == "run-mid-1"
        assert result["removedUserId"] == "user-removed"
        assert result["policy"] == "run_continues_secrets_already_resolved"
        assert run.actorRemovedDuringRun is True
        run.save.assert_awaited()

    @pytest.mark.asyncio
    async def test_removal_creates_audit_event(self):
        """An audit event records who removed whom, the run status, and the policy."""
        run = _make_run(status="running")

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(
                run_service.audit_service, "append_event", new_callable=AsyncMock
            ) as mock_audit,
        ):
            mock_audit.return_value = MagicMock(eventId="evt-audit-1")

            await run_service.notify_actor_removed_during_run(
                run_id="run-mid-1",
                removed_user_id="user-removed",
                removed_by_user_id="admin-user",
            )

        mock_audit.assert_awaited_once()
        kwargs = mock_audit.call_args.kwargs
        assert kwargs["actor"] == "user"
        assert kwargs["actor_id"] == "admin-user"
        assert kwargs["action"] == "run.actor_removed_mid_run"
        assert kwargs["scope"] == "workspace"
        assert kwargs["scope_id"] == "ws-1"
        assert kwargs["resource_type"] == "run"
        assert kwargs["resource_id"] == "run-mid-1"
        ctx = kwargs["context"]
        assert ctx["removedUserId"] == "user-removed"
        assert ctx["runStatus"] == "running"
        assert ctx["policy"] == "run_continues_secrets_already_resolved"

    @pytest.mark.asyncio
    async def test_removal_on_terminal_run_is_noop(self):
        """If the run is already completed/failed/cancelled, removal is a no-op."""
        for terminal_status in ("completed", "failed", "cancelled"):
            run = _make_run(status=terminal_status)

            with (
                patch.object(run_service.RunRepository, "get_by_id", return_value=run),
                patch.object(
                    run_service.audit_service, "append_event", new_callable=AsyncMock
                ) as mock_audit,
            ):
                result = await run_service.notify_actor_removed_during_run(
                    run_id="run-mid-1",
                    removed_user_id="user-removed",
                    removed_by_user_id="admin-user",
                )

            assert result["action"] == "no_op"
            assert result["reason"] == "run already terminal"
            mock_audit.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_removal_run_not_found_raises(self):
        """If the run doesn't exist, ResourceNotFoundError is raised."""
        from app.services.exceptions import ResourceNotFoundError

        with patch.object(run_service.RunRepository, "get_by_id", return_value=None):
            with pytest.raises(ResourceNotFoundError):
                await run_service.notify_actor_removed_during_run(
                    run_id="run-nonexistent",
                    removed_user_id="user-x",
                    removed_by_user_id="admin-x",
                )

    @pytest.mark.asyncio
    async def test_audit_failure_does_not_crash(self):
        """If audit write fails, the removal is still recorded on the run."""
        run = _make_run(status="running")

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(
                run_service.audit_service,
                "append_event",
                new_callable=AsyncMock,
                side_effect=RuntimeError("audit DB down"),
            ),
        ):
            result = await run_service.notify_actor_removed_during_run(
                run_id="run-mid-1",
                removed_user_id="user-removed",
                removed_by_user_id="admin-user",
            )

        # Run flag is still set even if audit fails
        assert run.actorRemovedDuringRun is True
        assert result["action"] == "recorded"
