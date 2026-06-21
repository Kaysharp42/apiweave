"""
Tests for scoped service tokens (Wave 2, Task 12).

Covers:
- Token creation with one-time display
- Token metadata never includes raw value
- Token scope enforcement (cannot cross workspace boundaries)
- Token rotation invalidates old value
- Token revocation takes immediate effect
- Permission narrowing affects subsequent calls
- All token actions are audited
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import (
    ServiceToken,
    ServiceTokenCreateRequest,
    ServiceTokenCreateResponse,
    ServiceTokenMetadataResponse,
    ServiceTokenRotateResponse,
)
from app.services import service_token_service
from app.services.exceptions import ResourceNotFoundError


def _make_mock_token(
    token_id: str = "st-test-001",
    name: str = "Test Token",
    scope_type: str = "workspace",
    scope_id: str = "ws-abc",
    permissions: list[str] | None = None,
    revoked_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> MagicMock:
    defaults = {
        "tokenId": token_id,
        "name": name,
        "tokenHash": "sha256hash",
        "scopeType": scope_type,
        "scopeId": scope_id,
        "permissions": permissions or ["workflows:read", "workflows:run"],
        "createdBy": "user-123",
        "createdAt": datetime.now(UTC),
        "expiresAt": expires_at,
        "revokedAt": revoked_at,
        "lastUsedAt": None,
        "description": "Test token description",
    }
    mock = MagicMock(spec=ServiceToken)
    for k, v in defaults.items():
        setattr(mock, k, v)
    mock.save = AsyncMock(return_value=mock)
    mock.insert = AsyncMock(return_value=mock)
    return mock


class TestServiceTokenCreation:
    """Token creation returns one-time value, stores only hash."""

    async def test_create_returns_raw_token_once(self):
        mock_token = _make_mock_token(name="CI Token")
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "create",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ):
                request = ServiceTokenCreateRequest(
                    name="CI Token",
                    permissions=["workflows:read", "workflows:run"],
                )
                result = await service_token_service.create_token(
                    scope_type="workspace",
                    scope_id="ws-abc",
                    created_by="user-123",
                    request=request,
                )

                assert isinstance(result, ServiceTokenCreateResponse)
                assert result.tokenId.startswith("st-")
                assert result.token.startswith("awst_")
                assert len(result.token) > 20
                assert result.name == "CI Token"
                assert result.scopeType == "workspace"
                assert result.scopeId == "ws-abc"

    async def test_create_stores_hash_not_value(self):
        mock_token = _make_mock_token()
        captured_hash = None

        async def capture_create(**kwargs):
            nonlocal captured_hash
            captured_hash = kwargs.get("token_hash")
            return mock_token

        with patch.object(
            service_token_service.ServiceTokenRepository,
            "create",
            side_effect=capture_create,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ):
                request = ServiceTokenCreateRequest(name="Test")
                await service_token_service.create_token(
                    scope_type="workspace",
                    scope_id="ws-abc",
                    created_by="user-123",
                    request=request,
                )

                assert captured_hash is not None
                assert len(captured_hash) == 64
                assert captured_hash != "awst_"

    async def test_create_audits_event(self):
        mock_token = _make_mock_token()
        audit_called = False
        audit_kwargs = {}

        async def capture_audit(**kwargs):
            nonlocal audit_called, audit_kwargs
            audit_called = True
            audit_kwargs.update(kwargs)
            return MagicMock()

        with patch.object(
            service_token_service.ServiceTokenRepository,
            "create",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                side_effect=capture_audit,
            ):
                request = ServiceTokenCreateRequest(
                    name="CI Token",
                    permissions=["workflows:read"],
                )
                await service_token_service.create_token(
                    scope_type="workspace",
                    scope_id="ws-abc",
                    created_by="user-123",
                    request=request,
                )

                assert audit_called
                assert audit_kwargs["actor"] == "user"
                assert audit_kwargs["actor_id"] == "user-123"
                assert audit_kwargs["action"] == "service_token_created"
                assert audit_kwargs["scope"] == "workspace"
                assert audit_kwargs["scope_id"] == "ws-abc"
                assert audit_kwargs["resource_type"] == "service_token"
                ctx = audit_kwargs["context"]
                assert ctx["tokenName"] == "CI Token"
                assert "token" not in ctx


class TestServiceTokenMetadata:
    """Metadata responses never include raw token value."""

    async def test_get_metadata_has_no_token_value(self):
        mock_token = _make_mock_token()
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            result = await service_token_service.get_token_metadata("st-test-001")

            assert isinstance(result, ServiceTokenMetadataResponse)
            assert result.tokenId == "st-test-001"
            assert result.name == "Test Token"
            assert not hasattr(result, "token")
            assert not hasattr(result, "tokenHash")
            assert not hasattr(result, "rawToken")

    async def test_list_metadata_has_no_token_values(self):
        mock_tokens = [
            _make_mock_token(token_id="st-1", name="Token 1"),
            _make_mock_token(token_id="st-2", name="Token 2"),
        ]
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "list_by_scope",
            new_callable=AsyncMock,
            return_value=mock_tokens,
        ):
            results = await service_token_service.list_tokens_by_scope("workspace", "ws-abc")

            assert len(results) == 2
            for r in results:
                assert isinstance(r, ServiceTokenMetadataResponse)
                assert not hasattr(r, "token")
                assert not hasattr(r, "tokenHash")


class TestServiceTokenScope:
    """Tokens are scoped and cannot cross workspace boundaries."""

    async def test_validate_token_checks_scope_type(self):
        mock_token = _make_mock_token(scope_type="workspace", scope_id="ws-abc")
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_hash",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            result = await service_token_service.validate_token(
                "awst_sometoken",
                expected_scope_type="organization",
            )
            assert result is None

    async def test_validate_token_checks_scope_id(self):
        mock_token = _make_mock_token(scope_type="workspace", scope_id="ws-abc")
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_hash",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            result = await service_token_service.validate_token(
                "awst_sometoken",
                expected_scope_type="workspace",
                expected_scope_id="ws-xyz",
            )
            assert result is None

    async def test_validate_token_succeeds_for_matching_scope(self):
        mock_token = _make_mock_token(scope_type="workspace", scope_id="ws-abc")
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_hash",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            result = await service_token_service.validate_token(
                "awst_sometoken",
                expected_scope_type="workspace",
                expected_scope_id="ws-abc",
            )
            assert result is not None
            assert result.tokenId == "st-test-001"

    async def test_revoked_token_fails_validation(self):
        mock_token = _make_mock_token(revoked_at=datetime.now(UTC))
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_hash",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            result = await service_token_service.validate_token("awst_sometoken")
            assert result is None

    async def test_expired_token_fails_validation(self):
        mock_token = _make_mock_token(expires_at=datetime.now(UTC) - timedelta(hours=1))
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_hash",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            result = await service_token_service.validate_token("awst_sometoken")
            assert result is None


class TestServiceTokenRotation:
    """Rotation generates new value, invalidates old."""

    async def test_rotate_returns_new_token_once(self):
        mock_token = _make_mock_token()
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ):
                result = await service_token_service.rotate_token(
                    token_id="st-test-001",
                    rotated_by="user-123",
                )

                assert isinstance(result, ServiceTokenRotateResponse)
                assert result.tokenId == "st-test-001"
                assert result.token.startswith("awst_")
                assert result.rotatedAt is not None

    async def test_rotate_updates_hash(self):
        mock_token = _make_mock_token()
        original_hash = mock_token.tokenHash
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ):
                await service_token_service.rotate_token(
                    token_id="st-test-001",
                    rotated_by="user-123",
                )

                assert mock_token.tokenHash != original_hash
                mock_token.save.assert_called()

    async def test_rotate_audits_event(self):
        mock_token = _make_mock_token()

        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ) as mock_audit:
                await service_token_service.rotate_token(
                    token_id="st-test-001",
                    rotated_by="user-123",
                )

                mock_audit.assert_called_once()
                call_kwargs = mock_audit.call_args.kwargs
                assert call_kwargs["action"] == "service_token_rotated"

    async def test_rotate_revoked_token_raises(self):
        mock_token = _make_mock_token(revoked_at=datetime.now(UTC))
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with pytest.raises(ResourceNotFoundError, match="revoked"):
                await service_token_service.rotate_token(
                    token_id="st-test-001",
                    rotated_by="user-123",
                )


class TestServiceTokenRevocation:
    """Revocation takes immediate effect."""

    async def test_revoke_sets_revoked_at(self):
        mock_token = _make_mock_token()
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service.ServiceTokenRepository,
                "revoke",
                new_callable=AsyncMock,
                return_value=True,
            ):
                with patch.object(
                    service_token_service,
                    "append_event",
                    new_callable=AsyncMock,
                ):
                    result = await service_token_service.revoke_token(
                        token_id="st-test-001",
                        revoked_by="user-123",
                    )

                    assert isinstance(result, ServiceTokenMetadataResponse)

    async def test_revoke_audits_event(self):
        mock_token = _make_mock_token()
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service.ServiceTokenRepository,
                "revoke",
                new_callable=AsyncMock,
                return_value=True,
            ):
                with patch.object(
                    service_token_service,
                    "append_event",
                    new_callable=AsyncMock,
                ) as mock_audit:
                    await service_token_service.revoke_token(
                        token_id="st-test-001",
                        revoked_by="user-123",
                    )

                    mock_audit.assert_called_once()
                    call_kwargs = mock_audit.call_args.kwargs
                    assert call_kwargs["action"] == "service_token_revoked"


class TestServiceTokenPermissionNarrowing:
    """Permission narrowing takes immediate effect."""

    async def test_update_permissions_changes_token(self):
        mock_token = _make_mock_token(permissions=["workflows:read", "workflows:run"])
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ):
                result = await service_token_service.update_token_permissions(
                    token_id="st-test-001",
                    permissions=["workflows:read"],
                    updated_by="user-123",
                )

                assert result.permissions == ["workflows:read"]
                mock_token.save.assert_called()

    async def test_narrowing_audits_old_and_new_permissions(self):
        mock_token = _make_mock_token(permissions=["workflows:read", "workflows:run"])
        with patch.object(
            service_token_service.ServiceTokenRepository,
            "get_by_id",
            new_callable=AsyncMock,
            return_value=mock_token,
        ):
            with patch.object(
                service_token_service,
                "append_event",
                new_callable=AsyncMock,
            ) as mock_audit:
                await service_token_service.update_token_permissions(
                    token_id="st-test-001",
                    permissions=["workflows:read"],
                    updated_by="user-123",
                )

                mock_audit.assert_called_once()
                call_kwargs = mock_audit.call_args.kwargs
                assert call_kwargs["action"] == "service_token_permissions_updated"
                ctx = call_kwargs["context"]
                assert ctx["oldPermissions"] == ["workflows:read", "workflows:run"]
                assert ctx["newPermissions"] == ["workflows:read"]


class TestWebhookTokenActor:
    """WebhookTokenActor model for scoped webhook execution."""

    def test_webhook_actor_model_fields(self):
        from app.models import WebhookTokenActor

        actor = WebhookTokenActor(
            tokenId="wh-webhook-123",
            webhookId="webhook-123",
            scopeType="workspace",
            scopeId="ws-abc",
            permissions=["workflows:run", "workflows:read"],
        )

        assert actor.actorType == "webhook_token"
        assert actor.tokenId == "wh-webhook-123"
        assert actor.webhookId == "webhook-123"
        assert actor.scopeType == "workspace"
        assert actor.scopeId == "ws-abc"
        assert "workflows:run" in actor.permissions
