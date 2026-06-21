"""
Tests for the append-only audit event infrastructure (Wave 1, Tasks 4a-4c).

Covers:
- Secret resolution records an audit event with metadata only (no secret values).
- Audit write failure causes the resolver helper to raise AuditWriteUnavailableError.
- JSON export contains no secret values.
"""

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import AuditEvent, AuditEventCreate
from app.repositories.audit_repository import AuditRepository
from app.services.audit_resolver_helper import resolve_secret_with_audit
from app.services.audit_service import append_event, export_json, get_events
from app.services.exceptions import AuditWriteUnavailableError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_audit_event_create(**overrides: object) -> AuditEventCreate:
    """Build a minimal AuditEventCreate for testing (Pydantic model, no Beanie init needed)."""
    defaults = {
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
    }
    defaults.update(overrides)
    return AuditEventCreate(**defaults)


def _make_mock_audit_event(**overrides: object) -> MagicMock:
    """Build a MagicMock AuditEvent for tests that need document-like objects."""
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


# ---------------------------------------------------------------------------
# 4a: AuditEvent model
# ---------------------------------------------------------------------------


class TestAuditEventModel:
    """Verify the AuditEvent Beanie document shape and constraints."""

    def test_model_has_required_fields(self):
        event = _make_audit_event_create()
        assert event.actor == "user"
        assert event.actorId == "user-123"
        assert event.action == "secret_resolved"
        assert event.scope == "workspace"
        assert event.scopeId == "ws-abc"
        assert event.resourceType == "secret"
        assert event.resourceId == "API_TOKEN"
        assert isinstance(event.context, dict)

    def test_actor_type_validation(self):
        for actor_type in [
            "user",
            "org_app",
            "service_token",
            "mcp_client",
            "webhook_token",
            "system_migration",
        ]:
            event = _make_audit_event_create(actor=actor_type)
            assert event.actor == actor_type

    def test_invalid_actor_type_rejected(self):
        with pytest.raises(Exception):
            _make_audit_event_create(actor="invalid_actor")

    def test_scope_type_validation(self):
        for scope_type in ["org", "workspace", "environment"]:
            event = _make_audit_event_create(scope=scope_type)
            assert event.scope == scope_type

    def test_invalid_scope_type_rejected(self):
        with pytest.raises(Exception):
            _make_audit_event_create(scope="invalid_scope")

    def test_compound_unique_index_defined(self):
        """The Settings.indexes must include the (actor, actorId, eventId) compound unique index."""
        index_models = AuditEvent.Settings.indexes
        compound_found = False
        for idx in index_models:
            doc = idx.document
            keys = doc.get("key", {}) if isinstance(doc, dict) else {}
            if (
                ("actor", 1) in list(keys.items())
                and ("actorId", 1) in list(keys.items())
                and ("eventId", 1) in list(keys.items())
            ):
                assert doc.get("unique") is True or idx.kwargs.get("unique") is True
                compound_found = True
        assert compound_found, "Compound unique index on (actor, actorId, eventId) not found"


# ---------------------------------------------------------------------------
# 4b: AuditRepository — append-only
# ---------------------------------------------------------------------------


class TestAuditRepository:
    """Verify the repository is append-only (no update/delete methods)."""

    def test_repository_has_append(self):
        assert hasattr(AuditRepository, "append")

    def test_repository_has_query(self):
        assert hasattr(AuditRepository, "query")

    def test_repository_has_no_update(self):
        assert not hasattr(AuditRepository, "update")
        assert not hasattr(AuditRepository, "update_by_id")

    def test_repository_has_no_delete(self):
        assert not hasattr(AuditRepository, "delete")
        assert not hasattr(AuditRepository, "delete_by_id")
        assert not hasattr(AuditRepository, "purge")

    async def test_append_calls_insert(self):
        event_data = AuditEventCreate(
            actor="user",
            actorId="user-1",
            action="test_action",
            scope="workspace",
            scopeId="ws-1",
            resourceType="workflow",
            resourceId="wf-1",
            context={"key": "val"},
        )
        mock_instance = MagicMock()
        mock_instance.eventId = "generated-uuid"
        mock_instance.insert = AsyncMock(return_value=mock_instance)

        with patch("app.repositories.audit_repository.AuditEvent", return_value=mock_instance):
            with patch("app.repositories.audit_repository.uuid") as mock_uuid:
                mock_uuid.uuid4.return_value = "generated-uuid"
                result = await AuditRepository.append(event_data)
                assert result.eventId == "generated-uuid"
                mock_instance.insert.assert_called_once()

    async def test_query_returns_events_and_count(self):
        """Query returns events and total count from the repository."""
        mock_event = _make_mock_audit_event()
        mock_find = MagicMock()
        mock_find.count = AsyncMock(return_value=1)
        mock_find.sort = MagicMock(return_value=mock_find)
        mock_find.skip = MagicMock(return_value=mock_find)
        mock_find.limit = MagicMock(return_value=mock_find)
        mock_find.to_list = AsyncMock(return_value=[mock_event])

        # Mock both find (with filters) and find_all (no filters)
        with patch.object(AuditEvent, "find", return_value=mock_find):
            with patch.object(AuditEvent, "find_all", return_value=mock_find):
                # Mock the field comparison operators
                with patch.object(AuditEvent, "action", create=True):
                    with patch.object(AuditEvent, "actor", create=True):
                        with patch.object(AuditEvent, "scope", create=True):
                            with patch.object(AuditEvent, "scopeId", create=True):
                                with patch.object(AuditEvent, "resourceType", create=True):
                                    with patch.object(AuditEvent, "resourceId", create=True):
                                        with patch.object(AuditEvent, "createdAt", create=True):
                                            events, total = await AuditRepository.query(
                                                action="secret_resolved"
                                            )
                                            assert total == 1
                                            assert len(events) == 1


# ---------------------------------------------------------------------------
# 4c: AuditService — append_event, get_events, export_json
# ---------------------------------------------------------------------------


class TestAuditService:
    """Verify audit service methods."""

    async def test_append_event_sanitizes_context(self):
        mock_event = _make_mock_audit_event()
        with patch.object(
            AuditRepository, "append", new_callable=AsyncMock, return_value=mock_event
        ):
            result = await append_event(
                actor="user",
                actor_id="user-1",
                action="test",
                scope="workspace",
                scope_id="ws-1",
                resource_type="workflow",
                resource_id="wf-1",
                context={"safe_key": "safe_value"},
            )
            assert result.eventId == "evt-test-001"

    async def test_append_event_rejects_secret_keys_in_context(self):
        """Context containing secret value keys must be rejected."""
        for forbidden_key in ["value", "ciphertext", "privateKey", "password", "apiKey"]:
            with pytest.raises(AuditWriteUnavailableError, match="forbidden secret keys"):
                await append_event(
                    actor="user",
                    actor_id="user-1",
                    action="test",
                    scope="workspace",
                    scope_id="ws-1",
                    resource_type="secret",
                    resource_id="s-1",
                    context={forbidden_key: "should-not-be-here"},
                )

    async def test_append_event_raises_on_write_failure(self):
        """Write failure must raise AuditWriteUnavailableError for fail-closed."""
        with patch.object(
            AuditRepository,
            "append",
            new_callable=AsyncMock,
            side_effect=Exception("DB connection lost"),
        ):
            with pytest.raises(AuditWriteUnavailableError, match="Audit write failed"):
                await append_event(
                    actor="user",
                    actor_id="user-1",
                    action="test",
                    scope="workspace",
                    scope_id="ws-1",
                    resource_type="workflow",
                    resource_id="wf-1",
                )

    async def test_get_events_returns_response_dtos(self):
        mock_event = _make_mock_audit_event()
        with patch.object(
            AuditRepository,
            "query",
            new_callable=AsyncMock,
            return_value=([mock_event], 1),
        ):
            events, total = await get_events(action="secret_resolved")
            assert total == 1
            assert len(events) == 1

    async def test_export_json_contains_no_secret_values(self):
        """JSON export must contain event metadata but no secret values."""
        mock_event = _make_mock_audit_event()
        with patch.object(
            AuditRepository,
            "query",
            new_callable=AsyncMock,
            return_value=([mock_event], 1),
        ):
            export_str = await export_json()
            export_data = json.loads(export_str)

            assert export_data["count"] == 1
            assert len(export_data["events"]) == 1

            event_json = export_data["events"][0]
            assert event_json["eventId"] == "evt-test-001"
            assert event_json["actor"] == "user"
            assert event_json["action"] == "secret_resolved"

            # Context should have metadata only
            ctx = event_json["context"]
            assert "runId" in ctx
            assert "nodeId" in ctx
            assert "secretName" in ctx
            assert "keyId" in ctx

            # No secret values in export
            export_text = json.dumps(export_data)
            for forbidden in ["super-secret-value", "ciphertext", "privateKey"]:
                assert forbidden not in export_text


# ---------------------------------------------------------------------------
# Secret resolution audit integration
# ---------------------------------------------------------------------------


class TestSecretResolutionAudit:
    """
    Every secret resolution records an event with actor, scope, runId, nodeId,
    secretName, keyId — but no value/ciphertext/privateKey field.
    """

    async def test_secret_resolution_records_audit_event(self):
        """Resolver must record an audit event with metadata only."""
        captured_context: dict = {}

        async def mock_append_event(**kwargs: object) -> MagicMock:
            captured_context.update(kwargs.get("context", {}))  # type: ignore[arg-type]
            captured_context["actor"] = kwargs.get("actor")  # type: ignore[assignment]
            captured_context["actor_id"] = kwargs.get("actor_id")  # type: ignore[assignment]
            captured_context["action"] = kwargs.get("action")  # type: ignore[assignment]
            captured_context["scope"] = kwargs.get("scope")  # type: ignore[assignment]
            captured_context["scope_id"] = kwargs.get("scope_id")  # type: ignore[assignment]
            return _make_mock_audit_event()

        with patch(
            "app.services.audit_resolver_helper.append_event", side_effect=mock_append_event
        ):
            result = await resolve_secret_with_audit(
                actor="user",
                actor_id="user-123",
                scope="workspace",
                scope_id="ws-abc",
                run_id="run-001",
                node_id="httpRequest_1234",
                secret_name="API_TOKEN",
                key_id="key-v1",
                resolved_value="super-secret-value",
            )

            assert result == "super-secret-value"
            assert captured_context["actor"] == "user"
            assert captured_context["actor_id"] == "user-123"
            assert captured_context["action"] == "secret_resolved"
            assert captured_context["scope"] == "workspace"
            assert captured_context["scope_id"] == "ws-abc"

            # Context has metadata
            assert captured_context["runId"] == "run-001"
            assert captured_context["nodeId"] == "httpRequest_1234"
            assert captured_context["secretName"] == "API_TOKEN"
            assert captured_context["keyId"] == "key-v1"

    async def test_secret_resolution_audit_has_no_secret_value(self):
        """The audit context must NEVER contain the resolved secret value."""
        captured_kwargs: dict = {}

        async def mock_append_event(**kwargs: object) -> MagicMock:
            captured_kwargs.update(kwargs)
            return _make_mock_audit_event()

        with patch(
            "app.services.audit_resolver_helper.append_event", side_effect=mock_append_event
        ):
            await resolve_secret_with_audit(
                actor="user",
                actor_id="user-123",
                scope="workspace",
                scope_id="ws-abc",
                run_id="run-001",
                node_id="httpRequest_1234",
                secret_name="API_TOKEN",
                key_id="key-v1",
                resolved_value="super-secret-value",
            )

            context = captured_kwargs.get("context", {})
            # No secret value in context
            assert "value" not in context
            assert "secretValue" not in context
            assert "ciphertext" not in context
            assert "privateKey" not in context
            assert "super-secret-value" not in str(context)

    async def test_audit_write_failure_raises_fail_closed(self):
        """Audit write failure must cause the resolver to raise AuditWriteUnavailableError."""
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
                    node_id="httpRequest_1234",
                    secret_name="API_TOKEN",
                    key_id="key-v1",
                    resolved_value="super-secret-value",
                )


# ---------------------------------------------------------------------------
# JSON export safety
# ---------------------------------------------------------------------------


class TestExportJsonSafety:
    """JSON export contains no secret values."""

    async def test_export_json_structure(self):
        """Export returns valid JSON with events array and count."""
        events = [
            _make_mock_audit_event(eventId="evt-1"),
            _make_mock_audit_event(eventId="evt-2"),
        ]
        with patch.object(
            AuditRepository,
            "query",
            new_callable=AsyncMock,
            return_value=(events, 2),
        ):
            export_str = await export_json()
            data = json.loads(export_str)
            assert data["count"] == 2
            assert len(data["events"]) == 2
            assert data["events"][0]["eventId"] == "evt-1"
            assert data["events"][1]["eventId"] == "evt-2"

    async def test_export_json_no_forbidden_fields(self):
        """No forbidden secret fields appear anywhere in the export."""
        event = _make_mock_audit_event(
            context={
                "runId": "run-1",
                "nodeId": "node-1",
                "secretName": "DB_PASSWORD",
                "keyId": "key-v2",
            }
        )
        with patch.object(
            AuditRepository,
            "query",
            new_callable=AsyncMock,
            return_value=([event], 1),
        ):
            export_str = await export_json()
            data = json.loads(export_str)
            export_text = json.dumps(data)

            forbidden_values = [
                "super-secret",
                "password123",
                "ciphertext-blob",
                "private-key-data",
            ]
            for val in forbidden_values:
                assert val not in export_text

            # Context has only metadata
            ctx = data["events"][0]["context"]
            assert set(ctx.keys()) == {"runId", "nodeId", "secretName", "keyId"}
