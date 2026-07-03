"""
Task 16 — Webhook execution under scoped actors.

Tests:
1. Webhook token scoped to workspace A is denied when targeting workspace B.
2. Webhook bypass of protected environment creates audit event.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

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
    webhook_id: str = "wh-scope-test",
    token: str = "correct-token",
    enabled: bool = True,
    resource_type: str = "workflow",
    resource_id: str = "wf-123",
    environment_id: str = "env-1",
    workspace_id: str = "ws-A",
    scope_type: str = "workspace",
    scope_id: str = "ws-A",
):
    wh = MagicMock()
    wh.webhookId = webhook_id
    wh.token = token
    wh.enabled = enabled
    wh.resourceType = resource_type
    wh.resourceId = resource_id
    wh.environmentId = environment_id
    wh.workspaceId = workspace_id
    wh.scopeType = scope_type
    wh.scopeId = scope_id
    wh.usageCount = 0
    wh.save = AsyncMock()
    return wh


# ======================================================================
# Scenario 1: Webhook scope enforcement
# ======================================================================


@pytest.mark.asyncio
async def test_webhook_scope_mismatch_returns_403():
    """Webhook token scoped to workspace A must be denied when the target
    workflow belongs to workspace B (no data leak)."""

    webhook_mock = _make_webhook_mock(workspace_id="ws-A", scope_id="ws-A")
    workflow_mock = MagicMock()
    workflow_mock.workspaceId = "ws-B"

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
        patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
        patch(
            "app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)
        ),
        patch("app.routes.webhooks.audit_service") as mock_audit,
    ):
        mock_actor.return_value = SimpleNamespace(
            tokenId="wh-wh-scope-test",
            webhookId="wh-scope-test",
            scopeType="workspace",
            scopeId="ws-A",
            permissions=["workflows:run"],
        )
        mock_audit.append_event = AsyncMock()

        response = client.post(
            "/api/webhooks/workflows/wh-scope-test/execute",
            json={"event": "push"},
            headers={"X-Webhook-Token": "correct-token"},
        )

    assert response.status_code == 403
    detail = response.json()["detail"]
    assert "scope" in detail.lower() or "workspace" in detail.lower()


@pytest.mark.asyncio
async def test_webhook_scope_match_proceeds():
    """Webhook token scoped to workspace A succeeds when the target
    workflow also belongs to workspace A."""

    webhook_mock = _make_webhook_mock(workspace_id="ws-A", scope_id="ws-A")
    workflow_mock = MagicMock()
    workflow_mock.workspaceId = "ws-A"

    with (
        patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=webhook_mock),
        patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=workflow_mock),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        patch("app.routes.webhooks.resolve_webhook_actor") as mock_actor,
        patch(
            "app.routes.webhooks.check_protection_and_maybe_gate", return_value=("proceed", None)
        ),
        patch("app.routes.webhooks.audit_service") as mock_audit,
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
    ):
        mock_actor.return_value = SimpleNamespace(
            tokenId="wh-wh-scope-test",
            webhookId="wh-scope-test",
            scopeType="workspace",
            scopeId="ws-A",
            permissions=["workflows:run"],
        )
        mock_audit.append_event = AsyncMock()
        mock_runner.enqueue = AsyncMock(return_value="run-abc123")

        response = client.post(
            "/api/webhooks/workflows/wh-scope-test/execute",
            json={"event": "push"},
            headers={"X-Webhook-Token": "correct-token"},
        )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "accepted"
    assert body["runId"] == "run-abc123"


# ======================================================================
# Scenario 2: Webhook bypass audit
# ======================================================================


@pytest.mark.asyncio
async def test_webhook_bypass_creates_audit_event():
    """When a webhook token is in the bypass allowlist for a protected
    environment, the bypass is recorded in the audit log with the
    webhook_token actor, reason, environment, and run."""

    webhook_mock = _make_webhook_mock(workspace_id="ws-A", scope_id="ws-A")
    workflow_mock = MagicMock()
    workflow_mock.workspaceId = "ws-A"

    protection_mock = MagicMock()
    protection_mock.bypassAllowlist = ["wh-wh-scope-test"]
    protection_mock.bypassPolicy = "trusted_token_only"
    protection_mock.requiredReviewers = ["user-reviewer"]

    gate_record = MagicMock()
    gate_record.approvalId = "appr-123"
    gate_record.runId = "run-pending-wh-scope-test"
    gate_record.environmentId = "env-1"
    gate_record.workspaceId = "ws-A"

    audit_events: list[dict] = []

    async def capture_audit(**kwargs):
        audit_events.append(kwargs)
        return MagicMock()

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
            tokenId="wh-wh-scope-test",
            webhookId="wh-scope-test",
            scopeType="workspace",
            scopeId="ws-A",
            permissions=["workflows:run"],
        )
        mock_audit.append_event = AsyncMock(side_effect=capture_audit)
        mock_bypass.return_value = MagicMock()
        mock_runner.enqueue = AsyncMock(return_value="run-bypass-123")

        response = client.post(
            "/api/webhooks/workflows/wh-scope-test/execute",
            json={"event": "push"},
            headers={"X-Webhook-Token": "correct-token"},
        )

    assert response.status_code == 202

    mock_bypass.assert_awaited_once()
    bypass_call_kwargs = mock_bypass.call_args
    assert bypass_call_kwargs.kwargs.get("token_id") == "wh-wh-scope-test" or (
        bypass_call_kwargs.args and "wh-wh-scope-test" in bypass_call_kwargs.args
    )

    assert len(audit_events) >= 1
    webhook_audit = [e for e in audit_events if e.get("actor") == "webhook_token"]
    assert len(webhook_audit) >= 1
    evt = webhook_audit[0]
    assert evt["actor"] == "webhook_token"
    assert evt["actor_id"] == "wh-wh-scope-test"
    assert evt["action"] == "webhook_executed"
    assert evt["scope"] == "workspace"
    assert evt["scope_id"] == "ws-A"
    assert evt["resource_type"] == "webhook"
    assert evt["resource_id"] == "wh-scope-test"
    assert "bypassReason" in evt.get("context", {})


@pytest.mark.asyncio
async def test_webhook_bypass_not_in_allowlist_denied():
    """When a webhook token is NOT in the bypass allowlist, the bypass
    attempt is silently skipped and the run proceeds as gated."""

    webhook_mock = _make_webhook_mock(workspace_id="ws-A", scope_id="ws-A")
    workflow_mock = MagicMock()
    workflow_mock.workspaceId = "ws-A"

    protection_mock = MagicMock()
    protection_mock.bypassAllowlist = ["wh-other-token"]
    protection_mock.bypassPolicy = "trusted_token_only"

    gate_record = MagicMock()
    gate_record.approvalId = "appr-456"

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
        patch("app.routes.webhooks.reject_gate_record", new=AsyncMock()),
        patch("app.routes.webhooks.audit_service") as mock_audit,
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
    ):
        mock_actor.return_value = SimpleNamespace(
            tokenId="wh-wh-scope-test",
            webhookId="wh-scope-test",
            scopeType="workspace",
            scopeId="ws-A",
            permissions=["workflows:run"],
        )
        mock_audit.append_event = AsyncMock()
        mock_runner.enqueue = AsyncMock(return_value="run-gated-123")

        response = client.post(
            "/api/webhooks/workflows/wh-scope-test/execute",
            json={"event": "push"},
            headers={"X-Webhook-Token": "correct-token"},
        )

    # Token not in allowlist → bypass not attempted; protected env denies the run.
    assert response.status_code == 403
    mock_bypass.assert_not_awaited()
