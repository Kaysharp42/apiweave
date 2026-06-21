"""
Tests for the audit API routes (Wave 4, Task 25).

Covers:
- GET /api/audit/events — paginated listing with filters, requires auth
- GET /api/audit/events/export — JSON download, requires auth
- No secret values leak in list or export responses
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.audit import router as audit_router

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_user() -> MagicMock:
    """Build a MagicMock User for auth dependency override (avoids Beanie init)."""
    user = MagicMock()
    user.userId = "user-test-001"
    user.verified_email = "test@example.com"
    user.display_name = "Test User"
    user.roles = ["member"]
    user.permissions = []
    return user


def _make_audit_event_response(**overrides: object) -> dict:
    """Build a minimal AuditEventResponse dict for test data."""
    defaults = {
        "eventId": "evt-test-001",
        "actor": "user",
        "actorId": "user-test-001",
        "action": "secret_resolved",
        "scope": "workspace",
        "scopeId": "ws-abc",
        "resourceType": "secret",
        "resourceId": "API_TOKEN",
        "context": {
            "runId": "run-001",
            "nodeId": "httpRequest_1234",
            "secretName": "API_TOKEN",
            "keyId": "key-v1",
        },
        "createdAt": "2026-01-15T10:30:00Z",
    }
    defaults.update(overrides)
    return defaults


def _build_app() -> FastAPI:
    """Build a test app with audit router and auth override."""
    app = FastAPI()
    app.include_router(audit_router)

    # Override auth dependency to return a mock user
    async def _override_auth():
        return _make_mock_user()

    from app.auth.dependencies import get_current_active_user

    app.dependency_overrides[get_current_active_user] = _override_auth
    return app


client = TestClient(_build_app())


# ---------------------------------------------------------------------------
# GET /api/audit/events — listing
# ---------------------------------------------------------------------------


class TestListAuditEvents:
    """Tests for the paginated audit event listing endpoint."""

    def test_requires_auth(self):
        """Endpoint returns 401 when no auth is provided."""
        # Build app WITHOUT auth override
        app = FastAPI()
        app.include_router(audit_router)
        unauth_client = TestClient(app)
        response = unauth_client.get("/api/audit/events")
        assert response.status_code == 401

    def test_returns_empty_list(self):
        """Returns empty list when no events exist."""
        with patch(
            "app.routes.audit.audit_service.get_events",
            new_callable=AsyncMock,
            return_value=([], 0),
        ):
            response = client.get("/api/audit/events")
            assert response.status_code == 200
            data = response.json()
            assert data["events"] == []
            assert data["total"] == 0
            assert data["skip"] == 0
            assert data["limit"] == 100

    def test_returns_events_with_pagination(self):
        """Returns events with correct pagination metadata."""
        events = [
            _make_audit_event_response(eventId="evt-1"),
            _make_audit_event_response(eventId="evt-2"),
        ]
        with patch(
            "app.routes.audit.audit_service.get_events",
            new_callable=AsyncMock,
            return_value=(events, 50),
        ):
            response = client.get("/api/audit/events?skip=10&limit=2")
            assert response.status_code == 200
            data = response.json()
            assert len(data["events"]) == 2
            assert data["total"] == 50
            assert data["skip"] == 10
            assert data["limit"] == 2

    def test_filters_passed_to_service(self):
        """Query parameters are forwarded to the audit service."""
        with patch(
            "app.routes.audit.audit_service.get_events",
            new_callable=AsyncMock,
            return_value=([], 0),
        ) as mock_get:
            client.get(
                "/api/audit/events?actor=user&action=secret_resolved&scope=workspace&resourceType=secret"
            )
            mock_get.assert_called_once()
            call_kwargs = mock_get.call_args.kwargs
            assert call_kwargs["actor"] == "user"
            assert call_kwargs["action"] == "secret_resolved"
            assert call_kwargs["scope"] == "workspace"
            assert call_kwargs["resource_type"] == "secret"

    def test_limit_capped_at_500(self):
        """Limit parameter is capped at 500."""
        with patch(
            "app.routes.audit.audit_service.get_events",
            new_callable=AsyncMock,
            return_value=([], 0),
        ):
            response = client.get("/api/audit/events?limit=1000")
            # FastAPI should reject limit > 500
            assert response.status_code == 422

    def test_skip_must_be_non_negative(self):
        """Skip parameter must be >= 0."""
        response = client.get("/api/audit/events?skip=-1")
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/audit/events/export — JSON download
# ---------------------------------------------------------------------------


class TestExportAuditEvents:
    """Tests for the JSON export endpoint."""

    def test_requires_auth(self):
        """Export endpoint returns 401 when no auth is provided."""
        app = FastAPI()
        app.include_router(audit_router)
        unauth_client = TestClient(app)
        response = unauth_client.get("/api/audit/events/export")
        assert response.status_code == 401

    def test_returns_json_with_content_disposition(self):
        """Export returns JSON with Content-Disposition header."""
        export_data = json.dumps({"events": [], "count": 0})
        with patch(
            "app.routes.audit.audit_service.export_json",
            new_callable=AsyncMock,
            return_value=export_data,
        ):
            response = client.get("/api/audit/events/export")
            assert response.status_code == 200
            assert "attachment" in response.headers.get("content-disposition", "")
            assert "audit-events.json" in response.headers.get("content-disposition", "")

    def test_export_contains_events(self):
        """Export returns the events from the service."""
        events = [_make_audit_event_response(eventId="evt-export-1")]
        export_data = json.dumps({"events": events, "count": 1})
        with patch(
            "app.routes.audit.audit_service.export_json",
            new_callable=AsyncMock,
            return_value=export_data,
        ):
            response = client.get("/api/audit/events/export")
            assert response.status_code == 200
            data = response.json()
            assert data["count"] == 1
            assert len(data["events"]) == 1
            assert data["events"][0]["eventId"] == "evt-export-1"

    def test_export_filters_passed(self):
        """Export query parameters are forwarded to the service."""
        with patch(
            "app.routes.audit.audit_service.export_json",
            new_callable=AsyncMock,
            return_value=json.dumps({"events": [], "count": 0}),
        ) as mock_export:
            client.get("/api/audit/events/export?action=secret_created&scope=org")
            mock_export.assert_called_once()
            call_kwargs = mock_export.call_args.kwargs
            assert call_kwargs["action"] == "secret_created"
            assert call_kwargs["scope"] == "org"


# ---------------------------------------------------------------------------
# No secret value leak
# ---------------------------------------------------------------------------


class TestNoSecretLeak:
    """Verify that no secret values, ciphertext, or private keys appear in responses."""

    FORBIDDEN_KEYS = {
        "value",
        "secretValue",
        "secret_value",
        "plaintext",
        "ciphertext",
        "privateKey",
        "private_key",
        "encryptedValue",
        "encrypted_value",
        "kek",
        "dek",
        "token",
        "hmacSecret",
        "hmac_secret",
        "password",
        "apiKey",
        "api_key",
    }

    def test_list_response_has_no_forbidden_context_keys(self):
        """Listed events must not contain forbidden secret keys in context."""
        safe_event = _make_audit_event_response(
            context={
                "runId": "run-001",
                "nodeId": "node-1",
                "secretName": "DB_PASSWORD",
                "keyId": "key-v2",
            }
        )
        with patch(
            "app.routes.audit.audit_service.get_events",
            new_callable=AsyncMock,
            return_value=([safe_event], 1),
        ):
            response = client.get("/api/audit/events")
            data = response.json()
            event_ctx = data["events"][0]["context"]

            leaked = self.FORBIDDEN_KEYS & set(event_ctx.keys())
            assert not leaked, f"Forbidden keys found in context: {leaked}"

    def test_export_response_has_no_forbidden_context_keys(self):
        """Exported events must not contain forbidden secret keys in context."""
        safe_event = _make_audit_event_response(
            context={
                "runId": "run-001",
                "secretName": "API_KEY",
                "keyId": "key-v1",
            }
        )
        export_data = json.dumps({"events": [safe_event], "count": 1})
        with patch(
            "app.routes.audit.audit_service.export_json",
            new_callable=AsyncMock,
            return_value=export_data,
        ):
            response = client.get("/api/audit/events/export")
            data = response.json()
            event_ctx = data["events"][0]["context"]

            leaked = self.FORBIDDEN_KEYS & set(event_ctx.keys())
            assert not leaked, f"Forbidden keys found in export context: {leaked}"

    def test_no_secret_values_in_response_body(self):
        """Known secret values must not appear anywhere in the response text."""
        safe_event = _make_audit_event_response(
            context={"secretName": "DB_PASSWORD", "keyId": "key-v1"}
        )
        with patch(
            "app.routes.audit.audit_service.get_events",
            new_callable=AsyncMock,
            return_value=([safe_event], 1),
        ):
            response = client.get("/api/audit/events")
            response_text = response.text

            secret_values = [
                "super-secret-value",
                "password123",
                "ciphertext-blob",
                "private-key-data",
            ]
            for val in secret_values:
                assert val not in response_text, f"Secret value '{val}' found in response body"
