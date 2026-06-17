"""
Task 27 — User-secret binding tests.

Verifies that:
- User-scoped secrets can be bound to workspaces and environments.
- Non-user-scoped secrets cannot be bound.
- Duplicate bindings are rejected.
- Bindings can be removed (unbind).
- Binding operations produce audit events.
- Only the secret owner can bind their secrets.
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
)
from app.services import secret_binding_service
from app.services.exceptions import ConflictError, ResourceNotFoundError


def _make_mock_secret(
    secret_id: str = "sec-user-001",
    name: str = "MY_TOKEN",
    scope_type: str = "user",
    scope_id: str = "user-001",
) -> MagicMock:
    now = datetime.now(UTC)
    mock = MagicMock(spec=Secret)
    mock.secretId = secret_id
    mock.name = name
    mock.scopeType = scope_type
    mock.scopeId = scope_id
    mock.ciphertext = "encrypted"
    mock.keyId = "kp-001"
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
    now = datetime.now(UTC)
    mock = MagicMock(spec=SecretBinding)
    mock.bindingId = binding_id
    mock.secretId = secret_id
    mock.userId = user_id
    mock.targetScopeType = target_scope_type
    mock.targetScopeId = target_scope_id
    mock.createdAt = now
    return mock


# ---------------------------------------------------------------------------
# Bind to workspace
# ---------------------------------------------------------------------------


class TestBindToWorkspace:
    """User can bind their personal secret to a workspace."""

    def test_bind_user_secret_to_workspace(self):
        user_secret = _make_mock_secret()
        mock_binding = _make_mock_binding(
            target_scope_type="workspace",
            target_scope_id="ws-001",
        )

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=user_secret),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_existing",
                new=AsyncMock(return_value=None),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.create",
                new=AsyncMock(return_value=mock_binding),
            ), patch(
                "app.services.secret_binding_service.append_event",
                new=AsyncMock(),
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

        result = asyncio.run(_bind())
        assert result.bindingId == "sbi-test-001"
        assert result.secretId == "sec-user-001"
        assert result.targetScopeType == "workspace"
        assert result.targetScopeId == "ws-001"

    def test_bind_creates_audit_event(self):
        """Binding creates an audit event with metadata only."""
        user_secret = _make_mock_secret()
        mock_binding = _make_mock_binding()
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=user_secret),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_existing",
                new=AsyncMock(return_value=None),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.create",
                new=AsyncMock(return_value=mock_binding),
            ), patch(
                "app.services.secret_binding_service.append_event",
                side_effect=mock_append,
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-user-001",
                    targetScopeType="workspace",
                    targetScopeId="ws-001",
                )
                await secret_binding_service.bind_user_secret(
                    user_id="user-001",
                    request=request,
                )

        asyncio.run(_bind())
        assert captured.get("action") == "secret_binding_created"
        ctx = captured.get("context", {})
        assert "secretId" in ctx
        assert "ciphertext" not in ctx
        assert "value" not in ctx


# ---------------------------------------------------------------------------
# Bind to environment
# ---------------------------------------------------------------------------


class TestBindToEnvironment:
    """User can bind their personal secret to an environment."""

    def test_bind_user_secret_to_environment(self):
        user_secret = _make_mock_secret()
        mock_binding = _make_mock_binding(
            target_scope_type="environment",
            target_scope_id="env-001",
        )

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=user_secret),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_existing",
                new=AsyncMock(return_value=None),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.create",
                new=AsyncMock(return_value=mock_binding),
            ), patch(
                "app.services.secret_binding_service.append_event",
                new=AsyncMock(),
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-user-001",
                    targetScopeType="environment",
                    targetScopeId="env-001",
                )
                return await secret_binding_service.bind_user_secret(
                    user_id="user-001",
                    request=request,
                )

        result = asyncio.run(_bind())
        assert result.targetScopeType == "environment"
        assert result.targetScopeId == "env-001"


# ---------------------------------------------------------------------------
# Rejection cases
# ---------------------------------------------------------------------------


class TestBindingRejections:
    """Binding rejects invalid inputs."""

    def test_rejects_non_user_secret(self):
        """Cannot bind a workspace-scoped secret."""
        ws_secret = _make_mock_secret(
            secret_id="sec-ws-001",
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

        with pytest.raises(ValueError, match="Only user-scoped secrets"):
            asyncio.run(_bind())

    def test_rejects_duplicate_binding(self):
        """Cannot create duplicate binding for same secret+target."""
        user_secret = _make_mock_secret()
        existing = _make_mock_binding()

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=user_secret),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_existing",
                new=AsyncMock(return_value=existing),
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

    def test_rejects_invalid_target_scope(self):
        """Target scope must be 'workspace' or 'environment'."""

        async def _bind():
            request = SecretBindingCreateRequest(
                secretId="sec-user-001",
                targetScopeType="organization",
                targetScopeId="org-001",
            )
            return await secret_binding_service.bind_user_secret(
                user_id="user-001",
                request=request,
            )

        with pytest.raises(ValueError, match="Target scope must be"):
            asyncio.run(_bind())

    def test_rejects_nonexistent_secret(self):
        """Cannot bind a secret that doesn't exist."""

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=None),
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-ghost",
                    targetScopeType="workspace",
                    targetScopeId="ws-001",
                )
                return await secret_binding_service.bind_user_secret(
                    user_id="user-001",
                    request=request,
                )

        with pytest.raises(ResourceNotFoundError):
            asyncio.run(_bind())

    def test_rejects_binding_others_secret(self):
        """Cannot bind a user secret that belongs to another user."""
        other_secret = _make_mock_secret(
            secret_id="sec-other",
            scope_type="user",
            scope_id="user-999",  # different user
        )

        async def _bind():
            with patch(
                "app.services.secret_binding_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=other_secret),
            ):
                request = SecretBindingCreateRequest(
                    secretId="sec-other",
                    targetScopeType="workspace",
                    targetScopeId="ws-001",
                )
                return await secret_binding_service.bind_user_secret(
                    user_id="user-001",  # not the owner
                    request=request,
                )

        with pytest.raises(ValueError, match="Cannot bind a secret that does not belong to you"):
            asyncio.run(_bind())


# ---------------------------------------------------------------------------
# Unbind
# ---------------------------------------------------------------------------


class TestUnbind:
    """User can remove their binding."""

    def test_unbind_succeeds(self):
        mock_binding = _make_mock_binding(user_id="user-001")

        async def _unbind():
            with patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_by_id",
                new=AsyncMock(return_value=mock_binding),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.delete",
                new=AsyncMock(return_value=True),
            ), patch(
                "app.services.secret_binding_service.append_event",
                new=AsyncMock(),
            ):
                await secret_binding_service.unbind_user_secret(
                    binding_id="sbi-test-001",
                    user_id="user-001",
                )

        asyncio.run(_unbind())  # Should not raise

    def test_unbind_creates_audit_event(self):
        """Unbinding creates an audit event."""
        mock_binding = _make_mock_binding(user_id="user-001")
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _unbind():
            with patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_by_id",
                new=AsyncMock(return_value=mock_binding),
            ), patch(
                "app.services.secret_binding_service.SecretBindingRepository.delete",
                new=AsyncMock(return_value=True),
            ), patch(
                "app.services.secret_binding_service.append_event",
                side_effect=mock_append,
            ):
                await secret_binding_service.unbind_user_secret(
                    binding_id="sbi-test-001",
                    user_id="user-001",
                )

        asyncio.run(_unbind())
        assert captured.get("action") == "secret_binding_deleted"

    def test_unbind_rejects_nonexistent(self):
        """Cannot unbind a binding that doesn't exist."""

        async def _unbind():
            with patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_by_id",
                new=AsyncMock(return_value=None),
            ):
                await secret_binding_service.unbind_user_secret(
                    binding_id="sbi-ghost",
                    user_id="user-001",
                )

        with pytest.raises(ResourceNotFoundError):
            asyncio.run(_unbind())

    def test_unbind_rejects_wrong_owner(self):
        """Cannot unbind a binding that belongs to another user."""
        mock_binding = _make_mock_binding(user_id="user-999")

        async def _unbind():
            with patch(
                "app.services.secret_binding_service.SecretBindingRepository.get_by_id",
                new=AsyncMock(return_value=mock_binding),
            ):
                await secret_binding_service.unbind_user_secret(
                    binding_id="sbi-test-001",
                    user_id="user-001",  # not the owner
                )

        with pytest.raises(ValueError, match="Cannot unbind a binding that does not belong to you"):
            asyncio.run(_unbind())


# ---------------------------------------------------------------------------
# List bindings
# ---------------------------------------------------------------------------


class TestListBindings:
    """List bindings for workspace, environment, and user."""

    def test_list_bindings_for_workspace(self):
        bindings = [
            _make_mock_binding(binding_id="sbi-1"),
            _make_mock_binding(binding_id="sbi-2"),
        ]

        async def _list():
            with patch(
                "app.services.secret_binding_service.SecretBindingRepository.list_for_target",
                new=AsyncMock(return_value=bindings),
            ):
                return await secret_binding_service.list_bindings_for_target(
                    target_scope_type="workspace",
                    target_scope_id="ws-001",
                )

        result = asyncio.run(_list())
        assert len(result) == 2

    def test_list_bindings_for_user(self):
        bindings = [_make_mock_binding(binding_id="sbi-1")]

        async def _list():
            with patch(
                "app.services.secret_binding_service.SecretBindingRepository.list_for_user",
                new=AsyncMock(return_value=bindings),
            ):
                return await secret_binding_service.list_bindings_for_user("user-001")

        result = asyncio.run(_list())
        assert len(result) == 1
