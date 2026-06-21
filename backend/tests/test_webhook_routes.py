"""
Tests for webhook execution route wiring (T6).

Verifies that the execute endpoints call webhook_runner.enqueue() and
return the correct response shape, preserving all security checks.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_lib
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


@pytest.fixture(autouse=True)
def _allow_token_only(monkeypatch):
    monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", False)


def _mock_log(*args, **kwargs):
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=MagicMock())
    mock_log.save = AsyncMock()
    return mock_log


def _enabled_webhook(token: str = "test-token", **kw):
    wh = MagicMock()
    wh.enabled = True
    wh.token = token
    wh.resourceId = kw.get("resourceId", "wf-abc")
    wh.environmentId = kw.get("environmentId", "env-1")
    wh.usageCount = 0
    return wh


def _make_hmac(secret: str, timestamp: str, body: bytes) -> str:
    return hmac_lib.new(secret.encode(), timestamp.encode() + body, hashlib.sha256).hexdigest()


class TestValidDeliveryCreatesRun:
    def test_valid_delivery_creates_run(self):
        """POST with valid token → 202 + runId, enqueue called with WebhookDelivery."""
        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id", return_value=_enabled_webhook()
            ),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=MagicMock()),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_runner.enqueue = AsyncMock(return_value="run-abc123")

            resp = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                json={"ref": "main"},
                headers={"X-Webhook-Token": "test-token"},
            )

        assert resp.status_code == 202
        body = resp.json()
        assert body["runId"] == "run-abc123"
        assert body["status"] == "accepted"

        mock_runner.enqueue.assert_awaited_once()
        delivery = mock_runner.enqueue.call_args.args[0]
        assert delivery.webhook_id == "wh-1"
        assert delivery.resource_type == "workflow"
        assert delivery.resource_id == "wf-abc"


class TestIdempotencyReplay:
    def test_idempotency_replay_returns_same_runId(self):
        """Second POST with same Idempotency-Key → 202, same runId, replayed header."""
        cached = SimpleNamespace(
            response_body={"status": "accepted", "runId": "run-replay-001"},
        )
        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id", return_value=_enabled_webhook()
            ),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=MagicMock()),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
            patch(
                "app.routes.webhooks.get_idempotency_entry",
                new=AsyncMock(side_effect=[None, cached]),
            ),
        ):
            mock_runner.enqueue = AsyncMock(return_value="run-replay-001")
            headers = {"X-Webhook-Token": "test-token", "Idempotency-Key": "key-1"}

            r1 = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                json={"ref": "main"},
                headers=headers,
            )
            assert r1.status_code == 202
            first_run_id = r1.json()["runId"]

            r2 = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                json={"ref": "main"},
                headers=headers,
            )

        assert r2.status_code == 202
        assert r2.json()["runId"] == first_run_id
        assert r2.headers.get("idempotency-replayed") == "true"


class TestMissingToken:
    def test_missing_token_returns_401(self):
        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id", return_value=_enabled_webhook()
            ),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
        ):
            resp = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                json={"ref": "main"},
            )
        assert resp.status_code == 401


class TestInvalidHmac:
    def test_invalid_hmac_returns_401(self, monkeypatch):
        monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", True)
        timestamp = str(int(time.time()))
        body = b'{"ref":"main"}'

        wh = _enabled_webhook()
        wh.hmacSecret = "test-hmac-secret"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=wh),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=wh),
        ):
            resp = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                content=body,
                headers={
                    "X-Webhook-Token": "test-token",
                    "X-Webhook-Signature": "deadbeef" * 8,
                    "X-Webhook-Timestamp": timestamp,
                },
            )
        assert resp.status_code == 401


class TestRateLimit:
    def test_rate_limit_returns_429(self):
        from app.middleware.rate_limiter import _rate_limiter

        webhook_id = "wh-rate-t6"
        max_req = 5
        for _ in range(max_req):
            _rate_limiter.check_rate_limit(webhook_id, max_requests=max_req, window_seconds=3600)

        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id",
                return_value=_enabled_webhook(token="rl-tok"),
            ),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch(
                "app.middleware.rate_limiter._rate_limiter.check_rate_limit",
                return_value=(False, 0, int(time.time()) + 3600),
            ),
        ):
            resp = client.post(
                f"/api/webhooks/workflows/{webhook_id}/execute",
                json={"event": "push"},
                headers={"X-Webhook-Token": "rl-tok"},
            )

        assert resp.status_code == 429
        assert "retry-after" in resp.headers or "Retry-After" in resp.headers


class TestCollectionPath:
    def test_collection_path_creates_collection_run(self):
        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id",
                return_value=_enabled_webhook(resourceId="col-1"),
            ),
            patch("app.routes.webhooks.CollectionRepository.get_by_id", return_value=MagicMock()),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_runner.enqueue = AsyncMock(return_value="crun-xyz789")

            resp = client.post(
                "/api/webhooks/collections/wh-col/execute",
                json={"suite": "regression"},
                headers={"X-Webhook-Token": "test-token"},
            )

        assert resp.status_code == 202
        body = resp.json()
        assert body["collectionRunId"] == "crun-xyz789"
        assert body["status"] == "accepted"

        delivery = mock_runner.enqueue.call_args.args[0]
        assert delivery.resource_type == "collection"
        assert delivery.resource_id == "col-1"


class TestRunMetadata:
    def test_run_has_webhook_metadata(self):
        """enqueue receives a delivery with correct fields for Run metadata."""
        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id", return_value=_enabled_webhook()
            ),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=MagicMock()),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_runner.enqueue = AsyncMock(return_value="run-meta-001")

            client.post(
                "/api/webhooks/workflows/wh-meta/execute",
                json={"key": "val"},
                headers={"X-Webhook-Token": "test-token"},
            )

        delivery = mock_runner.enqueue.call_args.args[0]
        assert delivery.webhook_id == "wh-meta"
        assert delivery.resource_type == "workflow"
        assert delivery.resource_id == "wf-abc"
        assert delivery.environment_id == "env-1"
        assert delivery.payload == {"key": "val"}


class TestQueueFullMapsTo503:
    def test_queue_full_returns_503(self):
        from app.services.webhook_runner import QueueFull

        with (
            patch(
                "app.routes.webhooks.WebhookRepository.get_by_id", return_value=_enabled_webhook()
            ),
            patch("app.routes.webhooks.WorkflowRepository.get_by_id", return_value=MagicMock()),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.routes.webhooks.webhook_runner") as mock_runner,
        ):
            mock_runner.enqueue = AsyncMock(
                side_effect=QueueFull("queue is full (1000). Retry later.")
            )

            resp = client.post(
                "/api/webhooks/workflows/wh-full/execute",
                json={"key": "val"},
                headers={"X-Webhook-Token": "test-token"},
            )

        assert resp.status_code == 503
        assert "retry-after" in resp.headers or "Retry-After" in resp.headers


class TestHmacMissing:
    def test_hmac_missing_returns_401(self, monkeypatch):
        """WEBHOOK_REQUIRE_HMAC=True but no X-Webhook-Signature header → 401."""
        monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", True)

        wh = _enabled_webhook()
        wh.hmacSecret = "test-hmac-secret"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=wh),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
        ):
            resp = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                json={"ref": "main"},
                headers={"X-Webhook-Token": "test-token"},
            )
        assert resp.status_code == 401
        assert (
            "signature" in resp.json()["detail"].lower()
            or "missing" in resp.json()["detail"].lower()
        )


class TestHmacMissingTimestamp:
    def test_hmac_missing_timestamp_returns_401(self, monkeypatch):
        """HMAC signature present but timestamp missing → 401."""
        monkeypatch.setattr("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", True)

        wh = _enabled_webhook()
        wh.hmacSecret = "test-hmac-secret"

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=wh),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
            patch("app.middleware.webhook_auth.WebhookRepository.get_by_id", return_value=wh),
        ):
            resp = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                content=b'{"ref":"main"}',
                headers={
                    "X-Webhook-Token": "test-token",
                    "X-Webhook-Signature": "deadbeef" * 8,
                },
            )
        assert resp.status_code == 401
        assert (
            "timestamp" in resp.json()["detail"].lower()
            or "missing" in resp.json()["detail"].lower()
        )


class TestDisabledWebhook:
    def test_disabled_webhook_returns_403(self):
        """Webhook exists but enabled=False → 403."""
        wh = _enabled_webhook()
        wh.enabled = False

        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=wh),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
        ):
            resp = client.post(
                "/api/webhooks/workflows/wh-1/execute",
                json={"ref": "main"},
                headers={"X-Webhook-Token": "test-token"},
            )
        assert resp.status_code == 403
        assert "disabled" in resp.json()["detail"].lower()


class TestWebhookNotFound:
    def test_webhook_not_found_returns_404(self):
        """Webhook ID doesn't exist → 404."""
        with (
            patch("app.routes.webhooks.WebhookRepository.get_by_id", return_value=None),
            patch("app.routes.webhooks.WebhookLog", side_effect=_mock_log),
        ):
            resp = client.post(
                "/api/webhooks/workflows/nonexistent-wh/execute",
                json={"ref": "main"},
                headers={"X-Webhook-Token": "test-token"},
            )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
