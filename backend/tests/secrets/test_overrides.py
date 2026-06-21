"""
Task 27 — Override chain tests.

Verifies the GitHub-like secret resolution override chain:
Environment > Workspace > Organization.

Each scope level can override the same secret name from a parent scope.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import Secret
from app.services import secret_service


def _make_mock_secret(
    secret_id: str,
    name: str,
    scope_type: str,
    scope_id: str,
    ciphertext: str = "encrypted",
    key_id: str = "kp-001",
) -> MagicMock:
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


# ---------------------------------------------------------------------------
# Full override chain
# ---------------------------------------------------------------------------


class TestFullOverrideChain:
    """Environment > Workspace > Organization override chain."""

    def test_environment_overrides_workspace_and_org(self):
        """Environment secret wins over workspace and org."""
        env_secret = _make_mock_secret("sec-env", "API_TOKEN", "environment", "env-001")
        ws_secret = _make_mock_secret("sec-ws", "API_TOKEN", "workspace", "ws-001")
        org_secret = _make_mock_secret("sec-org", "API_TOKEN", "organization", "org-001")

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
        """Workspace secret wins when no environment secret exists."""
        ws_secret = _make_mock_secret("sec-ws", "API_TOKEN", "workspace", "ws-001")
        org_secret = _make_mock_secret("sec-org", "API_TOKEN", "organization", "org-001")

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
        org_secret = _make_mock_secret("sec-org", "API_TOKEN", "organization", "org-001")

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


# ---------------------------------------------------------------------------
# Partial scope chains
# ---------------------------------------------------------------------------


class TestPartialScopeChains:
    """Test resolution with missing scope levels."""

    def test_no_environment_id_skips_env_check(self):
        """When environment_id is None, env scope is skipped."""
        ws_secret = _make_mock_secret("sec-ws", "TOKEN", "workspace", "ws-001")

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[ws_secret]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id=None,
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is not None
        secret, scope_type = result
        assert secret.secretId == "sec-ws"
        assert scope_type == "workspace"

    def test_no_workspace_id_skips_ws_check(self):
        """When workspace_id is None, workspace scope is skipped."""
        org_secret = _make_mock_secret("sec-org", "TOKEN", "organization", "org-001")

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[org_secret]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id=None,
                    workspace_id=None,
                    org_id="org-001",
                    secret_name="TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is not None
        secret, scope_type = result
        assert secret.secretId == "sec-org"
        assert scope_type == "organization"

    def test_no_scope_ids_returns_none(self):
        """When all scope IDs are None, returns None."""

        async def _resolve():
            return await secret_service.resolve_effective_secret(
                environment_id=None,
                workspace_id=None,
                org_id=None,
                secret_name="TOKEN",
            )

        result = asyncio.run(_resolve())
        assert result is None

    def test_env_only_no_ws_no_org(self):
        """Environment secret found even without workspace or org IDs."""
        env_secret = _make_mock_secret("sec-env", "TOKEN", "environment", "env-001")

        async def _resolve():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[env_secret]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id=None,
                    org_id=None,
                    secret_name="TOKEN",
                )

        result = asyncio.run(_resolve())
        assert result is not None
        secret, scope_type = result
        assert secret.secretId == "sec-env"
        assert scope_type == "environment"


# ---------------------------------------------------------------------------
# Different secret names across scopes
# ---------------------------------------------------------------------------


class TestDifferentNamesAcrossScopes:
    """Different secret names at different scopes resolve independently."""

    def test_different_names_resolve_independently(self):
        """Each secret name resolves independently through the chain."""
        env_secret = _make_mock_secret("sec-env", "ENV_ONLY", "environment", "env-001")
        ws_secret = _make_mock_secret("sec-ws", "WS_ONLY", "workspace", "ws-001")

        async def _resolve_env():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[env_secret, None, None]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="ENV_ONLY",
                )

        async def _resolve_ws():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                new=AsyncMock(side_effect=[None, ws_secret, None]),
            ):
                return await secret_service.resolve_effective_secret(
                    environment_id="env-001",
                    workspace_id="ws-001",
                    org_id="org-001",
                    secret_name="WS_ONLY",
                )

        env_result = asyncio.run(_resolve_env())
        ws_result = asyncio.run(_resolve_ws())

        assert env_result is not None
        assert env_result[0].name == "ENV_ONLY"
        assert env_result[1] == "environment"

        assert ws_result is not None
        assert ws_result[0].name == "WS_ONLY"
        assert ws_result[1] == "workspace"
