"""
Tests for webhook HMAC production warning and MAX_WEBHOOK_BODY_SIZE enforcement.
Task 12 of security-remediation plan.
"""

import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes.webhooks import _require_hmac_when_configured

client = TestClient(app)


@pytest.fixture(autouse=True)
def _allow_token_only_webhooks(monkeypatch):
    monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", False)


def _mock_webhook_log(*args, **kwargs):
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    return mock_log


def _enabled_webhook(token: str = "test-token"):
    wh = MagicMock()
    wh.enabled = True
    wh.token = token
    return wh


class TestBodySizeEnforcement:
    """MAX_WEBHOOK_BODY_SIZE checks on workflow and collection endpoints."""

    def test_workflow_webhook_oversized_body_returns_413(self, monkeypatch):
        monkeypatch.setattr("app.routes.webhooks.settings.MAX_WEBHOOK_BODY_SIZE", 100)

        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id",
                return_value=_enabled_webhook(),
            ),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        ):
            oversized = b"x" * 200
            response = client.post(
                "/api/webhooks/workflows/wh-123/execute",
                content=oversized,
                headers={
                    "X-Webhook-Token": "test-token",
                    "Content-Type": "application/json",
                },
            )
            assert response.status_code == 413
            assert "too large" in response.json()["detail"].lower()

    def test_workflow_webhook_small_body_not_rejected(self, monkeypatch):
        monkeypatch.setattr("app.routes.webhooks.settings.MAX_WEBHOOK_BODY_SIZE", 1_000_000)

        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id",
                return_value=_enabled_webhook(),
            ),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=None),
        ):
            small_body = b'{"small": true}'
            response = client.post(
                "/api/webhooks/workflows/wh-123/execute",
                content=small_body,
                headers={
                    "X-Webhook-Token": "test-token",
                    "Content-Type": "application/json",
                },
            )
            assert response.status_code != 413

    def test_collection_webhook_oversized_body_returns_413(self, monkeypatch):
        monkeypatch.setattr("app.routes.webhooks.settings.MAX_WEBHOOK_BODY_SIZE", 100)

        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id",
                return_value=_enabled_webhook(),
            ),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
        ):
            oversized = b"x" * 200
            response = client.post(
                "/api/webhooks/collections/wh-456/execute",
                content=oversized,
                headers={
                    "X-Webhook-Token": "test-token",
                    "Content-Type": "application/json",
                },
            )
            assert response.status_code == 413
            assert "too large" in response.json()["detail"].lower()


class TestProductionHMACWarning:
    """Production warning when WEBHOOK_REQUIRE_HMAC=false."""

    @pytest.mark.asyncio
    async def test_production_no_hmac_emits_warning(self, monkeypatch, caplog):
        monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", False)
        monkeypatch.setattr("app.routes.webhooks.settings.APP_ENV", "production")

        with caplog.at_level(logging.WARNING, logger="app.routes.webhooks"):
            await _require_hmac_when_configured("wh-test", None, None, b"body")

        assert any("PRODUCTION WARNING" in record.message for record in caplog.records)
        assert any(record.levelno == logging.WARNING for record in caplog.records)

    @pytest.mark.asyncio
    async def test_development_no_hmac_no_warning(self, monkeypatch, caplog):
        monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", False)
        monkeypatch.setattr("app.routes.webhooks.settings.APP_ENV", "development")

        with caplog.at_level(logging.WARNING, logger="app.routes.webhooks"):
            await _require_hmac_when_configured("wh-test", None, None, b"body")

        assert not any("PRODUCTION WARNING" in record.message for record in caplog.records)

    @pytest.mark.asyncio
    async def test_require_hmac_enabled_raises_without_signature(self, monkeypatch):
        monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", True)

        with patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log):
            from fastapi import HTTPException

            with pytest.raises(HTTPException) as exc_info:
                await _require_hmac_when_configured("wh-test", None, None, b"body")
            assert exc_info.value.status_code == 401
