"""
Tests for webhook execution endpoints
"""

import hashlib
import hmac as hmac_lib
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _mock_webhook_log(*args, **kwargs):
    """Create a mock WebhookLog that supports async .insert()"""
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    return mock_log


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
        patch("app.models.Run", return_value=mock_run_doc),
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


def test_webhook_execute_invalid_signature():
    """Test webhook execution with invalid signature"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook = MagicMock()
        mock_webhook.enabled = True
        mock_webhook.hmacSecret = "secret"
        mock.return_value = mock_webhook
        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"test": "data"},
            headers={"X-Webhook-Signature": "wrong"},
        )
        assert response.status_code == 401


def test_webhook_execute_valid_signature():
    """Test webhook execution with valid signature"""
    secret = "test-secret"
    token = "test-token"
    payload_bytes = b'{"test":"data"}'
    signature = hmac_lib.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()

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
        patch("app.models.Run", return_value=mock_run_doc),
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
            },
        )

        assert response.status_code == 202


def test_webhook_execute_collection():
    """Test collection webhook execution"""
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.CollectionRepository.get_by_id") as mock_col,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
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
