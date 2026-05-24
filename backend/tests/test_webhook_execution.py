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


def _mock_webhook_log(*args, **kwargs):
    """Create a mock WebhookLog that supports async .insert()"""
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    return mock_log


def _make_hmac_signature(secret: str, timestamp: str, body: bytes) -> str:
    """Generate canonical HMAC-SHA256 signature: HMAC(secret, timestamp + body)"""
    message = timestamp.encode("utf-8") + body
    return hmac_lib.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


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
    mock_run_doc = MagicMock()
    mock_run_doc.runId = "run-123"
    mock_run_doc.insert = AsyncMock()
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.RunRepository.create") as mock_run,
        patch("app.routes.webhooks.asyncio.create_task") as mock_task,
        patch("app.routes.webhooks.WebhookRepository.update") as mock_update,
        patch("app.routes.webhooks.WorkflowExecutor"),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.Run", return_value=mock_run_doc),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-123"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "test-token"
        mock_webhook_obj.environmentId = "env-test"
        mock_webhook_obj.save = AsyncMock()
        mock_webhook.return_value = mock_webhook_obj

        mock_wf_obj = MagicMock()
        mock_wf.return_value = mock_wf_obj

        mock_run_obj = MagicMock()
        mock_run_obj.runId = "run-123"
        mock_run.return_value = mock_run_obj

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
    mock_run_doc = MagicMock()
    mock_run_doc.runId = "run-compat"
    mock_run_doc.insert = AsyncMock()
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.RunRepository.create") as mock_run,
        patch("app.routes.webhooks.asyncio.create_task"),
        patch("app.routes.webhooks.WebhookRepository.update"),
        patch("app.routes.webhooks.WorkflowExecutor"),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.Run", return_value=mock_run_doc),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-compat"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "my-token"
        mock_webhook_obj.environmentId = None
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

    mock_run_doc = MagicMock()
    mock_run_doc.runId = "run-456"
    mock_run_doc.insert = AsyncMock()
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.RunRepository.create") as mock_run,
        patch("app.routes.webhooks.asyncio.create_task") as mock_task,
        patch("app.routes.webhooks.WebhookRepository.update") as mock_update,
        patch("app.routes.webhooks.WorkflowExecutor"),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.middleware.webhook_auth.WebhookRepository.get_by_id") as mock_auth,
        patch("app.routes.webhooks.Run", return_value=mock_run_doc),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.hmacSecret = secret
        mock_webhook_obj.resourceId = "wf-123"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = token
        mock_webhook_obj.environmentId = "env-test"
        mock_webhook_obj.save = AsyncMock()
        mock_webhook.return_value = mock_webhook_obj
        mock_auth.return_value = mock_webhook_obj

        mock_wf_obj = MagicMock()
        mock_wf.return_value = mock_wf_obj

        mock_run_obj = MagicMock()
        mock_run_obj.runId = "run-456"
        mock_run.return_value = mock_run_obj

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
    import app.idempotency as idempotency_module

    # Clear cache before test
    idempotency_module._idempotency_cache.clear()

    mock_run_doc = MagicMock()
    mock_run_doc.runId = "run-idem-001"
    mock_run_doc.insert = AsyncMock()

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.RunRepository.create") as mock_run,
        patch("app.routes.webhooks.asyncio.create_task"),
        patch("app.routes.webhooks.WebhookRepository.update"),
        patch("app.routes.webhooks.WorkflowExecutor"),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.Run", return_value=mock_run_doc),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-idem"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "idem-token"
        mock_webhook_obj.environmentId = None
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
        assert r2.status_code == 200
        assert r2.json()["runId"] == run_id_first
        assert r2.headers.get("idempotency-replayed") == "true"


def test_webhook_execute_idempotency_different_webhook_creates_new_run():
    """Same Idempotency-Key on a different webhookId must create a new run."""
    import app.idempotency as idempotency_module

    idempotency_module._idempotency_cache.clear()

    run_a = MagicMock()
    run_a.runId = "run-wh-A"
    run_a.insert = AsyncMock()

    run_b = MagicMock()
    run_b.runId = "run-wh-B"
    run_b.insert = AsyncMock()

    run_iter = iter([run_a, run_b])

    def _next_run(*args, **kwargs):
        return next(run_iter)

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch("app.routes.webhooks.RunRepository.create") as mock_run,
        patch("app.routes.webhooks.asyncio.create_task"),
        patch("app.routes.webhooks.WebhookRepository.update"),
        patch("app.routes.webhooks.WorkflowExecutor"),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.Run", side_effect=_next_run),
    ):
        def _webhook_for_id(wh_id: str):
            obj = MagicMock()
            obj.enabled = True
            obj.resourceId = "wf-shared"
            obj.usageCount = 0
            obj.token = "shared-token"
            obj.environmentId = None
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
        patch("app.routes.webhooks.WebhookRepository.update"),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "col-123"
        mock_webhook_obj.token = "test-token"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.save = AsyncMock()
        mock_webhook.return_value = mock_webhook_obj

        mock_col_obj = MagicMock()
        mock_col.return_value = mock_col_obj

        response = client.post(
            "/api/webhooks/collections/webhook-123/execute",
            json={"test": "data"},
            headers={"X-Webhook-Token": "test-token"},
        )

        assert response.status_code == 202
        data = response.json()
        assert data["status"] == "accepted"
