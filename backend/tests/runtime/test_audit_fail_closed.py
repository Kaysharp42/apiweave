"""
Task 28 — Audit failure fail-closed behavior.

Verifies that:
- When audit write fails during secret resolution, the run fails (no secret used)
- The executor raises the audit exception (does not swallow it)
- No secret value is stored in executor.secrets when audit fails
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.runner.executor import RunContext, WorkflowExecutor


def _make_secret_doc(name: str = "API_TOKEN"):
    doc = MagicMock()
    doc.name = name
    doc.ciphertext = "Y2lwaGVy"
    doc.keyId = "kp-test"
    doc.secretId = f"sec-{name}"
    return doc


class TestAuditFailClosed:
    """Audit failure during secret resolution fails the run closed."""

    @pytest.mark.asyncio
    async def test_audit_failure_raises_exception(self):
        """When audit_fn raises, _resolve_single_secret re-raises (fail-closed)."""
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-audit-fail",
            workflow_id="wf-audit-fail",
            run_context=ctx,
        )

        secret_doc = _make_secret_doc()

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                if scope_type == "environment":
                    return secret_doc
                return None

        async def mock_resolve(**kwargs):
            return "super-secret-value"

        async def mock_audit_fail(**kwargs):
            raise RuntimeError("Audit DB connection refused")

        with pytest.raises(RuntimeError, match="Audit DB connection refused"):
            await ex._resolve_single_secret(
                "API_TOKEN", ctx, FakeRepo, mock_resolve, mock_audit_fail,
            )

    @pytest.mark.asyncio
    async def test_secret_not_stored_when_audit_fails(self):
        """When audit fails, the secret value is NOT added to executor.secrets."""
        ctx = RunContext(
            workspace_id="ws-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-audit-nosec",
            workflow_id="wf-audit-nosec",
            run_context=ctx,
        )

        # Ensure secrets dict is empty before
        assert ex.secrets == {}

        secret_doc = _make_secret_doc()

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                if scope_type == "environment":
                    return secret_doc
                return None

        async def mock_resolve(**kwargs):
            return "super-secret-value"

        async def mock_audit_fail(**kwargs):
            raise RuntimeError("Audit write failed")

        with pytest.raises(RuntimeError):
            await ex._resolve_single_secret(
                "API_TOKEN", ctx, FakeRepo, mock_resolve, mock_audit_fail,
            )

        # Secret must NOT be in the executor's secrets dict
        assert "API_TOKEN" not in ex.secrets
        assert ex.secrets == {}

    @pytest.mark.asyncio
    async def test_audit_success_stores_secret(self):
        """When audit succeeds, the secret is returned normally."""
        ctx = RunContext(
            workspace_id="ws-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-audit-ok",
            workflow_id="wf-audit-ok",
            run_context=ctx,
        )

        secret_doc = _make_secret_doc()

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                if scope_type == "environment":
                    return secret_doc
                return None

        async def mock_resolve(**kwargs):
            return "resolved-value"

        async def mock_audit_ok(**kwargs):
            return "ok"

        result = await ex._resolve_single_secret(
            "API_TOKEN", ctx, FakeRepo, mock_resolve, mock_audit_ok,
        )
        assert result == "resolved-value"

    @pytest.mark.asyncio
    async def test_decrypt_failure_also_raises(self):
        """If decryption itself fails, the exception propagates (no silent skip)."""
        ctx = RunContext(
            workspace_id="ws-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-decrypt-fail",
            workflow_id="wf-decrypt-fail",
            run_context=ctx,
        )

        secret_doc = _make_secret_doc()

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                if scope_type == "environment":
                    return secret_doc
                return None

        async def mock_resolve_fail(**kwargs):
            raise ValueError("Decryption failed: invalid key")

        async def mock_audit(**kwargs):
            return "ok"

        with pytest.raises(ValueError, match="Decryption failed"):
            await ex._resolve_single_secret(
                "API_TOKEN", ctx, FakeRepo, mock_resolve_fail, mock_audit,
            )

    @pytest.mark.asyncio
    async def test_missing_secret_returns_none(self):
        """When a secret is not found in any scope, None is returned (no error)."""
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-missing",
            workflow_id="wf-missing",
            run_context=ctx,
        )

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                return None  # Not found anywhere

        async def mock_resolve(**kwargs):
            return "should-not-be-called"

        async def mock_audit(**kwargs):
            return "should-not-be-called"

        result = await ex._resolve_single_secret(
            "MISSING_SECRET", ctx, FakeRepo, mock_resolve, mock_audit,
        )
        assert result is None
