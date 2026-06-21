"""
Task 15 QA: Run actor test.

Scenario: Workspace owns run while actor is service token.
- Trigger run with workspace_id and actor (service_token).
- Verify run.workspaceId is set.
- Verify run.actorType == "service_token".
- Verify audit event recorded with correct actor.
- Verify run metadata response includes workspace and actor fields.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.models import RunActorContext
from app.services import run_service


class FakeRun:
    """Fake Run document that captures insert/save calls."""

    inserted: dict[str, Any] = {}
    saved_updates: list[dict[str, Any]] = []

    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)
        self.auditEventIds: list[str] = getattr(self, "auditEventIds", [])

    async def insert(self) -> None:
        FakeRun.inserted = dict(self.__dict__)

    async def save(self) -> None:
        FakeRun.saved_updates.append(dict(self.__dict__))


def _patch_background_task(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_create_task(coro: Any) -> None:
        coro.close()

    monkeypatch.setattr(run_service.asyncio, "create_task", fake_create_task)


@pytest.mark.asyncio
async def test_workspace_owns_run_while_actor_is_service_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run must have workspaceId set and actorType='service_token' when triggered by token."""

    class FakeWorkflowRepository:
        @staticmethod
        async def get_by_id(workflow_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                workflowId=workflow_id,
                variables={"baseUrl": "https://api.example.test"},
                nodes=[SimpleNamespace(nodeId="start_1")],
                workspaceId="ws-abc",
                orgId="org-1",
                ownerType="organization",
            )

    class FakeScopedEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                environmentId=env_id,
                scopeType="workspace",
                scopeId="ws-abc",
            )

    class FakeEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace | None:
            return None

    class FakeWorkspaceRepository:
        @staticmethod
        async def get_member(workspace_id: str, user_id: str) -> None:
            return None

    fake_audit_event = MagicMock()
    fake_audit_event.eventId = "evt-audit-001"

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            return fake_audit_event

    class FakeScopedPermissionEvaluator:
        @staticmethod
        def evaluate(**kwargs: Any) -> set:
            return {"workflows:run"}

        @staticmethod
        def has_permission(perms: set, perm: str) -> bool:
            return True

    FakeRun.inserted = {}
    FakeRun.saved_updates = []
    monkeypatch.setattr(run_service, "WorkflowRepository", FakeWorkflowRepository)
    monkeypatch.setattr(run_service, "ScopedEnvironmentRepository", FakeScopedEnvironmentRepository)
    monkeypatch.setattr(run_service, "EnvironmentRepository", FakeEnvironmentRepository)
    monkeypatch.setattr(run_service, "WorkspaceRepository", FakeWorkspaceRepository)
    monkeypatch.setattr(run_service, "audit_service", FakeAuditService)
    monkeypatch.setattr(run_service, "ScopedPermissionEvaluator", FakeScopedPermissionEvaluator)
    monkeypatch.setattr(run_service.models, "Run", FakeRun)
    _patch_background_task(monkeypatch)

    actor = RunActorContext(actorType="service_token", actorId="token-xyz")
    result = await run_service.trigger_workflow_run(
        "wf-1",
        environment_id="env-1",
        workspace_id="ws-abc",
        actor=actor,
    )

    # Workspace ownership
    assert FakeRun.inserted["workspaceId"] == "ws-abc"
    assert FakeRun.inserted["orgId"] == "org-1"
    assert FakeRun.inserted["ownerType"] == "organization"

    # Actor is service_token (NOT workspace owner)
    assert FakeRun.inserted["actorType"] == "service_token"
    assert FakeRun.inserted["actorId"] == "token-xyz"

    # Response includes workspace and actor
    assert result["workspaceId"] == "ws-abc"
    assert result["actorType"] == "service_token"
    assert result["actorId"] == "token-xyz"

    # Audit event was recorded
    assert "evt-audit-001" in FakeRun.inserted.get("auditEventIds", [])


@pytest.mark.asyncio
async def test_run_actor_type_literal_validation() -> None:
    """RunActorContext must only accept valid actor types."""
    valid_types = ["user", "service_token", "webhook_token", "system"]
    for actor_type in valid_types:
        ctx = RunActorContext(actorType=actor_type, actorId="id-1")  # type: ignore[arg-type]
        assert ctx.actorType == actor_type

    with pytest.raises(Exception):
        RunActorContext(actorType="invalid_actor", actorId="id-1")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_run_without_actor_still_works(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Legacy calls without actor/workspace still create runs (backward compat)."""

    class FakeWorkflowRepository:
        @staticmethod
        async def get_by_id(workflow_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                workflowId=workflow_id,
                variables={},
                nodes=[SimpleNamespace(nodeId="start_1")],
                workspaceId=None,
                orgId=None,
                ownerType=None,
            )

    class FakeEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace | None:
            return SimpleNamespace(environmentId=env_id)

    class FakeScopedEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace | None:
            return None

    FakeRun.inserted = {}
    FakeRun.saved_updates = []
    monkeypatch.setattr(run_service, "WorkflowRepository", FakeWorkflowRepository)
    monkeypatch.setattr(run_service, "ScopedEnvironmentRepository", FakeScopedEnvironmentRepository)
    monkeypatch.setattr(run_service, "EnvironmentRepository", FakeEnvironmentRepository)
    monkeypatch.setattr(run_service.models, "Run", FakeRun)
    _patch_background_task(monkeypatch)

    result = await run_service.trigger_workflow_run("wf-1", environment_id="env-1")

    assert FakeRun.inserted["actorType"] is None
    assert FakeRun.inserted["actorId"] is None
    assert result["actorType"] is None


@pytest.mark.asyncio
async def test_run_with_user_actor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run triggered by a user must have actorType='user'."""

    class FakeWorkflowRepository:
        @staticmethod
        async def get_by_id(workflow_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                workflowId=workflow_id,
                variables={},
                nodes=[SimpleNamespace(nodeId="start_1")],
                workspaceId="ws-personal",
                orgId=None,
                ownerType="user",
            )

    class FakeScopedEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                environmentId=env_id,
                scopeType="workspace",
                scopeId="ws-personal",
            )

    class FakeEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace | None:
            return None

    class FakeWorkspaceRepository:
        @staticmethod
        async def get_member(workspace_id: str, user_id: str) -> SimpleNamespace:
            return SimpleNamespace(role="admin")

    fake_audit_event = MagicMock()
    fake_audit_event.eventId = "evt-user-001"

    class FakeAuditService:
        @staticmethod
        async def append_event(**kwargs: Any) -> MagicMock:
            return fake_audit_event

    class FakeScopedPermissionEvaluator:
        @staticmethod
        def evaluate(**kwargs: Any) -> set:
            return {"workflows:run"}

        @staticmethod
        def has_permission(perms: set, perm: str) -> bool:
            return True

    FakeRun.inserted = {}
    FakeRun.saved_updates = []
    monkeypatch.setattr(run_service, "WorkflowRepository", FakeWorkflowRepository)
    monkeypatch.setattr(run_service, "ScopedEnvironmentRepository", FakeScopedEnvironmentRepository)
    monkeypatch.setattr(run_service, "EnvironmentRepository", FakeEnvironmentRepository)
    monkeypatch.setattr(run_service, "WorkspaceRepository", FakeWorkspaceRepository)
    monkeypatch.setattr(run_service, "audit_service", FakeAuditService)
    monkeypatch.setattr(run_service, "ScopedPermissionEvaluator", FakeScopedPermissionEvaluator)
    monkeypatch.setattr(run_service.models, "Run", FakeRun)
    _patch_background_task(monkeypatch)

    actor = RunActorContext(actorType="user", actorId="user-123")
    result = await run_service.trigger_workflow_run(
        "wf-1",
        environment_id="env-1",
        workspace_id="ws-personal",
        actor=actor,
    )

    assert FakeRun.inserted["actorType"] == "user"
    assert FakeRun.inserted["actorId"] == "user-123"
    assert FakeRun.inserted["workspaceId"] == "ws-personal"
    assert result["actorType"] == "user"
