from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def _mock_webhook_log(*args, **kwargs):
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    return mock_log


def test_webhook_management_missing_admin_key_returns_403():
    with patch("app.routes.webhooks.settings.APIWEAVE_ADMIN_KEY", "shared-admin-key"):
        response = client.get("/api/webhooks/workflows/wf-123")

    assert response.status_code == 403


def test_webhook_management_wrong_admin_key_returns_403():
    with patch("app.routes.webhooks.settings.APIWEAVE_ADMIN_KEY", "shared-admin-key"):
        response = client.get(
            "/api/webhooks/workflows/wf-123",
            headers={"Authorization": "Bearer wrong-key"},
        )

    assert response.status_code == 403


def test_webhook_management_valid_admin_key_returns_2xx():
    with (
        patch("app.routes.webhooks.settings.APIWEAVE_ADMIN_KEY", "shared-admin-key"),
        patch("app.routes.webhooks.WebhookRepository.get_by_resource", return_value=[]),
    ):
        response = client.get(
            "/api/webhooks/workflows/wf-123",
            headers={"Authorization": "Bearer shared-admin-key"},
        )

    assert response.status_code == 200
    assert response.json() == []


def test_webhook_execute_route_does_not_require_admin_key():
    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id") as mock_webhook,
        patch("app.routes.webhooks.WorkflowRepository.get_by_id") as mock_wf,
        patch(
            "app.routes.webhooks.Run",
            side_effect=lambda **kwargs: MagicMock(runId=kwargs.get("runId", "run-123"), insert=AsyncMock()),
        ),
        patch("app.routes.webhooks.asyncio.create_task"),
        patch("app.routes.webhooks.WebhookRepository.update"),
        patch("app.routes.webhooks.WorkflowExecutor"),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_webhook_obj = MagicMock()
        mock_webhook_obj.enabled = True
        mock_webhook_obj.resourceId = "wf-123"
        mock_webhook_obj.usageCount = 0
        mock_webhook_obj.token = "test-token"
        mock_webhook_obj.environmentId = "env-test"
        mock_webhook.return_value = mock_webhook_obj

        mock_wf.return_value = MagicMock()

        response = client.post(
            "/api/webhooks/workflows/webhook-123/execute",
            json={"test": "data"},
            headers={"X-Webhook-Token": "test-token"},
        )

    assert response.status_code == 202
