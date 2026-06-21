"""
Task 27 — Write-only secret tests.

Verifies that secret values NEVER appear in API responses, audit events,
JSON exports, or log output outside the trusted runtime sink.

Uses sentinel value ``NEVER_LEAK_ME_42`` and asserts it appears nowhere
in any serialized output.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import (
    Secret,
    SecretBinding,
    SecretCreateRequest,
    SecretMetadataResponse,
)
from app.services import secret_binding_service, secret_service
from app.services.audit_service import _sanitize_context
from app.services.exceptions import AuditWriteUnavailableError
from app.services.secret_utils import SecretMasker

# Sentinel value that must NEVER appear outside the trusted runtime sink.
SENTINEL = "NEVER_LEAK_ME_42"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_secret(
    secret_id: str = "sec-test-001",
    name: str = "API_TOKEN",
    scope_type: str = "workspace",
    scope_id: str = "ws-001",
    ciphertext: str = "encrypted-data-base64",
    key_id: str = "kp-test-001",
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
# Test: SecretMetadataResponse never contains ciphertext or value
# ---------------------------------------------------------------------------


class TestMetadataResponseNoLeak:
    """SecretMetadataResponse must never include ciphertext or plaintext."""

    def test_metadata_response_model_has_no_ciphertext_field(self):
        """The SecretMetadataResponse Pydantic model has no ciphertext field."""
        fields = SecretMetadataResponse.model_fields
        assert "ciphertext" not in fields
        assert "value" not in fields
        assert "plaintext" not in fields

    def test_metadata_response_dump_excludes_ciphertext(self):
        """model_dump() output does not contain ciphertext even when source has it."""
        secret = _make_mock_secret(ciphertext=f"enc-{SENTINEL}")
        response = secret_service._to_metadata_response(secret)  # noqa: SLF001
        dumped = response.model_dump()
        serialized = json.dumps(dumped, default=str)

        assert "ciphertext" not in dumped
        assert SENTINEL not in serialized

    def test_get_secret_metadata_returns_no_ciphertext(self):
        """get_secret_metadata returns metadata only."""

        async def _get():
            with patch(
                "app.services.secret_service.SecretRepository.get_by_id",
                new=AsyncMock(return_value=_make_mock_secret(ciphertext=f"enc-{SENTINEL}")),
            ):
                return await secret_service.get_secret_metadata("sec-test-001")

        result = asyncio.run(_get())
        dumped = result.model_dump()
        assert "ciphertext" not in dumped
        assert SENTINEL not in json.dumps(dumped, default=str)

    def test_list_secrets_returns_no_ciphertext(self):
        """list_secrets returns metadata only for all secrets."""
        secrets_list = [
            _make_mock_secret(secret_id="sec-1", ciphertext=f"enc-1-{SENTINEL}"),
            _make_mock_secret(secret_id="sec-2", ciphertext=f"enc-2-{SENTINEL}"),
        ]

        async def _list():
            with patch(
                "app.services.secret_service.SecretRepository.list_by_scope",
                new=AsyncMock(return_value=secrets_list),
            ):
                return await secret_service.list_secrets("workspace", "ws-001")

        results = asyncio.run(_list())
        for meta in results:
            dumped = meta.model_dump()
            assert "ciphertext" not in dumped
            assert SENTINEL not in json.dumps(dumped, default=str)


# ---------------------------------------------------------------------------
# Test: Create/Update secret response never leaks ciphertext
# ---------------------------------------------------------------------------


class TestCreateUpdateResponseNoLeak:
    """create_secret and update_secret return metadata only."""

    def test_create_secret_response_has_no_ciphertext(self):
        mock_secret = _make_mock_secret(ciphertext=f"enc-{SENTINEL}")

        async def _create():
            with (
                patch(
                    "app.services.secret_service.SecretRepository.count_by_scope",
                    new=AsyncMock(return_value=0),
                ),
                patch(
                    "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                    new=AsyncMock(return_value=None),
                ),
                patch(
                    "app.services.secret_service.SecretRepository.create",
                    new=AsyncMock(return_value=mock_secret),
                ),
                patch(
                    "app.services.secret_service.append_event",
                    new=AsyncMock(),
                ),
            ):
                request = SecretCreateRequest(
                    name="MY_TOKEN",
                    ciphertext=f"enc-{SENTINEL}",
                    keyId="kp-001",
                )
                return await secret_service.create_secret(
                    scope_type="workspace",
                    scope_id="ws-001",
                    request=request,
                )

        result = asyncio.run(_create())
        dumped = result.model_dump()
        assert "ciphertext" not in dumped
        assert SENTINEL not in json.dumps(dumped, default=str)

    def test_update_secret_response_has_no_ciphertext(self):
        mock_secret = _make_mock_secret(ciphertext=f"enc-{SENTINEL}")

        async def _update():
            with (
                patch(
                    "app.services.secret_service.SecretRepository.get_by_id",
                    new=AsyncMock(return_value=mock_secret),
                ),
                patch(
                    "app.services.secret_service.SecretRepository.update",
                    new=AsyncMock(return_value=mock_secret),
                ),
                patch(
                    "app.services.secret_service.append_event",
                    new=AsyncMock(),
                ),
            ):
                request = SecretCreateRequest(
                    name="API_TOKEN",
                    ciphertext=f"enc-{SENTINEL}",
                    keyId="kp-002",
                )
                return await secret_service.update_secret(
                    secret_id="sec-test-001",
                    request=request,
                )

        result = asyncio.run(_update())
        dumped = result.model_dump()
        assert "ciphertext" not in dumped
        assert SENTINEL not in json.dumps(dumped, default=str)


# ---------------------------------------------------------------------------
# Test: Audit events never contain secret values
# ---------------------------------------------------------------------------


class TestAuditNoLeak:
    """Audit events for secret operations must not contain secret values."""

    def test_sanitize_context_rejects_forbidden_keys(self):
        """_sanitize_context raises if forbidden keys are present."""
        for key in ["value", "ciphertext", "privateKey", "plaintext", "secretValue"]:
            with pytest.raises(AuditWriteUnavailableError, match="forbidden secret keys"):
                _sanitize_context({key: SENTINEL})

    def test_secret_create_audit_context_has_no_value(self):
        """The audit context for secret_created contains only metadata."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _create():
            mock_secret = _make_mock_secret(ciphertext=f"enc-{SENTINEL}")
            with (
                patch(
                    "app.services.secret_service.SecretRepository.count_by_scope",
                    new=AsyncMock(return_value=0),
                ),
                patch(
                    "app.services.secret_service.SecretRepository.get_by_scope_and_name",
                    new=AsyncMock(return_value=None),
                ),
                patch(
                    "app.services.secret_service.SecretRepository.create",
                    new=AsyncMock(return_value=mock_secret),
                ),
                patch(
                    "app.services.secret_service.append_event",
                    side_effect=mock_append,
                ),
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
        ctx = captured.get("context", {})
        assert SENTINEL not in json.dumps(ctx, default=str)
        assert "ciphertext" not in ctx
        assert "value" not in ctx
        # Only metadata
        assert "secretName" in ctx
        assert "keyId" in ctx

    def test_binding_audit_context_has_no_secret_value(self):
        """Binding audit context contains secretId but no secret value."""
        captured: dict = {}

        async def mock_append(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        async def _bind():
            user_secret = _make_mock_secret(
                secret_id="sec-user-001",
                scope_type="user",
                scope_id="user-001",
            )
            mock_binding = _make_mock_binding()
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
                    side_effect=mock_append,
                ),
            ):
                from app.models import SecretBindingCreateRequest

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
        ctx = captured.get("context", {})
        assert SENTINEL not in json.dumps(ctx, default=str)
        assert "secretId" in ctx
        assert "ciphertext" not in ctx
        assert "value" not in ctx


# ---------------------------------------------------------------------------
# Test: SecretMasker masks sentinel value in logs and exports
# ---------------------------------------------------------------------------


class TestSecretMaskerNoLeak:
    """SecretMasker must redact known secret values from text and structures."""

    def test_masker_redacts_sentinel_in_text(self):
        masker = SecretMasker({"API_TOKEN": SENTINEL})
        masked = masker.mask_text(f"Bearer {SENTINEL}")
        assert SENTINEL not in masked
        assert "<REDACTED>" in masked

    def test_masker_redacts_sentinel_in_struct(self):
        masker = SecretMasker({"API_TOKEN": SENTINEL})
        data = {
            "message": f"Using token {SENTINEL} for auth",
            "nested": {"key": SENTINEL},
            "list": [SENTINEL, "safe"],
        }
        masked = masker.mask_struct(data)
        serialized = json.dumps(masked)
        assert SENTINEL not in serialized

    def test_masker_empty_does_not_alter(self):
        masker = SecretMasker()
        assert masker.mask_text(SENTINEL) == SENTINEL
        assert masker.mask_struct({"key": SENTINEL}) == {"key": SENTINEL}

    def test_audit_masker_defense_in_depth(self):
        """Even if a secret value accidentally reaches audit context, masker catches it."""
        masker = SecretMasker({"API_TOKEN": SENTINEL})
        # Simulate context where value leaked under a non-forbidden key
        raw_context = {"message": f"token={SENTINEL}"}
        from app.services.audit_service import mask_context_values

        masked = mask_context_values(raw_context, masker)
        assert SENTINEL not in masked["message"]
