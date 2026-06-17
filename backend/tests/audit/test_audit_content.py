"""
Task 27 — Audit content tests.

Verifies that audit events contain no secret values in their context,
that every secret resolution has an audit entry, and that the JSON
export is free of secret material.
"""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import AuditEvent, AuditEventCreate, Secret, SecretCreateRequest
from app.repositories.audit_repository import AuditRepository
from app.services import audit_service, secret_service
from app.services.audit_resolver_helper import resolve_secret_with_audit
from app.services.audit_service import (
    _sanitize_context,
    _FORBIDDEN_CONTEXT_KEYS,
    append_event,
    export_json,
    mask_context_values,
)
from app.services.exceptions import AuditWriteUnavailableError
from app.services.secret_utils import SecretMasker

SENTINEL = "NEVER_LEAK_ME_42"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_audit_event(**overrides) -> MagicMock:
    defaults = {
        "eventId": "evt-test-001",
        "actor": "user",
        "actorId": "user-123",
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
        "createdAt": datetime.now(UTC),
    }
    defaults.update(overrides)
    mock = MagicMock()
    for k, v in defaults.items():
        setattr(mock, k, v)
    mock.model_dump = MagicMock(return_value=defaults)
    mock.model_validate = MagicMock(return_value=mock)
    return mock


def _make_mock_secret(**overrides) -> MagicMock:
    defaults = {
        "secret_id": "sec-test-001",
        "name": "API_TOKEN",
        "scope_type": "workspace",
        "scope_id": "ws-001",
        "ciphertext": f"enc-{SENTINEL}",
        "key_id": "kp-test-001",
    }
    defaults.update(overrides)
    now = datetime.now(UTC)
    mock = MagicMock(spec=Secret)
    mock.secretId = defaults["secret_id"]
    mock.name = defaults["name"]
    mock.scopeType = defaults["scope_type"]
    mock.scopeId = defaults["scope_id"]
    mock.ciphertext = defaults["ciphertext"]
    mock.keyId = defaults["key_id"]
    mock.createdAt = now
    mock.updatedAt = now
    return mock


# ---------------------------------------------------------------------------
# Forbidden context keys
# ---------------------------------------------------------------------------


class TestForbiddenContextKeys:
    """_sanitize_context rejects all forbidden keys."""

    @pytest.mark.parametrize("forbidden_key", sorted(_FORBIDDEN_CONTEXT_KEYS))
    def test_each_forbidden_key_rejected(self, forbidden_key):
        with pytest.raises(AuditWriteUnavailableError, match="forbidden secret keys"):
            _sanitize_context({forbidden_key: "any-value"})

    def test_safe_context_passes(self):
        ctx = {"secretName": "API_TOKEN", "keyId": "kp-001", "runId": "run-1"}
        result = _sanitize_context(ctx)
        assert result == ctx

    def test_multiple_forbidden_keys_listed(self):
        """When multiple forbidden keys are present, all are listed in the error."""
        with pytest.raises(AuditWriteUnavailableError) as exc_info:
            _sanitize_context({"value": "x", "ciphertext": "y"})
        error_msg = str(exc_info.value)
        assert "value" in error_msg
        assert "ciphertext" in error_msg


# ---------------------------------------------------------------------------
# Secret create/update/delete audit events
# ---------------------------------------------------------------------------


class TestSecretOperationAuditContent:
    """Audit events for secret CRUD operations contain no secret values."""

    def test_create_audit_has_no_ciphertext_or_value(self):
        """secret_created audit context has only metadata."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _create():
            mock_secret = _make_mock_secret()
            with patch(
                "app.services.secret_service.SecretRepository.count_by_scope",
                new=AsyncMock(return_value=0),
            ), patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(return_value=None),
            ), patch(
                "app.services.secret_service.SecretRepository.create",
                new=AsyncMock(return_value=mock_secret),
            ), patch(
                "app.services.secret_service.append_event",
                side_effect=mock_append,
            ):
                request = SecretCreateRequest(
                    name="MY_TOKEN",
                    ciphertext=f"enc-{SENTINEL}",
                    keyId="kp-001",
                )
                await secret_service.create_secret(
                    scope_type="workspace",
                    scope_id="ws-001",
                    request=request,
                )

        asyncio.run(_create())
        assert captured.get("action") == "secret_created"
        ctx = captured.get("context", {})
        serialized = json.dumps(ctx, default=str)
        assert SENTINEL not in serialized
        assert "ciphertext" not in ctx
        assert "value" not in ctx
        assert "secretName" in ctx
        assert "keyId" in ctx

    def test_update_audit_has_no_ciphertext_or_value(self):
        """secret_updated audit context has only metadata."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _update():
            mock_secret = _make_mock_secret()
            with patch(
                "app.services.secret_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=mock_secret),
            ), patch(
                "app.services.secret_service.SecretRepository.update",
                new=AsyncMock(return_value=mock_secret),
            ), patch(
                "app.services.secret_service.append_event",
                side_effect=mock_append,
            ):
                request = SecretCreateRequest(
                    name="API_TOKEN",
                    ciphertext=f"enc-{SENTINEL}",
                    keyId="kp-002",
                )
                await secret_service.update_secret(
                    secret_id="sec-test-001",
                    request=request,
                )

        asyncio.run(_update())
        assert captured.get("action") == "secret_updated"
        ctx = captured.get("context", {})
        assert SENTINEL not in json.dumps(ctx, default=str)
        assert "ciphertext" not in ctx

    def test_delete_audit_has_no_ciphertext_or_value(self):
        """secret_deleted audit context has only metadata."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _delete():
            mock_secret = _make_mock_secret()
            with patch(
                "app.services.secret_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=mock_secret),
            ), patch(
                "app.services.secret_service.SecretRepository.delete",
                new=AsyncMock(return_value=True),
            ), patch(
                "app.services.secret_service.append_event",
                side_effect=mock_append,
            ):
                await secret_service.delete_secret(secret_id="sec-test-001")

        asyncio.run(_delete())
        assert captured.get("action") == "secret_deleted"
        ctx = captured.get("context", {})
        assert SENTINEL not in json.dumps(ctx, default=str)
        assert "ciphertext" not in ctx


# ---------------------------------------------------------------------------
# Secret resolution audit
# ---------------------------------------------------------------------------


class TestSecretResolutionAudit:
    """Every secret resolution has an audit entry with no secret value."""

    async def test_resolution_records_audit_event(self):
        """resolve_secret_with_audit records an event."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return _make_mock_audit_event()

        with patch("app.services.audit_resolver_helper.append_event", side_effect=mock_append):
            result = await resolve_secret_with_audit(
                actor="user",
                actor_id="user-123",
                scope="workspace",
                scope_id="ws-abc",
                run_id="run-001",
                node_id="httpRequest_1234",
                secret_name="API_TOKEN",
                key_id="key-v1",
                resolved_value=SENTINEL,
            )

        assert result == SENTINEL
        assert captured.get("action") == "secret_resolved"
        ctx = captured.get("context", {})
        assert ctx["secretName"] == "API_TOKEN"
        assert ctx["keyId"] == "key-v1"
        assert ctx["runId"] == "run-001"
        assert SENTINEL not in json.dumps(ctx, default=str)

    async def test_resolution_audit_has_no_value_field(self):
        """The audit context must not contain the resolved value."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return _make_mock_audit_event()

        with patch("app.services.audit_resolver_helper.append_event", side_effect=mock_append):
            await resolve_secret_with_audit(
                actor="user",
                actor_id="user-123",
                scope="workspace",
                scope_id="ws-abc",
                run_id="run-001",
                node_id="node-1",
                secret_name="DB_PASSWORD",
                key_id="key-v2",
                resolved_value=SENTINEL,
            )

        ctx = captured.get("context", {})
        assert "value" not in ctx
        assert "secretValue" not in ctx
        assert "ciphertext" not in ctx
        assert "plaintext" not in ctx
        assert SENTINEL not in str(ctx)

    async def test_resolution_audit_failure_is_fail_closed(self):
        """If audit write fails, the resolver raises (fail-closed)."""
        with patch(
            "app.services.audit_resolver_helper.append_event",
            new_callable=AsyncMock,
            side_effect=AuditWriteUnavailableError("DB down"),
        ):
            with pytest.raises(AuditWriteUnavailableError):
                await resolve_secret_with_audit(
                    actor="user",
                    actor_id="user-123",
                    scope="workspace",
                    scope_id="ws-abc",
                    run_id="run-001",
                    node_id="node-1",
                    secret_name="TOKEN",
                    key_id="key-v1",
                    resolved_value=SENTINEL,
                )


# ---------------------------------------------------------------------------
# JSON export safety
# ---------------------------------------------------------------------------


class TestExportJsonSafety:
    """JSON export contains no secret values."""

    async def test_export_has_no_sentinel_value(self):
        """Export JSON does not contain the sentinel secret value."""
        mock_event = _make_mock_audit_event(
            context={
                "runId": "run-1",
                "secretName": "API_TOKEN",
                "keyId": "key-v1",
            }
        )
        with patch.object(
            AuditRepository, "query",
            new_callable=AsyncMock,
            return_value=([mock_event], 1),
        ):
            export_str = await export_json()
            assert SENTINEL not in export_str

    async def test_export_has_no_forbidden_keys(self):
        """Export JSON does not contain forbidden key names as values."""
        mock_event = _make_mock_audit_event()
        with patch.object(
            AuditRepository, "query",
            new_callable=AsyncMock,
            return_value=([mock_event], 1),
        ):
            export_str = await export_json()
            data = json.loads(export_str)
            export_text = json.dumps(data)
            for forbidden in ["ciphertext", "privateKey", "plaintext"]:
                # These should not appear as context keys
                event_ctx = data["events"][0]["context"]
                assert forbidden not in event_ctx

    async def test_export_structure(self):
        """Export returns valid JSON with events array and count."""
        events = [
            _make_mock_audit_event(eventId="evt-1"),
            _make_mock_audit_event(eventId="evt-2"),
        ]
        with patch.object(
            AuditRepository, "query",
            new_callable=AsyncMock,
            return_value=(events, 2),
        ):
            export_str = await export_json()
            data = json.loads(export_str)
            assert data["count"] == 2
            assert len(data["events"]) == 2


# ---------------------------------------------------------------------------
# Masker defense-in-depth
# ---------------------------------------------------------------------------


class TestMaskerDefenseInDepth:
    """SecretMasker provides defense-in-depth for audit context."""

    def test_masker_catches_accidental_leak(self):
        """If a secret value accidentally appears in context, masker catches it."""
        masker = SecretMasker({"API_TOKEN": SENTINEL})
        raw = {"message": f"Using {SENTINEL} for auth"}
        masked = mask_context_values(raw, masker)
        assert SENTINEL not in masked["message"]

    def test_masker_does_not_affect_safe_context(self):
        """Masker does not alter context that has no secret values."""
        masker = SecretMasker({"API_TOKEN": SENTINEL})
        raw = {"secretName": "API_TOKEN", "keyId": "kp-001"}
        masked = mask_context_values(raw, masker)
        assert masked == raw
