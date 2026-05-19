"""Tests for webhook MCP schemas — verify credential redaction and DTO shapes."""
from datetime import datetime, UTC

from app.mcp.contracts import REDACTION_PLACEHOLDER
from app.mcp.schemas.webhooks import (
    WebhookCredentialResponse,
    WebhookDetail,
    WebhookLogEntry,
    WebhookSummary,
    webhook_log_to_entry,
    webhook_to_detail,
    webhook_to_summary,
)


class FakeWebhook:
    def __init__(self):
        self.webhookId = "wh-test123"
        self.resourceType = "workflow"
        self.resourceId = "wf-001"
        self.environmentId = "env-001"
        self.enabled = True
        self.description = "Test webhook"
        self.createdAt = datetime(2026, 1, 1, tzinfo=UTC)
        self.updatedAt = datetime(2026, 1, 2, tzinfo=UTC)
        self.lastUsed = datetime(2026, 1, 3, tzinfo=UTC)
        self.usageCount = 5
        self.lastStatus = "success"
        self.token = "secret_real_token_value"
        self.hmacSecret = "hmac_real_secret_value"


class FakeWebhookLog:
    def __init__(self):
        self.logId = "log-abc123"
        self.timestamp = datetime(2026, 1, 15, tzinfo=UTC)
        self.status = "success"
        self.duration = 1500
        self.responseStatus = 202
        self.errorMessage = None
        self.runId = "run-xyz"
        self.collectionRunId = None


class TestWebhookSummary:
    def test_no_credentials_in_summary(self):
        wh = FakeWebhook()
        summary = webhook_to_summary(wh)
        data = summary.model_dump(by_alias=True)
        assert "token" not in data
        assert "hmacSecret" not in data
        assert "token" not in WebhookSummary.model_fields
        assert "hmacSecret" not in WebhookSummary.model_fields

    def test_summary_fields_present(self):
        wh = FakeWebhook()
        summary = webhook_to_summary(wh)
        assert summary.webhook_id == "wh-test123"
        assert summary.resource_type == "workflow"
        assert summary.usage_count == 5


class TestWebhookDetail:
    def test_no_credentials_in_detail(self):
        wh = FakeWebhook()
        detail = webhook_to_detail(wh, "https://api.example.com")
        data = detail.model_dump(by_alias=True)
        assert "token" not in data
        assert "hmacSecret" not in data

    def test_detail_url_constructed(self):
        wh = FakeWebhook()
        detail = webhook_to_detail(wh, "https://api.example.com")
        assert detail.url == "https://api.example.com/api/webhooks/workflows/wh-test123/execute"


class TestWebhookCredentialResponse:
    def test_contains_credentials(self):
        resp = WebhookCredentialResponse(
            webhookId="wh-new",
            url="https://api.example.com/webhook",
            token="secret_new_token",
            hmacSecret="hmac_new_secret",
        )
        assert resp.token == "secret_new_token"
        assert resp.hmac_secret == "hmac_new_secret"
        assert resp.one_time_display is True

    def test_one_time_warning_present(self):
        resp = WebhookCredentialResponse(
            webhookId="wh-new",
            url="https://api.example.com/webhook",
            token="secret_new_token",
            hmacSecret="hmac_new_secret",
        )
        assert "Save" in resp.warning
        assert resp.one_time_display is True


class TestWebhookLogEntry:
    def test_no_sensitive_fields(self):
        log = FakeWebhookLog()
        entry = webhook_log_to_entry(log)
        data = entry.model_dump(by_alias=True)
        assert "requestHeaders" not in data
        assert "requestBody" not in data
        assert "ipAddress" not in data

    def test_log_entry_fields(self):
        log = FakeWebhookLog()
        entry = webhook_log_to_entry(log)
        assert entry.log_id == "log-abc123"
        assert entry.status == "success"
        assert entry.run_id == "run-xyz"
