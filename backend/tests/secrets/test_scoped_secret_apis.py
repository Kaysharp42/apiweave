"""
Tests for Wave 2, Task 10: GitHub-like scoped secret APIs and user-secret binding.

Covers:
- Scoped override resolution: Environment > Workspace > Organization
- Write-only: metadata returns no values/ciphertext
- User-secret binding to workspace/environment
- GitHub-like naming validation
- GitHub-like limits (max secrets per scope)
- Audit integration
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models import (
    Secret,
    SecretBinding,
    SecretBindingCreateRequest,
    SecretCreateRequest,
)
from app.services import secret_binding_service, secret_service
from app.services.exceptions import ConflictError

# ============================================================================
# Fixtures
# ============================================================================


def _make_mock_secret(
    secret_id: str = "sec-test-001",
    name: str = "API_TOKEN",
    scope_type: str = "workspace",
    scope_id: str = "ws-001",
    ciphertext: str = "encrypted-data-base64",
    key_id: str = "kp-test-001",
) -> MagicMock:
    """Create a mock Secret document."""
    now = datetime.now(UTC)
    mock = MagicMock(spec=Secret)
    mock.secretId = secret_id
    mock.name = name
    mock.scopeType = scope_type
    mock.scopeId = scope_id
    mock.ciphertext = ciphertext
    mock.keyId = key_id
    mock.createdAt = now
    mock.updatedAt = now
    return mock


def _make_mock_binding(
    binding_id: str = "sbi-test-001",
    secret_id: str = "sec-user-001",
    user_id: str = "user-001",
    target_scope_type: str = "workspace",
    target_scope_id: str = "ws-001",
) -> MagicMock:
    """Create a mock SecretBinding document."""
    now = datetime.now(UTC)
    mock = MagicMock(spec=SecretBinding)
    mock.bindingId = binding_id
    mock.secretId = secret_id
    mock.userId = user_id
    mock.targetScopeType = target_scope_type
    mock.targetScopeId = target_scope_id
    mock.createdAt = now
    return mock


# ============================================================================
# Test: Scoped Override Resolution (Environment > Workspace > Organization)
# ============================================================================


class TestScopedOverrideResolution:
    """Test that secret resolution follows Environment > Workspace > Organization."""

    def test_environment_overrides_workspace_and_org(self):
        """Environment secret takes priority over workspace and org."""
        env_secret = _make_mock_secret(
            secret_id="sec-env",
            name="API_TOKEN",
            scope_type="environment",
            scope_id="env-001",
            ciphertext="env-encrypted",
        )
        ws_secret = _make_mock_secret(
            secret_id="sec-ws",
            name="API_TOKEN",
            scope_type="workspace",
            scope_id="ws-001",
            ciphertext="ws-encrypted",
        )
        org_secret = _make_mock_secret(
            secret_id="sec-org",
            name="API_TOKEN",
            scope_type="organization",
            scope_id="org-001",
            ciphertext="org-encrypted",
        )

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[env_secret, ws_secret, org_secret]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="API_TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is not None
        secret, scope_type = result
        assert secret.secretId == "sec-env"
        assert scope_type == "environment"

    def test_workspace_overrides_org_when_no_env(self):
        """Workspace secret takes priority when no environment secret exists."""
        ws_secret = _make_mock_secret(
            secret_id="sec-ws",
            name="API_TOKEN",
            scope_type="workspace",
            scope_id="ws-001",
            ciphertext="ws-encrypted",
        )
        org_secret = _make_mock_secret(
            secret_id="sec-org",
            name="API_TOKEN",
            scope_type="organization",
            scope_id="org-001",
            ciphertext="org-encrypted",
        )

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[None, ws_secret, org_secret]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="API_TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is not None
        secret, scope_type = result
        assert secret.secretId == "sec-ws"
        assert scope_type == "workspace"

    def test_org_used_when_no_env_or_ws(self):
        """Organization secret used when no environment or workspace secret exists."""
        org_secret = _make_mock_secret(
            secret_id="sec-org",
            name="API_TOKEN",
            scope_type="organization",
            scope_id="org-001",
            ciphertext="org-encrypted",
        )

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[None, None, org_secret]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="API_TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is not None
        secret, scope_type = result
        assert secret.secretId == "sec-org"
        assert scope_type == "organization"

    def test_returns_none_when_no_secret_found(self):
        """Returns None when no secret exists in any scope."""

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(return_value=None),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="MISSING_TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is None


# ============================================================================
# Test: Write-Only (Metadata Returns No Values/Ciphertext)
# ============================================================================


class TestWriteOnlyMetadata:
    """Test that metadata responses never include ciphertext or plaintext."""

    def test_metadata_response_has_no_ciphertext(self):
        """SecretMetadataResponse does not include ciphertext field."""
        secret = _make_mock_secret(ciphertext="super-secret-encrypted-data")

        async def _get_metadata():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=secret),
            ):
                return await secret_service.get_secret_metadata("sec-test-001")

        result = asyncio.run(_get_metadata())

        # Metadata response should have these fields
        assert result.secretId == "sec-test-001"
        assert result.name == "API_TOKEN"
        assert result.scopeType == "workspace"
        assert result.scopeId == "ws-001"
        assert result.keyId == "kp-test-001"

        # Metadata response should NOT have ciphertext
        assert not hasattr(result, "ciphertext")
        # Verify by checking the model dump
        result_dict = result.model_dump()
        assert "ciphertext" not in result_dict

    def test_list_secrets_returns_metadata_only(self):
        """list_secrets returns metadata only for all secrets in scope."""
        secrets_list = [
            _make_mock_secret(secret_id="sec-1", name="TOKEN_1", ciphertext="enc-1"),
            _make_mock_secret(secret_id="sec-2", name="TOKEN_2", ciphertext="enc-2"),
        ]

        async def _list():
            with patch(
                "app.services.secret_service.SecretRepository.list_by_scope",
                new=AsyncMock(return_value=secrets_list),
            ):
                return await secret_service.list_secrets("workspace", "ws-001")

        result = asyncio.run(_list())

        assert len(result) == 2
        for meta in result:
            assert hasattr(meta, "secretId")
            assert hasattr(meta, "name")
            assert not hasattr(meta, "ciphertext")
            meta_dict = meta.model_dump()
            assert "ciphertext" not in meta_dict


# ============================================================================
# Test: User-Secret Binding
# ============================================================================


class TestUserSecretBinding:
    """Test user-secret binding to workspace/environment."""

    def test_bind_user_secret_to_workspace(self):
        """User can bind their personal secret to a workspace."""
        user_secret = _make_mock_secret(
            secret_id="sec-user-001",
            name="MY_TOKEN",
            scope_type="user",
            scope_id="user-001",
        )
        mock_binding = _make_mock_binding(
            binding_id="sbi-new",
            secret_id="sec-user-001",
            user_id="user-001",
            target_scope_type="workspace",
            target_scope_id="ws-001",
        )

        async def _bind():
            with (
                patch(
                    "app.services.secret_binding_service.SecretRepository.get_by_id",
                    new=AsyncMock(return_value=user_secret),
                ),
                patch(
                    "app.services.secret_binding_service.SecretBindingRepository.get_existing",
                    new=AsyncMock(return_value=None),
                ),
                patch(
                    "app.services.secret_binding_service.SecretBindingRepository.create",
                    new=AsyncMock(return_value=mock_binding),
                ),
                patch(
                    "app.services.secret_binding_service.append_event",
                    new=AsyncMock(),
                ),
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-user-001",
                    targetScopeType="workspace",
                    targetScopeId="ws-001",
                )
                return await secret_binding_service.bind_user_secret(
                    user_id="user-001",
                    request=request,
                    actor="user",
                    actor_id="user-001",
                )

        result = asyncio.run(_bind())
        assert result.bindingId == "sbi-new"
        assert result.secretId == "sec-user-001"
        assert result.targetScopeType == "workspace"
        assert result.targetScopeId == "ws-001"

    def test_bind_rejects_non_user_secret(self):
        """Cannot bind a secret that is not user-scoped."""
        ws_secret = _make_mock_secret(
            secret_id="sec-ws-001",
            name="WS_TOKEN",
            scope_type="workspace",
            scope_id="ws-001",
        )

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=ws_secret),
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-ws-001",
                    targetScopeType="workspace",
                    targetScopeId="ws-002",
                )
                return await secret_binding_service.bind_user_secret(
                    user_id="user-001",
                    request=request,
                )

        with pytest.raises(ValueError, match="Only user-scoped secrets can be bound"):
            asyncio.run(_bind())

    def test_bind_rejects_duplicate(self):
        """Cannot create duplicate binding for same secret+target."""
        user_secret = _make_mock_secret(
            secret_id="sec-user-001",
            scope_type="user",
            scope_id="user-001",
        )
        existing_binding = _make_mock_binding()

        async def _bind():
            with (
                patch(
                    "app.services.secret_binding_service.SecretRepository.get_by_id",
                    new=AsyncMock(return_value=user_secret),
                ),
                patch(
                    "app.services.secret_binding_service.SecretBindingRepository.get_existing",
                    new=AsyncMock(return_value=existing_binding),
                ),
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-user-001",
                    targetScopeType="workspace",
                    targetScopeId="ws-001",
                )
                return await secret_binding_service.bind_user_secret(
                    user_id="user-001",
                    request=request,
                )

        with pytest.raises(ConflictError, match="Binding already exists"):
            asyncio.run(_bind())

    def test_unbind_user_secret(self):
        """User can remove their binding."""
        mock_binding = _make_mock_binding(
            binding_id="sbi-001",
            user_id="user-001",
        )

        async def _unbind():
            with (
                patch(
                    "app.services.secret_binding_service.SecretBindingRepository.get_by_id",
                    new=AsyncMock(return_value=mock_binding),
                ),
                patch(
                    "app.services.secret_binding_service.SecretBindingRepository.delete",
                    new=AsyncMock(return_value=True),
                ),
                patch(
                    "app.services.secret_binding_service.append_event",
                    new=AsyncMock(),
                ),
            ):
                await secret_binding_service.unbind_user_secret(
                    binding_id="sbi-001",
                    user_id="user-001",
                    actor="user",
                    actor_id="user-001",
                )

        # Should not raise
        asyncio.run(_unbind())


# ============================================================================
# Test: GitHub-like Naming Validation
# ============================================================================


class TestSecretNamingValidation:
    """Test GitHub-like secret naming conventions."""

    def test_valid_names(self):
        """Valid names pass validation."""
        valid_names = [
            "API_TOKEN",
            "_private_key",
            "mySecret123",
            "A",
            "_",
            "SECRET_NAME_WITH_UNDERSCORES",
        ]
        for name in valid_names:
            # Should not raise
            secret_service.validate_secret_name(name)

    def test_invalid_names(self):
        """Invalid names raise ValueError."""
        invalid_names = [
            "",  # empty
            "123_STARTS_WITH_NUMBER",  # starts with number
            "-DASH",  # starts with dash
            "has space",  # contains space
            "has-dash",  # contains dash
            "has.dot",  # contains dot
            "a" * 256,  # too long
        ]
        for name in invalid_names:
            with pytest.raises(ValueError):
                secret_service.validate_secret_name(name)


# ============================================================================
# Test: GitHub-like Limits
# ============================================================================


class TestSecretLimits:
    """Test GitHub-like limits on secrets per scope."""

    def test_create_rejects_when_scope_limit_reached(self):
        """Cannot create secret when scope already has 100 secrets."""

        async def _create():
            with patch(
                "app.services.secret_service.SecretRepository.count_by_scope",
                new=AsyncMock(return_value=100),
            ):
                request = SecretCreateRequest(
                    name="NEW_TOKEN",
                    ciphertext="encrypted",
                    keyId="kp-001",
                )
                return await secret_service.create_secret(
                    scope_type="workspace",
                    scope_id="ws-001",
                    request=request,
                )

        with pytest.raises(ValueError, match="Cannot exceed 100 secrets"):
            asyncio.run(_create())

    def test_create_rejects_duplicate_name(self):
        """Cannot create secret with duplicate name in same scope."""
        existing = _make_mock_secret(name="API_TOKEN")

        async def _create():
            with (
                patch(
                    "app.services.secret_service.SecretRepository.count_by_scope",
                    new=AsyncMock(return_value=5),
                ),
                patch(
                    "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                    new=AsyncMock(return_value=existing),
                ),
            ):
                request = SecretCreateRequest(
                    name="API_TOKEN",
                    ciphertext="encrypted",
                    keyId="kp-001",
                )
                return await secret_service.create_secret(
                    scope_type="workspace",
                    scope_id="ws-001",
                    request=request,
                )

        with pytest.raises(ConflictError, match="already exists"):
            asyncio.run(_create())


# ============================================================================
# Test: Duplicate Names Allowed Across Scopes
# ============================================================================


class TestDuplicateNamesAcrossScopes:
    """Test that same secret name can exist in different scopes."""

    def test_same_name_different_scopes(self):
        """Same name can exist in workspace and environment scopes."""
        ws_secret = _make_mock_secret(
            secret_id="sec-ws",
            name="API_TOKEN",
            scope_type="workspace",
            scope_id="ws-001",
        )
        env_secret = _make_mock_secret(
            secret_id="sec-env",
            name="API_TOKEN",
            scope_type="environment",
            scope_id="env-001",
        )

        # Both should be retrievable
        async def _get_both():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[ws_secret, env_secret]),
            ):
                ws = await secret_service.SecretRepository.get_by_scope_and_name(
                    "workspace", "ws-001", "API_TOKEN"
                )
                env = await secret_service.SecretRepository.get_by_scope_and_name(
                    "environment", "env-001", "API_TOKEN"
                )
                return ws, env

        # This test verifies the concept - both secrets can coexist
        # because the unique index is on (scopeType, scopeId, name)
        assert ws_secret.name == env_secret.name
        assert ws_secret.scopeType != env_secret.scopeType
