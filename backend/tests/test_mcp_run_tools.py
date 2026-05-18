from collections.abc import Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.mcp.tools import runs as run_tools


async def _noop_database() -> None:
    return None


@pytest.mark.asyncio
async def test_workflow_run_returns_polling_hint_without_secret_echo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_trigger_workflow_run(
        workflow_id: str,
        environment_id: str | None = None,
        runtime_secrets: dict[str, str] | None = None,
        resume: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        assert workflow_id == "wf-1"
        assert environment_id == "env-1"
        assert runtime_secrets == {"API_KEY": "super-secret-value"}
        assert resume is None
        return {
            "message": "Workflow run triggered",
            "runId": "run-1",
            "workflowId": workflow_id,
            "environmentId": environment_id,
            "resumeMode": None,
            "resumeFromRunId": None,
            "startNodeIds": None,
            "status": "pending",
            "runtimeSecretCount": 1,
            "polling": {
                "tool": "run_get_status",
                "recommendedIntervalSeconds": 1,
                "instructions": "Poll with run_get_status.",
                "terminalStatuses": ["completed", "failed", "cancelled"],
            },
        }

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_trigger_workflow_run", fake_trigger_workflow_run)

    response = await run_tools.workflow_run(
        "wf-1",
        environment_id="env-1",
        runtime_secrets={"API_KEY": "super-secret-value"},
    )

    response_json = response.model_dump_json()
    assert response.run_id == "run-1"
    assert response.runtime_secret_count == 1
    assert response.polling_hint.tool == "run_get_status"
    assert "super-secret-value" not in response_json


@pytest.mark.asyncio
async def test_run_get_status_omits_full_node_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_get_run(run_id: str) -> SimpleNamespace:
        assert run_id == "run-1"
        return SimpleNamespace(
            runId=run_id,
            workflowId="wf-1",
            status="running",
            trigger="manual",
            environmentId=None,
            resumeFromRunId=None,
            resumeFromNodeIds=None,
            resumeMode=None,
            createdAt=datetime.now(UTC),
            startedAt=None,
            completedAt=None,
            duration=None,
            error=None,
            failureMessage=None,
            failedNodes=[],
            nodeStatuses={
                "node-1": {
                    "status": "success",
                    "timestamp": "2026-05-18T00:00:00Z",
                    "result": {"token": "should-not-appear"},
                }
            },
        )

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_get_run", fake_get_run)

    response = await run_tools.run_get_status("wf-1", "run-1")

    response_json = response.model_dump_json()
    assert response.node_statuses[0].node_id == "node-1"
    assert response.node_statuses[0].status == "success"
    assert response.node_counts == {"success": 1}
    assert "should-not-appear" not in response_json


@pytest.mark.asyncio
async def test_run_get_results_returns_payload_free_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get_run_results(run_id: str) -> dict[str, Any]:
        assert run_id == "run-1"
        return {
            "runId": run_id,
            "workflowId": "wf-1",
            "workflowName": "Workflow",
            "status": "PASSED",
            "trigger": "manual",
            "summary": {"totalNodes": 1, "passed": 1, "failed": 0},
            "timing": {},
            "environment": None,
            "error": None,
            "failedNodes": [],
            "failureMessage": None,
            "nodeResults": [
                {
                    "nodeId": "node-1",
                    "nodeType": "http-request",
                    "status": "PASSED",
                    "duration": "25ms",
                    "durationSeconds": 0.03,
                    "request": {"headers": {"Authorization": "Bearer should-not-appear"}},
                    "response": {"body": {"token": "should-not-appear"}},
                    "assertions": [{"passed": True}],
                }
            ],
        }

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_get_run_results", fake_get_run_results)

    response = await run_tools.run_get_results("wf-1", "run-1")

    response_json = response.model_dump_json()
    assert response.node_results[0].has_request is True
    assert response.node_results[0].has_response is True
    assert response.node_results[0].assertion_count == 1
    assert response.detail_tool == "run_get_node_result"
    assert "should-not-appear" not in response_json


@pytest.mark.asyncio
async def test_run_get_node_result_redacts_secret_like_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_get_node_result(run_id: str, workflow_id: str, node_id: str) -> dict[str, Any]:
        assert (run_id, workflow_id, node_id) == ("run-1", "wf-1", "node-1")
        return {
            "nodeId": node_id,
            "runId": run_id,
            "status": "success",
            "timestamp": "2026-05-18T00:00:00Z",
            "result": {
                "request": {"headers": {"Authorization": "Bearer super-secret-value"}},
                "response": {"body": {"access_token": "abc123", "safe": "ok"}},
            },
            "metadata": {"stored_in_gridfs": False},
        }

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_get_node_result", fake_get_node_result)

    response = await run_tools.run_get_node_result("wf-1", "run-1", "node-1")

    response_json = response.model_dump_json()
    assert response.result["response"]["body"]["safe"] == "ok"
    assert "super-secret-value" not in response_json
    assert "abc123" not in response_json
    assert response.redacted_secret_references == [
        "result.request.headers.Authorization",
        "result.response.body.access_token",
    ]


@pytest.mark.asyncio
async def test_run_latest_failed_maps_failed_node_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created_at = datetime.now(UTC)

    async def fake_latest_failed(workflow_id: str) -> dict[str, Any]:
        assert workflow_id == "wf-1"
        return {
            "hasFailedRun": True,
            "workflowId": workflow_id,
            "runId": "run-1",
            "failedNodes": [
                {
                    "nodeId": "node-1",
                    "label": "Request",
                    "type": "http-request",
                    "status": "error",
                    "timestamp": "2026-05-18T00:00:00Z",
                }
            ],
            "failedNodeIds": ["node-1"],
            "failedCount": 1,
            "createdAt": created_at,
        }

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_get_latest_failed_run", fake_latest_failed)

    response = await run_tools.run_latest_failed("wf-1")

    assert response.has_failed_run is True
    assert response.run_id == "run-1"
    assert response.failed_nodes[0].node_id == "node-1"
    assert response.failed_count == 1
    assert response.created_at == created_at


def test_register_run_tools_registers_phase_3_tool_names() -> None:
    class FakeServer:
        def __init__(self) -> None:
            self.names: list[str] = []

        def tool(self, name: str, description: str) -> Callable[[Any], Any]:
            assert description
            self.names.append(name)

            def decorator(function: Any) -> Any:
                return function

            return decorator

    server = FakeServer()

    run_tools.register_run_tools(server)  # type: ignore[arg-type]

    assert server.names == [
        "workflow_run",
        "run_get_status",
        "run_get_results",
        "run_get_node_result",
        "run_latest_failed",
        "run_list",
        "run_cancel",
    ]


@pytest.mark.asyncio
async def test_run_cancel_returns_cancellation_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_cancel_run(run_id: str) -> dict[str, str]:
        assert run_id == "run-to-cancel"
        return {"message": f"Run {run_id} cancelled", "runId": run_id, "status": "cancelled"}

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_cancel_run", fake_cancel_run)

    response = await run_tools.run_cancel("run-to-cancel")

    assert response.message == "Run run-to-cancel cancelled"
    assert response.run_id == "run-to-cancel"
    assert response.status == "cancelled"


@pytest.mark.asyncio
async def test_run_cancel_raises_on_invalid_run(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_cancel_run(run_id: str) -> dict[str, str]:
        raise ValueError(f"Run {run_id} not found")

    monkeypatch.setattr(run_tools, "ensure_mcp_database", _noop_database)
    monkeypatch.setattr(run_tools, "svc_cancel_run", fake_cancel_run)

    with pytest.raises(ValueError, match="Run missing-run not found"):
        await run_tools.run_cancel("missing-run")
