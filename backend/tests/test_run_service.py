from datetime import UTC
from types import SimpleNamespace
from typing import Any

import pytest
from app.services import run_service


class FakeRun:
    inserted: dict[str, Any] = {}

    def __init__(self, **kwargs: Any) -> None:
        self.__dict__.update(kwargs)
        self.auditEventIds: list[str] = getattr(self, "auditEventIds", [])

    async def insert(self) -> None:
        FakeRun.inserted = dict(self.__dict__)

    async def save(self) -> None:
        pass


def _patch_background_task(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_create_task(coro: Any) -> None:
        coro.close()

    monkeypatch.setattr(run_service.asyncio, "create_task", fake_create_task)


@pytest.mark.asyncio
async def test_trigger_workflow_run_does_not_persist_or_return_runtime_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeWorkflowRepository:
        @staticmethod
        async def get_by_id(workflow_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                workflowId=workflow_id,
                variables={"baseUrl": "https://api.example.test"},
                nodes=[SimpleNamespace(nodeId="start")],
                workspaceId=None,
                orgId=None,
                ownerType=None,
            )

    class FakeScopedEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace | None:
            return None

    class FakeEnvironmentRepository:
        @staticmethod
        async def get_by_id(environment_id: str) -> SimpleNamespace:
            return SimpleNamespace(environmentId=environment_id)

    FakeRun.inserted = {}
    monkeypatch.setattr(run_service, "WorkflowRepository", FakeWorkflowRepository)
    monkeypatch.setattr(run_service, "ScopedEnvironmentRepository", FakeScopedEnvironmentRepository)
    monkeypatch.setattr(run_service, "EnvironmentRepository", FakeEnvironmentRepository)
    monkeypatch.setattr(run_service.models, "Run", FakeRun)
    _patch_background_task(monkeypatch)

    result = await run_service.trigger_workflow_run(
        "wf-1",
        environment_id="env-1",
    )

    assert result["workflowId"] == "wf-1"
    assert result["environmentId"] == "env-1"
    assert result["polling"]["tool"] == "run_get_status"
    assert FakeRun.inserted["variables"] == {"baseUrl": "https://api.example.test"}


@pytest.mark.asyncio
async def test_trigger_workflow_run_resolves_latest_failed_run_for_single_resume(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed_run = SimpleNamespace(
        runId="failed-1",
        workflowId="wf-1",
        failedNodes=["node-a", "node-b"],
        nodeStatuses={},
    )

    class FakeWorkflowRepository:
        @staticmethod
        async def get_by_id(workflow_id: str) -> SimpleNamespace:
            return SimpleNamespace(
                workflowId=workflow_id,
                variables={},
                nodes=[SimpleNamespace(nodeId="node-a"), SimpleNamespace(nodeId="node-b")],
                workspaceId=None,
                orgId=None,
                ownerType=None,
            )

    class FakeRunRepository:
        @staticmethod
        async def get_latest_failed_run(workflow_id: str) -> SimpleNamespace:
            assert workflow_id == "wf-1"
            return failed_run

        @staticmethod
        async def get_by_id(run_id: str) -> SimpleNamespace:
            assert run_id == "failed-1"
            return failed_run

    class FakeScopedEnvironmentRepository:
        @staticmethod
        async def get_by_id(env_id: str) -> SimpleNamespace | None:
            return None

    FakeRun.inserted = {}
    monkeypatch.setattr(run_service, "WorkflowRepository", FakeWorkflowRepository)
    monkeypatch.setattr(run_service, "RunRepository", FakeRunRepository)
    monkeypatch.setattr(run_service, "ScopedEnvironmentRepository", FakeScopedEnvironmentRepository)
    monkeypatch.setattr(run_service.models, "Run", FakeRun)
    _patch_background_task(monkeypatch)

    result = await run_service.trigger_workflow_run("wf-1", resume={"mode": "single"})

    assert result["resumeFromRunId"] == "failed-1"
    assert result["resumeMode"] == "single"
    assert result["startNodeIds"] == ["node-a"]
    assert FakeRun.inserted["resumeFromRunId"] == "failed-1"
    assert FakeRun.inserted["resumeFromNodeIds"] == ["node-a"]
    assert FakeRun.inserted["createdAt"].tzinfo is UTC
