"""
Task 28 — Soft-deleted environment while run is queued.

Verifies that:
- A pending/queued run whose environment has been deleted is failed
- The failure is recorded with an audit event
- Active runs are not affected
- Runs without an environment proceed normally
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import run_service


def _make_pending_run(
    *,
    run_id: str = "run-queued-1",
    status: str = "pending",
    env_id: str = "env-deleted",
    workspace_id: str = "ws-1",
    actor_type: str = "user",
    actor_id: str = "user-1",
):
    run = MagicMock()
    run.runId = run_id
    run.status = status
    run.environmentId = env_id
    run.selectedEnvironmentId = env_id
    run.workspaceId = workspace_id
    run.actorType = actor_type
    run.actorId = actor_id
    run.auditEventIds = []
    run.save = AsyncMock()
    return run


class TestSoftDeletedEnvWhileQueued:
    """Environment deleted while a run is still pending/queued."""

    @pytest.mark.asyncio
    async def test_deleted_env_fails_pending_run(self):
        """Pending run with deleted env is failed with audit."""
        run = _make_pending_run()

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(run_service.RunRepository, "update_status", new_callable=AsyncMock) as mock_update,
            patch.object(
                run_service.ScopedEnvironmentRepository, "get_by_id", return_value=None,
            ),
            patch.object(run_service.audit_service, "append_event", new_callable=AsyncMock) as mock_audit,
        ):
            mock_audit.return_value = MagicMock(eventId="evt-del-1")

            result = await run_service.check_and_handle_deleted_env("run-queued-1")

        assert result["action"] == "failed"
        assert result["reason"] == "environment_deleted_while_queued"
        assert result["environmentId"] == "env-deleted"
        mock_update.assert_awaited_once()
        call_args = mock_update.call_args
        assert call_args.args[0] == "run-queued-1"
        assert call_args.args[1] == "failed"

    @pytest.mark.asyncio
    async def test_deleted_env_creates_audit_event(self):
        """Audit event records the env deletion reason."""
        run = _make_pending_run()

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(run_service.RunRepository, "update_status", new_callable=AsyncMock),
            patch.object(
                run_service.ScopedEnvironmentRepository, "get_by_id", return_value=None,
            ),
            patch.object(run_service.audit_service, "append_event", new_callable=AsyncMock) as mock_audit,
        ):
            mock_audit.return_value = MagicMock(eventId="evt-del-2")

            await run_service.check_and_handle_deleted_env("run-queued-1")

        mock_audit.assert_awaited_once()
        kwargs = mock_audit.call_args.kwargs
        assert kwargs["action"] == "run.failed.env_deleted"
        assert kwargs["scope"] == "workspace"
        assert kwargs["scope_id"] == "ws-1"
        ctx = kwargs["context"]
        assert ctx["environmentId"] == "env-deleted"
        assert ctx["reason"] == "environment_deleted_while_queued"

    @pytest.mark.asyncio
    async def test_existing_env_proceeds(self):
        """If the environment still exists, the run proceeds normally."""
        run = _make_pending_run()
        env_mock = MagicMock()

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(
                run_service.ScopedEnvironmentRepository, "get_by_id", return_value=env_mock,
            ),
        ):
            result = await run_service.check_and_handle_deleted_env("run-queued-1")

        assert result["action"] == "proceed"
        assert result["reason"] == "environment exists"

    @pytest.mark.asyncio
    async def test_active_run_proceeds(self):
        """Running/completed runs are not checked."""
        run = _make_pending_run(status="running")

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
        ):
            result = await run_service.check_and_handle_deleted_env("run-queued-1")

        assert result["action"] == "proceed"
        assert result["reason"] == "run already active"

    @pytest.mark.asyncio
    async def test_no_environment_selected_proceeds(self):
        """Runs without an environment proceed normally."""
        run = _make_pending_run(env_id="")
        run.environmentId = None
        run.selectedEnvironmentId = None

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
        ):
            result = await run_service.check_and_handle_deleted_env("run-queued-1")

        assert result["action"] == "proceed"
        assert result["reason"] == "no environment selected"

    @pytest.mark.asyncio
    async def test_run_not_found_raises(self):
        """Non-existent run raises ResourceNotFoundError."""
        from app.services.exceptions import ResourceNotFoundError

        with patch.object(run_service.RunRepository, "get_by_id", return_value=None):
            with pytest.raises(ResourceNotFoundError):
                await run_service.check_and_handle_deleted_env("run-nonexistent")

    @pytest.mark.asyncio
    async def test_pending_approval_status_also_checked(self):
        """Runs in pending_approval status are also checked for deleted env."""
        run = _make_pending_run(status="pending_approval")

        with (
            patch.object(run_service.RunRepository, "get_by_id", return_value=run),
            patch.object(run_service.RunRepository, "update_status", new_callable=AsyncMock),
            patch.object(
                run_service.ScopedEnvironmentRepository, "get_by_id", return_value=None,
            ),
            patch.object(run_service.audit_service, "append_event", new_callable=AsyncMock) as mock_audit,
        ):
            mock_audit.return_value = MagicMock(eventId="evt-gate-1")

            result = await run_service.check_and_handle_deleted_env("run-queued-1")

        assert result["action"] == "failed"
