"""
Tests for webhook execution endpoints
"""

import hashlib
import hmac as hmac_lib
import time
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import WorkflowOrderItem
from app.routes.webhooks import _run_collection_and_update_webhook

client = TestClient(app)


@pytest.fixture(autouse=True)
def _allow_token_only_webhooks(monkeypatch):
    monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", False)


@pytest.fixture(autouse=True)
def _mock_task16_deps(monkeypatch):
    """Auto-mock Task 16 dependencies for existing tests."""
    from unittest.mock import AsyncMock, MagicMock

    monkeypatch.setattr(
        "app.routes.webhooks.resolve_webhook_actor",
        AsyncMock(return_value=MagicMock(tokenId="wh-test")),
    )
    monkeypatch.setattr(
        "app.routes.webhooks.check_protection_and_maybe_gate",
        AsyncMock(return_value=("proceed", None)),
    )
    monkeypatch.setattr(
        "app.routes.webhooks.audit_service",
        MagicMock(append_event=AsyncMock()),
    )
    monkeypatch.setattr(
        "app.routes.webhooks._get_protection",
        AsyncMock(return_value=None),
    )


def _mock_webhook_log(*args, **kwargs):
    """Create a mock WebhookLog that supports async .insert()"""
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    return mock_log


def _make_hmac_signature(secret: str, timestamp: str, body: bytes) -> str:
    """Generate canonical HMAC-SHA256 signature: HMAC(secret, timestamp + body)"""
    message = timestamp.encode("utf-8") + body
    return hmac_lib.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def test_webhook_execute_invalid_token_returns_401():
    """Wrong token on execute endpoint must return 401."""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.token = "correct-token"
        mock.return_value = mock_webhook

        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"test": "data"},
            headers={"X-Webhook-Token": "wrong-token"},
        )
        assert response.status_code == 401
        assert "token" in response.json()["detail"].lower()


def test_webhook_execute_missing_token_returns_401():
    """Missing X-Webhook-Token header must return 401."""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.token = "correct-token"
        mock.return_value = mock_webhook

        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"test": "data"},
        )
        assert response.status_code == 401


def test_webhook_execute_rate_limit_returns_429():
    """Exceeding the rate limit on execute endpoint must return 429."""
    from app.middleware.rate_limiter import _rate_limiter

    webhook_id = "wh-ratelimit-test"
    max_req = 3
    for _ in range(max_req):
        _rate_limiter.check_rate_limit(webhook_id, max_requests=max_req, window_seconds=3600)

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch(
            "app.middleware.rate_limiter._rate_limiter.check_rate_limit",
            return_value=(False, 0, int(time.time()) + 3600),
        ),
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.token = "rl-token"
        mock.return_value = mock_webhook

        response = client.post(
            f"/api/webhooks/workflows/{webhook_id}/execute",
            json={"event": "push"},
            headers={"X-Webhook-Token": "rl-token"},
        )
        assert response.status_code == 429
        assert "x-ratelimit-limit" in response.headers or "X-RateLimit-Limit" in response.headers


def test_webhook_execute_missing_webhook():
    """Test webhook execution returns 404 for missing webhook"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock.return_value = None
        response = client.post("/api/webhooks/workflows/webhook-999/execute", json={"test": "data"})
        assert response.status_code == 404


def test_webhook_execute_disabled_webhook():
    """Test webhook execution rejects disabled webhooks"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = False
        mock_webhook.token = "test-token"
        mock.return_value = mock_webhook
        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"test": "data"},
            headers={"X-Webhook-Token": "test-token"},
        )
        assert response.status_code == 403


def test_webhook_execute_invalid_json():
    """Test webhook execution rejects invalid JSON"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.token = "test-token"
        mock.return_value = mock_webhook
        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            content=b"{invalid json",
            headers={"Content-Type": "application/json", "X-Webhook-Token": "test-token"},
        )
        assert response.status_code == 400


def test_webhook_execute_missing_workflow():
    """Test webhook execution returns 404 for missing workflow"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.token = "test-token"
        mock_webhook.return_value = mock_webhook_obj
        mock_wf.return_value = None
        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={},
            headers={"X-Webhook-Token": "test-token"},
        )
        assert response.status_code == 404


def test_webhook_execute_success():
    """Test successful webhook execution"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
        patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
        patch(
            "app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)
        ),
        patch("app.routes.webhooks.audit_service") as mock_audit,
    ):
        mock_runner.enqueue = AsyncMock(return_value="run-123")
        mock_actor.return_value = MagicMock(tokenId="wh-webhook-123")
        mock_audit.append_event = AsyncMock()

        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-123"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "test-token"
        mock_webhook_obj.environmentId = "env-test"
        mock_webhook_obj.workspaceId = "ws-test"
        mock_webhook_obj.scopeId = "ws-test"
        mock_webhook_obj.save = AsyncMock()
        mock_webhook.return_value = mock_webhook_obj

        mock_wf_obj = MagicMock()
        mock_wf_obj.workspaceId = "ws-test"
        mock_wf.return_value = mock_wf_obj

        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"user": "test"},
            headers={"X-Webhook-Token": "test-token"},
        )

        assert response.status_code == 202
        data = response.json()
        assert data["status"] == "accepted"
        assert data["runId"] == "run-123"


# ── Token-only compatibility ──────────────────────────────────────────────────


def test_webhook_execute_token_only_returns_202():
    """Token-only requests (no HMAC headers) must still return 202 — backwards compat."""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
        patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
        patch(
            "app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)
        ),
        patch("app.routes.webhooks.audit_service") as mock_audit,
    ):
        mock_runner.enqueue = AsyncMock(return_value="run-compat")
        mock_actor.return_value = MagicMock(tokenId="wh-wh-compat")
        mock_audit.append_event = AsyncMock()

        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-compat"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "my-token"
        mock_webhook_obj.environmentId = None
        mock_webhook_obj.workspaceId = None
        mock_webhook_obj.scopeId = None
        mock_webhook.return_value = mock_webhook_obj
        mock_wf.return_value = MagicMock()

        # No X-Webhook-Signature, no X-Webhook-Timestamp — token only
        response = client.post(
            "/api/webhooks/workflows/wh-compat/execute",
            json={"ci": "push"},
            headers={"X-Webhook-Token": "my-token"},
        )

        assert response.status_code == 202
        data = response.json()
        assert data["status"] == "accepted"
        # Rate-limit headers must be present
        assert "x-ratelimit-limit" in response.headers


# ── HMAC / replay protection ──────────────────────────────────────────────────


def test_webhook_execute_invalid_signature():
    """Test webhook execution with invalid HMAC signature returns 401"""
    timestamp = str(int(time.time()))
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.middleware.webhook_auth.WebhookRepository.get_by_id") as mock_auth,
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.hmacSecret = "secret"
        mock_webhook.token = "test-token"
        mock.return_value = mock_webhook
        mock_auth.return_value = mock_webhook

        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"test": "data"},
            headers={
                "X-Webhook-Token": "test-token",
                "X-Webhook-Signature": "deadbeef" * 8,  # wrong sig
                "X-Webhook-Timestamp": timestamp,
            },
        )
        assert response.status_code == 401


def test_webhook_execute_stale_timestamp_returns_401():
    """Stale timestamp (>300s old) on signed request must return 401."""
    secret = "stale-secret"
    token = "stale-token"
    body = b'{"event": "push"}'
    old_timestamp = str(int(time.time()) - 400)  # 400 seconds ago — outside ±300s window
    signature = _make_hmac_signature(secret, old_timestamp, body)

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.middleware.webhook_auth.WebhookRepository.get_by_id") as mock_auth,
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.hmacSecret = secret
        mock_webhook.token = token
        mock.return_value = mock_webhook
        mock_auth.return_value = mock_webhook

        response = client.post(
            "/api/webhooks/workflows/webhook-stale/execute",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Token": token,
                "X-Webhook-Signature": signature,
                "X-Webhook-Timestamp": old_timestamp,
            },
        )
        assert response.status_code == 401
        assert "Replay attack detected" in response.json()["detail"]


def test_webhook_execute_valid_signature():
    """Test webhook execution with valid HMAC signature (timestamp + body scheme)"""
    secret = "test-secret"
    token = "test-token"
    payload_bytes = b'{"test":"data"}'
    timestamp = str(int(time.time()))
    signature = _make_hmac_signature(secret, timestamp, payload_bytes)

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.middleware.webhook_auth.WebhookRepository.get_by_id") as mock_auth,
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
    ):
        mock_runner.enqueue = AsyncMock(return_value="run-456")

        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.hmacSecret = secret
        mock_webhook_obj.resourceId = "wf-123"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = token
        mock_webhook_obj.environmentId = "env-test"
        mock_webhook_obj.workspaceId = None
        mock_webhook_obj.scopeId = None
        mock_webhook_obj.save = AsyncMock()
        mock_webhook.return_value = mock_webhook_obj
        mock_auth.return_value = mock_webhook_obj

        mock_wf_obj = MagicMock()
        mock_wf.return_value = mock_wf_obj

        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            content=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "X-Webhook-Token": token,
                "X-Webhook-Signature": signature,
                "X-Webhook-Timestamp": timestamp,
            },
        )

        assert response.status_code == 202


# ── Idempotency ───────────────────────────────────────────────────────────────


def test_webhook_execute_idempotency_same_run_id():
    """Two identical requests with same Idempotency-Key return same runId."""
    cached_entry = SimpleNamespace(response_body={"status": "accepted", "runId": "run-idem-001"})

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
        patch(
            "app.routes.webhooks.get_idempotency_entry",
            new=AsyncMock(side_effect=[None, cached_entry]),
        ),
        patch("app.routes.webhooks.store_idempotency_entry", new=AsyncMock()),
    ):
        mock_runner.enqueue = AsyncMock(return_value="run-idem-001")

        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-idem"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "idem-token"
        mock_webhook_obj.environmentId = None
        mock_webhook_obj.workspaceId = None
        mock_webhook_obj.scopeId = None
        mock_webhook.return_value = mock_webhook_obj
        mock_wf.return_value = MagicMock()

        headers = {
            "X-Webhook-Token": "idem-token",
            "Idempotency-Key": "deploy-abc-123",
        }

        # First request — creates run
        r1 = client.post(
            "/api/webhooks/workflows/wh-idem/execute",
            json={"ref": "main"},
            headers=headers,
        )
        assert r1.status_code == 202
        run_id_first = r1.json()["runId"]

        # Second request — same idempotency key, same webhookId
        r2 = client.post(
            "/api/webhooks/workflows/wh-idem/execute",
            json={"ref": "main"},
            headers=headers,
        )
        assert r2.status_code == 202
        assert r2.json()["runId"] == run_id_first
        assert r2.headers.get("idempotency-replayed") == "true"


def test_webhook_execute_idempotency_different_webhook_creates_new_run():
    """Same Idempotency-Key on a different webhookId must create a new run."""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
        patch("app.routes.webhooks.get_idempotency_entry", new=AsyncMock(return_value=None)),
        patch("app.routes.webhooks.store_idempotency_entry", new=AsyncMock()),
    ):
        mock_runner.enqueue = AsyncMock(side_effect=["run-wh-A", "run-wh-B"])

        def _webhook_for_id(wh_id: str):
            obj = MagicMock()
            obj.enabled = True
            obj.resourceId = "wf-shared"
            obj.usageCount = 0
            obj.token = "shared-token"
            obj.environmentId = None
            obj.workspaceId = None
            obj.scopeId = None
            return obj

        mock_webhook.side_effect = _webhook_for_id
        mock_wf.return_value = MagicMock()

        shared_key = "shared-deploy-key"
        shared_headers = {
            "X-Webhook-Token": "shared-token",
            "Idempotency-Key": shared_key,
        }

        # Request to webhook A
        r_a = client.post(
            "/api/webhooks/workflows/wh-A/execute",
            json={"ref": "main"},
            headers=shared_headers,
        )
        assert r_a.status_code == 202
        run_id_a = r_a.json()["runId"]

        # Request to webhook B — different webhookId, same key → new run
        r_b = client.post(
            "/api/webhooks/workflows/wh-B/execute",
            json={"ref": "main"},
            headers=shared_headers,
        )
        assert r_b.status_code == 202
        run_id_b = r_b.json()["runId"]

        assert run_id_a != run_id_b
        assert r_b.headers.get("idempotency-replayed") is None


def test_webhook_execute_collection():
    """Test collection webhook execution"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.CollectionRepository.get_by_id") as mock_col,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
    ):
        mock_runner.enqueue = AsyncMock(return_value="crun-real-123")

        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "col-123"
        mock_webhook_obj.token = "test-token"
        mock_webhook_obj.environmentId = "env-test"
        mock_webhook_obj.workspaceId = None
        mock_webhook_obj.scopeId = None
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.save = AsyncMock()
        mock_webhook.return_value = mock_webhook_obj

        mock_col_obj = MagicMock()
        mock_col_obj.collectionId = "col-123"
        mock_col_obj.name = "Regression Suite"
        mock_col_obj.workflowOrder = []
        mock_col_obj.workspaceId = None
        mock_col.return_value = mock_col_obj

        response = client.post(
            "/api/webhooks/collections/webhook-123/execute",
            json={"test": "data"},
            headers={"X-Webhook-Token": "test-token"},
        )

        assert response.status_code == 202
        data = response.json()
        assert data["status"] == "accepted"
        assert data["collectionRunId"] == "crun-real-123"
        mock_runner.enqueue.assert_called_once()


@pytest.mark.asyncio
async def test_collection_webhook_executes_enabled_workflows_in_order():
    execution_order = []
    statuses_by_run_id = {}

    class FakeExecutor:
        def __init__(self, run_id, workflow_id):
            self.run_id = run_id
            self.workflow_id = workflow_id

        async def execute(self):
            execution_order.append(self.workflow_id)
            statuses_by_run_id[self.run_id] = SimpleNamespace(
                status="completed",
                error=None,
                failureMessage=None,
            )

    collection = SimpleNamespace(
        collectionId="col-123",
        workflowOrder=[
            WorkflowOrderItem(workflowId="wf-2", order=2, enabled=True),
            WorkflowOrderItem(workflowId="wf-disabled", order=1, enabled=False),
            WorkflowOrderItem(workflowId="wf-1", order=0, enabled=True),
        ],
        continueOnFail=True,
    )

    with (
        patch(
            "app.routes.webhooks.CollectionRunRepository.get_by_id",
            AsyncMock(
                return_value=SimpleNamespace(collectionId="col-123", environmentId="env-test")
            ),
        ),
        patch("app.routes.webhooks.CollectionRunRepository.update_fields", AsyncMock()),
        patch(
            "app.routes.webhooks.CollectionRunRepository.add_workflow_result", AsyncMock()
        ) as add_result,
        patch("app.routes.webhooks.CollectionRunRepository.complete", AsyncMock()) as complete,
        patch(
            "app.routes.webhooks.CollectionRepository.get_by_id", AsyncMock(return_value=collection)
        ),
        patch(
            "app.routes.webhooks.WorkflowRepository.get_by_id",
            AsyncMock(
                side_effect=lambda workflow_id: SimpleNamespace(
                    workflowId=workflow_id, name=workflow_id
                )
            ),
        ),
        patch(
            "app.routes.webhooks.RunRepository.get_by_id",
            AsyncMock(side_effect=lambda run_id: statuses_by_run_id[run_id]),
        ),
        patch(
            "app.routes.webhooks.Run",
            side_effect=lambda **kwargs: SimpleNamespace(
                runId=kwargs.get("runId", "run-test"),
                insert=AsyncMock(),
            ),
        ),
        patch("app.routes.webhooks.WorkflowExecutor", FakeExecutor),
        patch("app.routes.webhooks.WebhookRepository.update_usage", AsyncMock()),
        patch("app.routes.webhooks.WebhookLog.find_one", AsyncMock(return_value=None)),
    ):
        await _run_collection_and_update_webhook(
            "crun-123", "wh-123", "log-123", {}, datetime.now(UTC)
        )

    assert execution_order == ["wf-1", "wf-2"]
    assert [call.args[1]["workflowId"] for call in add_result.call_args_list] == ["wf-1", "wf-2"]
    assert complete.call_args.args[1] == "completed"


@pytest.mark.asyncio
async def test_collection_webhook_continue_on_fail_false_stops_after_first_failure():
    execution_order = []
    statuses_by_run_id = {}

    class FakeExecutor:
        def __init__(self, run_id, workflow_id):
            self.run_id = run_id
            self.workflow_id = workflow_id

        async def execute(self):
            execution_order.append(self.workflow_id)
            status = "failed" if self.workflow_id == "wf-1" else "completed"
            statuses_by_run_id[self.run_id] = SimpleNamespace(
                status=status,
                error="boom" if status == "failed" else None,
                failureMessage=None,
            )

    collection = SimpleNamespace(
        collectionId="col-123",
        workflowOrder=[
            WorkflowOrderItem(workflowId="wf-1", order=0, enabled=True, continueOnFail=False),
            WorkflowOrderItem(workflowId="wf-2", order=1, enabled=True, continueOnFail=True),
        ],
        continueOnFail=False,
    )

    with (
        patch(
            "app.routes.webhooks.CollectionRunRepository.get_by_id",
            AsyncMock(
                return_value=SimpleNamespace(collectionId="col-123", environmentId="env-test")
            ),
        ),
        patch("app.routes.webhooks.CollectionRunRepository.update_fields", AsyncMock()),
        patch(
            "app.routes.webhooks.CollectionRunRepository.add_workflow_result", AsyncMock()
        ) as add_result,
        patch("app.routes.webhooks.CollectionRunRepository.complete", AsyncMock()) as complete,
        patch(
            "app.routes.webhooks.CollectionRepository.get_by_id", AsyncMock(return_value=collection)
        ),
        patch(
            "app.routes.webhooks.WorkflowRepository.get_by_id",
            AsyncMock(
                side_effect=lambda workflow_id: SimpleNamespace(
                    workflowId=workflow_id, name=workflow_id
                )
            ),
        ),
        patch(
            "app.routes.webhooks.RunRepository.get_by_id",
            AsyncMock(side_effect=lambda run_id: statuses_by_run_id[run_id]),
        ),
        patch(
            "app.routes.webhooks.Run",
            side_effect=lambda **kwargs: SimpleNamespace(
                runId=kwargs.get("runId", "run-test"),
                insert=AsyncMock(),
            ),
        ),
        patch("app.routes.webhooks.WorkflowExecutor", FakeExecutor),
        patch("app.routes.webhooks.WebhookRepository.update_usage", AsyncMock()) as update_usage,
        patch("app.routes.webhooks.WebhookLog.find_one", AsyncMock(return_value=None)),
    ):
        await _run_collection_and_update_webhook(
            "crun-123", "wh-123", "log-123", {}, datetime.now(UTC)
        )

    assert execution_order == ["wf-1"]
    assert add_result.call_count == 1
    assert complete.call_args.args[1] == "failed"
    update_usage.assert_awaited_once_with("wh-123", "failure")


@pytest.mark.asyncio
async def test_collection_webhook_empty_collection_completes_immediately():
    collection = SimpleNamespace(collectionId="col-empty", workflowOrder=[], continueOnFail=False)

    with (
        patch(
            "app.routes.webhooks.CollectionRunRepository.get_by_id",
            AsyncMock(
                return_value=SimpleNamespace(collectionId="col-empty", environmentId="env-test")
            ),
        ),
        patch("app.routes.webhooks.CollectionRunRepository.update_fields", AsyncMock()),
        patch(
            "app.routes.webhooks.CollectionRunRepository.add_workflow_result", AsyncMock()
        ) as add_result,
        patch("app.routes.webhooks.CollectionRunRepository.complete", AsyncMock()) as complete,
        patch(
            "app.routes.webhooks.CollectionRepository.get_by_id", AsyncMock(return_value=collection)
        ),
        patch("app.routes.webhooks.WorkflowExecutor") as executor,
        patch("app.routes.webhooks.WebhookRepository.update_usage", AsyncMock()) as update_usage,
        patch("app.routes.webhooks.WebhookLog.find_one", AsyncMock(return_value=None)),
    ):
        await _run_collection_and_update_webhook(
            "crun-empty", "wh-123", "log-123", {}, datetime.now(UTC)
        )

    add_result.assert_not_called()
    executor.assert_not_called()
    assert complete.call_args.args[1] == "completed"
    update_usage.assert_awaited_once_with("wh-123", "success")


@pytest.mark.asyncio
async def test_run_workflow_wrapper_success():
    from app.routes.webhooks import _run_workflow_and_update_webhook

    mock_executor = MagicMock()
    mock_executor.run_id = "run-abc"
    mock_executor.has_failures = False
    mock_executor.first_error_message = None
    mock_executor.execute = AsyncMock()

    class FakeLog:
        status = "success"
        duration = 0
        runId = None
        errorMessage = None
        save = AsyncMock()

    fake_log = FakeLog()

    with patch(
        "app.routes.webhooks.WebhookRepository.update_usage", new_callable=AsyncMock
    ) as mock_update:
        await _run_workflow_and_update_webhook(
            mock_executor, "wh-test", fake_log, datetime.now(UTC)
        )

        mock_update.assert_awaited_once_with("wh-test", "success")
        assert fake_log.status == "success"
        assert fake_log.runId == "run-abc"
        fake_log.save.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_workflow_wrapper_failure():
    from app.routes.webhooks import _run_workflow_and_update_webhook

    mock_executor = MagicMock()
    mock_executor.run_id = "run-fail"
    mock_executor.has_failures = True
    mock_executor.first_error_message = "node-1 failed"
    mock_executor.execute = AsyncMock()

    class FakeLog:
        status = "success"
        duration = 0
        runId = None
        errorMessage = None
        save = AsyncMock()

    fake_log = FakeLog()

    with patch(
        "app.routes.webhooks.WebhookRepository.update_usage", new_callable=AsyncMock
    ) as mock_update:
        await _run_workflow_and_update_webhook(
            mock_executor, "wh-test", fake_log, datetime.now(UTC)
        )

        mock_update.assert_awaited_once_with("wh-test", "failure")
        assert fake_log.status == "failure"
        assert fake_log.errorMessage == "node-1 failed"


@pytest.mark.asyncio
async def test_run_workflow_wrapper_executor_crash():
    from app.routes.webhooks import _run_workflow_and_update_webhook

    mock_executor = MagicMock()
    mock_executor.run_id = "run-crash"
    mock_executor.has_failures = False
    mock_executor.first_error_message = None
    mock_executor.execute = AsyncMock(side_effect=RuntimeError("unexpected crash"))

    class FakeLog:
        status = "success"
        duration = 0
        runId = None
        errorMessage = None
        save = AsyncMock()

    fake_log = FakeLog()

    with patch(
        "app.routes.webhooks.WebhookRepository.update_usage", new_callable=AsyncMock
    ) as mock_update:
        await _run_workflow_and_update_webhook(
            mock_executor, "wh-test", fake_log, datetime.now(UTC)
        )

        mock_update.assert_awaited_once_with("wh-test", "failure")
        assert fake_log.status == "failure"
        assert "unexpected crash" in (fake_log.errorMessage or "")
