"""
Task 28 — Webhook scoped actors.

Verifies that:
- Webhook tokens scoped to workspace A can execute workflows in workspace A
- Webhook tokens scoped to workspace A are denied for workspace B workflows
- The scope check uses the webhook's workspaceId vs the workflow's workspaceId
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _disable_hmac(monkeypatch):
    monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", False)


def _mock_webhook_log(*args, **kwargs):
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    return mock_log


def _make_webhook_mock(
    *,
    webhook_id: str = "wh-t28",
    token: str = "test-token",
    workspace_id: str = "ws-A",
    scope_type: str = "workspace",
    scope_id: str = "ws-A",
):
    wh = MagicMock()
    wh.webhookId = webhook_id
    wh.token = token
    wh.enabled = True
    wh.resourceType = "workflow"
    wh.resourceId = "wf-1"
    wh.environmentId = "env-1"
    wh.workspaceId = workspace_id
    wh.scopeType = scope_type
    wh.scopeId = scope_id
    wh.usageCount = 0
    wh.save = AsyncMock()
    return wh


class TestWebhookScopeEnforcement:
    """Webhook tokens are scoped to a workspace."""

    @pytest.mark.asyncio
    async def test_same_workspace_allowed(self):
        """Webhook scoped to ws-A can execute workflow in ws-A."""
        webhook_mock = _make_webhook_mock(workspace_id="ws-A", scope_id="ws-A")
        workflow_mock = MagicMock()
        workflow_mock.workspaceId = "ws-A"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
            patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
            patch("app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)),
            patch("app.routes.webhooks.audit_service") as mock_audit,
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_actor.return_value = SimpleNamespace(
                tokenId="wh-wh-t28",
                webhookId="wh-t28",
                scopeType="workspace",
                scopeId="ws-A",
                permissions=["workflows:run"],
            )
            mock_audit.append_event = AsyncMock()
            mock_runner.enqueue = AsyncMock(return_value="run-same-ws")

            response = client.post(
                "/api/webhooks/workflows/wh-t28/execute",
                json={"event": "push"},
                headers={"X-Webhook-Token": "test-token"},
            )

        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "accepted"

    @pytest.mark.asyncio
    async def test_cross_workspace_denied(self):
        """Webhook scoped to ws-A is denied for workflow in ws-B."""
        webhook_mock = _make_webhook_mock(workspace_id="ws-A", scope_id="ws-A")
        workflow_mock = MagicMock()
        workflow_mock.workspaceId = "ws-B"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
            patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
            patch("app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)),
            patch("app.routes.webhooks.audit_service") as mock_audit,
        ):
            mock_actor.return_value = SimpleNamespace(
                tokenId="wh-wh-t28",
                webhookId="wh-t28",
                scopeType="workspace",
                scopeId="ws-A",
                permissions=["workflows:run"],
            )
            mock_audit.append_event = AsyncMock()

            response = client.post(
                "/api/webhooks/workflows/wh-t28/execute",
                json={"event": "push"},
                headers={"X-Webhook-Token": "test-token"},
            )

        assert response.status_code == 403
        detail = response.json()["detail"]
        assert "scope" in detail.lower() or "workspace" in detail.lower()

    @pytest.mark.asyncio
    async def test_org_scoped_webhook_denied_for_different_org_workflow(self):
        """Org-scoped webhook for org-1 is denied for workflow in org-2."""
        webhook_mock = _make_webhook_mock(
            webhook_id="wh-org",
            workspace_id="",
            scope_type="organization",
            scope_id="org-1",
        )
        webhook_mock.workspaceId = ""
        workflow_mock = MagicMock()
        workflow_mock.workspaceId = "ws-org2"
        workflow_mock.orgId = "org-2"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
            patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
            patch("app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)),
            patch("app.routes.webhooks.audit_service") as mock_audit,
        ):
            mock_actor.return_value = SimpleNamespace(
                tokenId="wh-wh-org",
                webhookId="wh-org",
                scopeType="organization",
                scopeId="org-1",
                permissions=["workflows:run"],
            )
            mock_audit.append_event = AsyncMock()

            response = client.post(
                "/api/webhooks/workflows/wh-org/execute",
                json={"event": "push"},
                headers={"X-Webhook-Token": "test-token"},
            )

        assert response.status_code == 403
