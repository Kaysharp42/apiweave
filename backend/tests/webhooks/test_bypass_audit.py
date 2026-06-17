"""
Task 28 — Webhook bypass audit trail.

Verifies that:
- When a webhook token bypasses a protected environment, an audit event is created
- The audit event records the webhook_token actor, bypass reason, and environment
- Tokens NOT in the bypass allowlist do not trigger bypass
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


def _make_webhook_mock():
    wh = MagicMock()
    wh.webhookId = "wh-bypass-t28"
    wh.token = "bypass-token"
    wh.enabled = True
    wh.resourceType = "workflow"
    wh.resourceId = "wf-1"
    wh.environmentId = "env-protected"
    wh.workspaceId = "ws-A"
    wh.scopeType = "workspace"
    wh.scopeId = "ws-A"
    wh.usageCount = 0
    wh.save = AsyncMock()
    return wh


class TestWebhookBypassAudit:
    """Webhook bypass of protected environment creates audit trail."""

    @pytest.mark.asyncio
    async def test_bypass_creates_webhook_token_audit(self):
        """Bypass creates an audit event with webhook_token actor."""
        webhook_mock = _make_webhook_mock()
        workflow_mock = MagicMock()
        workflow_mock.workspaceId = "ws-A"

        protection_mock = MagicMock()
        protection_mock.bypassAllowlist = ["wh-wh-bypass-t28"]
        protection_mock.bypassPolicy = "trusted_token_only"
        protection_mock.requiredReviewers = ["user-reviewer"]

        gate_record = MagicMock()
        gate_record.approvalId = "appr-bypass-t28"
        gate_record.runId = "run-pending-bypass"
        gate_record.environmentId = "env-protected"
        gate_record.workspaceId = "ws-A"

        audit_events: list[dict] = []

        async def capture_audit(**kwargs):
            audit_events.append(kwargs)
            return MagicMock(eventId=f"evt-{len(audit_events)}")

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
            patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
            patch(
                "app.routes.webhooks.check_protection_and_maybe_gate",
                return_value=("pending_approval", gate_record),
            ),
            patch("app.routes.webhooks._get_protection", return_value=protection_mock),
            patch("app.routes.webhooks.bypass_protection", new_callable=AsyncMock),
            patch("app.routes.webhooks.audit_service") as mock_audit,
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_actor.return_value = SimpleNamespace(
                tokenId="wh-wh-bypass-t28",
                webhookId="wh-bypass-t28",
                scopeType="workspace",
                scopeId="ws-A",
                permissions=["workflows:run"],
            )
            mock_audit.append_event = AsyncMock(side_effect=capture_audit)
            mock_runner.enqueue = AsyncMock(return_value="run-bypass-t28")

            response = client.post(
                "/api/webhooks/workflows/wh-bypass-t28/execute",
                json={"event": "deploy"},
                headers={"X-Webhook-Token": "bypass-token"},
            )

        assert response.status_code == 202

        # Verify webhook_token audit event exists
        webhook_audits = [e for e in audit_events if e.get("actor") == "webhook_token"]
        assert len(webhook_audits) >= 1
        evt = webhook_audits[0]
        assert evt["actor"] == "webhook_token"
        assert evt["actor_id"] == "wh-wh-bypass-t28"
        assert evt["action"] == "webhook_executed"
        assert evt["scope"] == "workspace"
        assert evt["scope_id"] == "ws-A"
        assert "bypassReason" in evt.get("context", {})

    @pytest.mark.asyncio
    async def test_not_in_allowlist_no_bypass(self):
        """Token not in bypass allowlist does not trigger bypass."""
        webhook_mock = _make_webhook_mock()
        workflow_mock = MagicMock()
        workflow_mock.workspaceId = "ws-A"

        protection_mock = MagicMock()
        protection_mock.bypassAllowlist = ["wh-other-token"]
        protection_mock.bypassPolicy = "trusted_token_only"

        gate_record = MagicMock()
        gate_record.approvalId = "appr-gated"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
            patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
            patch(
                "app.routes.webhooks.check_protection_and_maybe_gate",
                return_value=("pending_approval", gate_record),
            ),
            patch("app.routes.webhooks._get_protection", return_value=protection_mock),
            patch("app.routes.webhooks.bypass_protection", new_callable=AsyncMock) as mock_bypass,
            patch("app.routes.webhooks.audit_service") as mock_audit,
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_actor.return_value = SimpleNamespace(
                tokenId="wh-wh-bypass-t28",
                webhookId="wh-bypass-t28",
                scopeType="workspace",
                scopeId="ws-A",
                permissions=["workflows:run"],
            )
            mock_audit.append_event = AsyncMock()
            mock_runner.enqueue = AsyncMock(return_value="run-gated")

            response = client.post(
                "/api/webhooks/workflows/wh-bypass-t28/execute",
                json={"event": "deploy"},
                headers={"X-Webhook-Token": "bypass-token"},
            )

        assert response.status_code == 202
        mock_bypass.assert_not_awaited()
