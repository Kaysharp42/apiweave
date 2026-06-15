import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.models import Node, Session, User
from app.repositories.auth_repositories import SessionRepository, UserRepository

_SESSION_TOKEN = "test-resume-session-token"


def _make_session() -> Session:
    now = datetime.now(UTC)
    return Session.model_construct(
        sessionId="ses-resume-test",
        userId="resume-test-user",
        token_hash=hashlib.sha256(_SESSION_TOKEN.encode()).hexdigest(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=7),
        revoked=False,
    )


def _make_user() -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId="resume-test-user",
        verified_email="resume@example.com",
        display_name="Resume Test User",
        avatar_url=None,
        roles=["admin"],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _auth_patches():
    """Return context managers that mock a valid authenticated session."""
    session = _make_session()
    user = _make_user()
    return (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    )


client = TestClient(app)
client.cookies.set("session", _SESSION_TOKEN)
client.cookies.set("csrftoken", "resume-csrf-token")
client.headers.update({"X-CSRF-Token": "resume-csrf-token"})


WORKFLOW_ID = "fc87c260-e0b8-4b63-a762-47169f04f690"
ENV_ID = "10ab043b-f164-4745-8274-dbd1e8312a7a"


class _DummyRunInsert:
    def __init__(self, **kwargs):
        self.payload = kwargs

    async def insert(self):
        return None


def _close_scheduled_coroutine(coro):
    coro.close()
    return None


def _workflow_with_example_nodes():
    return SimpleNamespace(
        workflowId=WORKFLOW_ID,
        variables={"catID": "response.body.id"},
        nodes=[
            Node(
                nodeId="start-1", type="start", label="Start", position={"x": 0, "y": 0}, config={}
            ),
            Node(
                nodeId="http-request-1761432741713",
                type="http-request",
                label="Http Request  NB3",
                position={"x": 1, "y": 1},
                config={},
            ),
            Node(
                nodeId="http-request-1761477525560",
                type="http-request",
                label="Http Request NB4",
                position={"x": 2, "y": 2},
                config={},
            ),
            Node(
                nodeId="delay-1770749505484",
                type="delay",
                label="Delay",
                position={"x": 3, "y": 3},
                config={},
            ),
        ],
    )


def _run(run_id: str, status: str, failed_nodes=None, node_statuses=None):
    return SimpleNamespace(
        runId=run_id,
        workflowId=WORKFLOW_ID,
        status=status,
        failedNodes=failed_nodes,
        nodeStatuses=node_statuses or {},
        createdAt=datetime.now(UTC),
    )


def test_latest_failed_endpoint_returns_none_when_latest_run_is_success_even_if_older_failed_exists(
) -> None:
    workflow = _workflow_with_example_nodes()
    latest_success = _run("run-success", "completed")

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch("app.routes.workflows.RunRepository.get_latest_run", return_value=latest_success),
    ):
        response = client.get(f"/api/workflows/{WORKFLOW_ID}/runs/latest-failed")

    assert response.status_code == 200
    body = response.json()
    assert body["hasFailedRun"] is False
    assert body["failedNodes"] == []


def test_latest_failed_endpoint_uses_latest_failed_when_latest_run_failed():
    workflow = _workflow_with_example_nodes()
    latest_failed = _run(
        "run-failed-1",
        "failed",
        failed_nodes=["http-request-1761432741713"],
        node_statuses={
            "http-request-1761432741713": {"status": "error", "timestamp": "2026-02-22T10:00:00Z"}
        },
    )

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch("app.routes.workflows.RunRepository.get_latest_run", return_value=latest_failed),
    ):
        response = client.get(f"/api/workflows/{WORKFLOW_ID}/runs/latest-failed")

    assert response.status_code == 200
    body = response.json()
    assert body["hasFailedRun"] is True
    assert body["runId"] == "run-failed-1"
    assert body["failedCount"] == 1
    assert body["failedNodes"][0]["nodeId"] == "http-request-1761432741713"


def test_latest_failed_endpoint_falls_back_to_node_statuses_when_failed_nodes_missing():
    workflow = _workflow_with_example_nodes()
    latest_failed = _run(
        "run-failed-2",
        "failed",
        failed_nodes=None,
        node_statuses={
            "http-request-1761477525560": {"status": "error", "timestamp": "2026-02-22T10:00:01Z"},
            "http-request-1761432741713": {"status": "error", "timestamp": "2026-02-22T10:00:02Z"},
            "delay-1770749505484": {"status": "success", "timestamp": "2026-02-22T10:00:03Z"},
        },
    )

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch("app.routes.workflows.RunRepository.get_latest_run", return_value=latest_failed),
    ):
        response = client.get(f"/api/workflows/{WORKFLOW_ID}/runs/latest-failed")

    assert response.status_code == 200
    body = response.json()
    assert body["hasFailedRun"] is True
    assert body["failedNodeIds"] == [
        "http-request-1761477525560",
        "http-request-1761432741713",
    ]


def test_resume_run_accepts_workflow_nodes_as_pydantic_models_regression_for_node_get_error():
    workflow = _workflow_with_example_nodes()
    latest_failed = _run(
        "run-source",
        "failed",
        failed_nodes=["http-request-1761432741713", "http-request-1761477525560"],
    )

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch(
            "app.routes.workflows.EnvironmentRepository.get_by_id",
            return_value=SimpleNamespace(environmentId=ENV_ID),
        ),
        patch(
            "app.routes.workflows.RunRepository.get_latest_failed_run", return_value=latest_failed
        ),
        patch("app.routes.workflows.RunRepository.get_by_id", return_value=latest_failed),
        patch("app.models.Run", _DummyRunInsert),
        patch("app.routes.workflows.asyncio.create_task", side_effect=_close_scheduled_coroutine),
    ):
        response = client.post(
            f"/api/workflows/{WORKFLOW_ID}/run?environmentId={ENV_ID}",
            json={
                "resume": {
                    "mode": "all-failed",
                    "sourceRunId": "run-source",
                    "startNodeIds": [
                        "http-request-1761432741713",
                        "http-request-1761477525560",
                    ],
                }
            },
        )

    assert response.status_code == 202
    body = response.json()
    assert body["resumeMode"] == "all-failed"
    assert body["startNodeIds"] == [
        "http-request-1761432741713",
        "http-request-1761477525560",
    ]


def test_resume_run_uses_node_status_fallback_when_source_failed_nodes_empty():
    workflow = _workflow_with_example_nodes()
    source_run = _run(
        "run-source-2",
        "failed",
        failed_nodes=None,
        node_statuses={
            "http-request-1761432741713": {"status": "error", "timestamp": "2026-02-22T10:00:01Z"},
            "http-request-1761477525560": {"status": "error", "timestamp": "2026-02-22T10:00:02Z"},
        },
    )

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch(
            "app.routes.workflows.EnvironmentRepository.get_by_id",
            return_value=SimpleNamespace(environmentId=ENV_ID),
        ),
        patch("app.routes.workflows.RunRepository.get_latest_failed_run", return_value=source_run),
        patch("app.routes.workflows.RunRepository.get_by_id", return_value=source_run),
        patch("app.models.Run", _DummyRunInsert),
        patch("app.routes.workflows.asyncio.create_task", side_effect=_close_scheduled_coroutine),
    ):
        response = client.post(
            f"/api/workflows/{WORKFLOW_ID}/run?environmentId={ENV_ID}",
            json={
                "resume": {
                    "mode": "all-failed",
                    "sourceRunId": "run-source-2",
                }
            },
        )

    assert response.status_code == 202
    body = response.json()
    assert body["startNodeIds"] == [
        "http-request-1761432741713",
        "http-request-1761477525560",
    ]


def test_resume_run_returns_409_when_no_failed_run_exists_for_auto_resume():
    workflow = _workflow_with_example_nodes()

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch(
            "app.routes.workflows.EnvironmentRepository.get_by_id",
            return_value=SimpleNamespace(environmentId=ENV_ID),
        ),
        patch("app.routes.workflows.RunRepository.get_latest_failed_run", return_value=None),
    ):
        response = client.post(
            f"/api/workflows/{WORKFLOW_ID}/run?environmentId={ENV_ID}",
            json={"resume": {"mode": "single"}},
        )

    assert response.status_code == 409
    assert "No failed run found" in response.json()["detail"]


def test_resume_run_returns_400_for_invalid_resume_node_ids():
    workflow = _workflow_with_example_nodes()
    source_run = _run("run-source-3", "failed", failed_nodes=["http-request-1761432741713"])

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch(
            "app.routes.workflows.EnvironmentRepository.get_by_id",
            return_value=SimpleNamespace(environmentId=ENV_ID),
        ),
        patch("app.routes.workflows.RunRepository.get_by_id", return_value=source_run),
    ):
        response = client.post(
            f"/api/workflows/{WORKFLOW_ID}/run?environmentId={ENV_ID}",
            json={
                "resume": {
                    "mode": "all-failed",
                    "sourceRunId": "run-source-3",
                    "startNodeIds": ["does-not-exist"],
                }
            },
        )

    assert response.status_code == 400
    assert "Invalid resume node" in response.json()["detail"]


def test_resume_single_mode_trims_multiple_failed_nodes_to_first():
    workflow = _workflow_with_example_nodes()
    source_run = _run(
        "run-source-4",
        "failed",
        failed_nodes=["http-request-1761432741713", "http-request-1761477525560"],
    )

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch(
            "app.routes.workflows.EnvironmentRepository.get_by_id",
            return_value=SimpleNamespace(environmentId=ENV_ID),
        ),
        patch("app.routes.workflows.RunRepository.get_by_id", return_value=source_run),
        patch("app.models.Run", _DummyRunInsert),
        patch("app.routes.workflows.asyncio.create_task", side_effect=_close_scheduled_coroutine),
    ):
        response = client.post(
            f"/api/workflows/{WORKFLOW_ID}/run?environmentId={ENV_ID}",
            json={
                "resume": {
                    "mode": "single",
                    "sourceRunId": "run-source-4",
                    "startNodeIds": [
                        "http-request-1761432741713",
                        "http-request-1761477525560",
                    ],
                }
            },
        )

    assert response.status_code == 202
    assert response.json()["startNodeIds"] == ["http-request-1761432741713"]


def test_latest_failed_endpoint_follows_latest_run_transitions_failed_then_success():
    workflow = _workflow_with_example_nodes()
    latest_failed = _run(
        "run-failed-transition",
        "failed",
        failed_nodes=["http-request-1761432741713"],
        node_statuses={
            "http-request-1761432741713": {"status": "error", "timestamp": "2026-02-22T10:00:00Z"}
        },
    )
    latest_success = _run("run-success-transition", "completed")

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch("app.routes.workflows.WorkflowRepository.get_by_id", return_value=workflow),
        patch(
            "app.routes.workflows.RunRepository.get_latest_run",
            side_effect=[latest_failed, latest_success],
        ),
    ):
        first = client.get(f"/api/workflows/{WORKFLOW_ID}/runs/latest-failed")
        second = client.get(f"/api/workflows/{WORKFLOW_ID}/runs/latest-failed")

    assert first.status_code == 200
    assert first.json()["hasFailedRun"] is True
    assert second.status_code == 200
    assert second.json()["hasFailedRun"] is False


def test_fail_run_persists_variables_and_failed_nodes_for_followup_resume_attempts():
    from app.runner.executor import WorkflowExecutor

    executor = WorkflowExecutor("run-fail-persist", WORKFLOW_ID)
    executor.start_time = None
    executor.workflow_variables = {"catID": "abc123"}
    executor.failed_nodes = ["http-request-1761477525560"]

    with patch("app.runner.executor.RunRepository.update_fields", new=AsyncMock()) as update_fields:
        asyncio.run(executor._fail_run("boom"))

    update_fields.assert_awaited_once()
    _, kwargs = update_fields.await_args
    assert kwargs["status"] == "failed"
    assert kwargs["variables"] == {"catID": "abc123"}
    assert kwargs["failedNodes"] == ["http-request-1761477525560"]


# ---------------------------------------------------------------------------
# T23 — Lineage / resume-trace tests
# ---------------------------------------------------------------------------


def _three_node_workflow():
    """Workflow: start → http-1 → http-2 → http-3 → end."""
    return SimpleNamespace(
        workflowId=WORKFLOW_ID,
        variables={},
        nodes=[
            Node(
                nodeId="start-1",
                type="start",
                label="Start",
                position={"x": 0, "y": 0},
                config={},
            ),
            Node(
                nodeId="http-1",
                type="http-request",
                label="Get Token",
                position={"x": 1, "y": 0},
                config={},
            ),
            Node(
                nodeId="http-2",
                type="http-request",
                label="Use Token",
                position={"x": 2, "y": 0},
                config={},
            ),
            Node(
                nodeId="http-3",
                type="http-request",
                label="Cleanup",
                position={"x": 3, "y": 0},
                config={},
            ),
            Node(
                nodeId="end-1",
                type="end",
                label="End",
                position={"x": 4, "y": 0},
                config={},
            ),
        ],
    )


def test_resume_skips_first():
    """Workflow with 3 HTTP nodes, node 2 fails.

    Resume API must set startNodeIds to [http-2] — skipping http-1 which
    already succeeded.
    """
    workflow = _three_node_workflow()
    source_run = _run(
        "run-skip-first-src",
        "failed",
        failed_nodes=["http-2"],
        node_statuses={
            "http-1": {"status": "success", "timestamp": "2026-05-30T10:00:00Z"},
            "http-2": {"status": "error", "timestamp": "2026-05-30T10:00:01Z"},
        },
    )

    session_patch, touch_patch, user_patch = _auth_patches()
    with (
        session_patch,
        touch_patch,
        user_patch,
        patch(
            "app.routes.workflows.WorkflowRepository.get_by_id",
            return_value=workflow,
        ),
        patch(
            "app.routes.workflows.EnvironmentRepository.get_by_id",
            return_value=SimpleNamespace(environmentId=ENV_ID),
        ),
        patch(
            "app.routes.workflows.RunRepository.get_by_id",
            return_value=source_run,
        ),
        patch("app.models.Run", _DummyRunInsert),
        patch(
            "app.routes.workflows.asyncio.create_task",
            side_effect=_close_scheduled_coroutine,
        ),
    ):
        response = client.post(
            f"/api/workflows/{WORKFLOW_ID}/run?environmentId={ENV_ID}",
            json={
                "resume": {
                    "mode": "all-failed",
                    "sourceRunId": "run-skip-first-src",
                }
            },
        )

    assert response.status_code == 202
    body = response.json()
    assert body["resumeMode"] == "all-failed"
    # http-1 succeeded — must NOT appear in startNodeIds
    assert "http-1" not in (body["startNodeIds"] or [])
    # http-2 failed — must be the resume entry point
    assert body["startNodeIds"] == ["http-2"]


def test_lineage_hydration():
    """Node 1 extracts a variable; resume run has that variable available.

    Directly exercises ``WorkflowExecutor._hydrate_resume_context`` to verify
    that workflow-level variables and per-node results from the source run
    lineage are restored into the executor state.
    """
    from app.runner.executor import WorkflowExecutor

    source_run = SimpleNamespace(
        runId="run-lineage-src",
        workflowId=WORKFLOW_ID,
        status="failed",
        variables={"auth_token": "extracted-abc-123"},
        failedNodes=["http-2"],
        nodeStatuses={
            "http-1": {"status": "success", "timestamp": "2026-05-30T10:00:00Z"},
            "http-2": {"status": "error", "timestamp": "2026-05-30T10:00:01Z"},
        },
        resumeFromRunId=None,
    )

    # Mock DB that returns a stored node result for http-1
    mock_db = AsyncMock()
    stored_result = {
        "status": "success",
        "statusCode": 200,
        "body": {"token": "extracted-abc-123"},
    }

    async def _fake_find_one(query):
        if query.get("nodeId") == "http-1":
            return {"result": stored_result, "stored_in_gridfs": False}
        return None

    mock_db.node_results.find_one = _fake_find_one

    nodes = {
        "start-1": {"nodeId": "start-1", "type": "start"},
        "http-1": {"nodeId": "http-1", "type": "http-request"},
        "http-2": {"nodeId": "http-2", "type": "http-request"},
        "http-3": {"nodeId": "http-3", "type": "http-request"},
        "end-1": {"nodeId": "end-1", "type": "end"},
    }
    edges = [
        {"source": "start-1", "target": "http-1"},
        {"source": "http-1", "target": "http-2"},
        {"source": "http-2", "target": "http-3"},
        {"source": "http-3", "target": "end-1"},
    ]

    executor = WorkflowExecutor(
        run_id="run-lineage-resume",
        workflow_id=WORKFLOW_ID,
        resume_from_run_id="run-lineage-src",
    )
    executor.start_time = None

    with (
        patch(
            "app.runner.executor.RunRepository.get_by_id",
            new=AsyncMock(return_value=source_run),
        ),
        patch(
            "app.runner.executor.AsyncIOMotorGridFSBucket",
            return_value=AsyncMock(),
        ),
    ):
        asyncio.run(executor._hydrate_resume_context(mock_db, nodes, edges))

    # Variable extracted by node 1 in the source run must be available
    assert executor.workflow_variables.get("auth_token") == "extracted-abc-123"

    # Node 1 result must be hydrated so prev references resolve
    assert "http-1" in executor.results
    assert executor.results["http-1"].get("body") == {"token": "extracted-abc-123"}

    # Failed node must NOT be in results (it will be re-executed)
    assert "http-2" not in executor.results
