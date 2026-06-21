"""
Task 15 QA: Mid-run removal test.

Scenario: User removed mid-run does not leak secrets.
- Start a run as a user actor.
- Simulate user removal during run execution.
- Verify run continues (actorRemovedDuringRun=True).
- Verify audit event records the removal.
- Verify no secret values appear in audit context.
- Verify soft-deleted env while queued fails the run with audit.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from app.services import run_service

# ---------------------------------------------------------------------------
# Fake Run for testing
# ---------------------------------------------------------------------------


class FakeRunDoc:
    """Fake Run document for edge case tests."""

    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)
        if "auditEventIds" not in self.__dict__:
            self.auditEventIds: list[str] = []

    async def save(self) -> None:
        pass


# ---------------------------------------------------------------------------
# Mid-run removal tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_user_removed_mid_run_continues_without_leaking_secrets() -> None:
    """When a user is removed mid-run, the run continues but no new secrets are resolved."""
    run_doc = FakeRunDoc(
        runId="run-mid-001",
        workflowId="wf-1",
        workspaceId="ws-abc",
        orgId="org-1",
        ownerType="organization",
        actorType="user",
        actorId="user-removed",
        status="running",
        selectedEnvironmentId="env-1",
        environmentId="env-1",
        auditEventIds=[],
        actorRemovedDuringRun=False,
    )

    fake_audit_event = MagicMock()
    fake_audit_event.eventId = "evt-removal-001"

    captured_audit_context: dict[str, Any] = {}

    class FakeRunRepository:
        @staticmethod
        async def get_by_id(run_id: str) -> FakeRunDoc:
            return run_doc

        @staticmethod
        async def update_status(run_id: str, status: str, error: str | None = None) -> FakeRunDoc:
            run_doc.status = status
            if error:
                run_doc.error = error
            return run_doc

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            captured_audit_context.update(kwargs.get("context", {}))
            captured_audit_context["action"] = kwargs.get("action")
            captured_audit_context["actor"] = kwargs.get("actor")
            captured_audit_context["actor_id"] = kwargs.get("actor_id")
            captured_audit_context["scope"] = kwargs.get("scope")
            captured_audit_context["scope_id"] = kwargs.get("scope_id")
            return fake_audit_event

    with patch.object(run_service, "RunRepository", FakeRunRepository):
        with patch.object(run_service, "audit_service", FakeAuditService):
            result = await run_service.notify_actor_removed_during_run(
                run_id="run-mid-001",
                removed_user_id="user-removed",
                removed_by_user_id="admin-user",
            )

    # Run continues — policy is "run_continues_secrets_already_resolved"
    assert result["action"] == "recorded"
    assert result["policy"] == "run_continues_secrets_already_resolved"
    assert result["removedUserId"] == "user-removed"

    # Run document is marked
    assert run_doc.actorRemovedDuringRun is True

    # Audit event recorded
    assert captured_audit_context["action"] == "run.actor_removed_mid_run"
    assert captured_audit_context["actor"] == "user"
    assert captured_audit_context["actor_id"] == "admin-user"
    assert captured_audit_context["scope"] == "workspace"
    assert captured_audit_context["scope_id"] == "ws-abc"
    assert captured_audit_context["removedUserId"] == "user-removed"
    assert captured_audit_context["policy"] == "run_continues_secrets_already_resolved"

    # No secret values in audit context
    audit_text = str(captured_audit_context)
    for forbidden in ["secret_value", "password", "token_value", "api_key"]:
        assert forbidden not in audit_text

    # Audit event ID linked to run
    assert "evt-removal-001" in run_doc.auditEventIds


@pytest.mark.asyncio
async def test_user_removed_after_terminal_run_is_no_op() -> None:
    """If the run is already completed/failed, removal notification is a no-op."""
    run_doc = FakeRunDoc(
        runId="run-done-001",
        status="completed",
        workspaceId="ws-abc",
        actorType="user",
        actorId="user-done",
        auditEventIds=[],
        actorRemovedDuringRun=False,
    )

    class FakeRunRepository:
        @staticmethod
        async def get_by_id(run_id: str) -> FakeRunDoc:
            return run_doc

    audit_called = False

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            nonlocal audit_called
            audit_called = True
            return MagicMock(eventId="evt-should-not-happen")

    with patch.object(run_service, "RunRepository", FakeRunRepository):
        with patch.object(run_service, "audit_service", FakeAuditService):
            result = await run_service.notify_actor_removed_during_run(
                run_id="run-done-001",
                removed_user_id="user-done",
                removed_by_user_id="admin-user",
            )

    assert result["action"] == "no_op"
    assert not audit_called
    assert run_doc.actorRemovedDuringRun is False


@pytest.mark.asyncio
async def test_mid_run_removal_audit_failure_does_not_crash_run() -> None:
    """If audit write fails during mid-run removal notification, the run still continues."""
    run_doc = FakeRunDoc(
        runId="run-audit-fail-001",
        workspaceId="ws-abc",
        actorType="user",
        actorId="user-x",
        status="running",
        auditEventIds=[],
        actorRemovedDuringRun=False,
    )

    class FakeRunRepository:
        @staticmethod
        async def get_by_id(run_id: str) -> FakeRunDoc:
            return run_doc

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            raise Exception("Audit DB unavailable")

    with patch.object(run_service, "RunRepository", FakeRunRepository):
        with patch.object(run_service, "audit_service", FakeAuditService):
            result = await run_service.notify_actor_removed_during_run(
                run_id="run-audit-fail-001",
                removed_user_id="user-x",
                removed_by_user_id="admin",
            )

    # Run still marked as actor removed
    assert run_doc.actorRemovedDuringRun is True
    assert result["action"] == "recorded"


# ---------------------------------------------------------------------------
# Soft-deleted env while queued tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_soft_deleted_env_fails_queued_run() -> None:
    """When environment is deleted while run is queued, run fails with audit."""
    run_doc = FakeRunDoc(
        runId="run-env-del-001",
        workflowId="wf-1",
        workspaceId="ws-abc",
        actorType="user",
        actorId="user-1",
        status="pending",
        selectedEnvironmentId="env-deleted",
        environmentId="env-deleted",
        auditEventIds=[],
    )

    fake_audit_event = MagicMock()
    fake_audit_event.eventId = "evt-env-del-001"

    captured_audit: dict[str, Any] = {}

    class FakeRunRepository:
        @staticmethod
        async def get_by_id(run_id: str) -> FakeRunDoc:
            return run_doc

        @staticmethod
        async def update_status(run_id: str, status: str, error: str | None = None) -> FakeRunDoc:
            run_doc.status = status
            if error:
                run_doc.error = error
            return run_doc

    class FakeScopedEnvRepo:
        @staticmethod
        async def get_by_id(env_id: str) -> None:
            return None  # Environment deleted

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            captured_audit.update(kwargs.get("context", {}))
            captured_audit["action"] = kwargs.get("action")
            return fake_audit_event

    with patch.object(run_service, "RunRepository", FakeRunRepository):
        with patch.object(run_service, "ScopedEnvironmentRepository", FakeScopedEnvRepo):
            with patch.object(run_service, "audit_service", FakeAuditService):
                result = await run_service.check_and_handle_deleted_env("run-env-del-001")

    assert result["action"] == "failed"
    assert result["reason"] == "environment_deleted_while_queued"
    assert result["environmentId"] == "env-deleted"
    assert run_doc.status == "failed"
    assert "deleted" in (run_doc.error or "").lower()

    # Audit recorded
    assert captured_audit["action"] == "run.failed.env_deleted"
    assert captured_audit["environmentId"] == "env-deleted"
    assert "evt-env-del-001" in run_doc.auditEventIds


@pytest.mark.asyncio
async def test_existing_env_does_not_fail_queued_run() -> None:
    """When environment still exists, queued run proceeds normally."""
    run_doc = FakeRunDoc(
        runId="run-env-ok-001",
        status="pending",
        selectedEnvironmentId="env-ok",
        environmentId="env-ok",
        workspaceId="ws-abc",
        auditEventIds=[],
    )

    class FakeRunRepository:
        @staticmethod
        async def get_by_id(run_id: str) -> FakeRunDoc:
            return run_doc

    class FakeScopedEnvRepo:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace:
            return SimpleNamespace(environmentId=env_id)

    audit_called = False

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            nonlocal audit_called
            audit_called = True
            return MagicMock(eventId="evt-nope")

    with patch.object(run_service, "RunRepository", FakeRunRepository):
        with patch.object(run_service, "ScopedEnvironmentRepository", FakeScopedEnvRepo):
            with patch.object(run_service, "audit_service", FakeAuditService):
                result = await run_service.check_and_handle_deleted_env("run-env-ok-001")

    assert result["action"] == "proceed"
    assert run_doc.status == "pending"
    assert not audit_called


@pytest.mark.asyncio
async def test_active_run_skips_env_check() -> None:
    """Running runs are not affected by env deletion check."""
    run_doc = FakeRunDoc(
        runId="run-active-001",
        status="running",
        selectedEnvironmentId="env-gone",
        workspaceId="ws-abc",
        auditEventIds=[],
    )

    class FakeRunRepository:
        @staticmethod
        async def get_by_id(run_id: str) -> FakeRunDoc:
            return run_doc

    with patch.object(run_service, "RunRepository", FakeRunRepository):
        result = await run_service.check_and_handle_deleted_env("run-active-001")

    assert result["action"] == "proceed"
    assert result["reason"] == "run already active"
