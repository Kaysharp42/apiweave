"""
Task 14 — Executor workspace/environment context and scoped secret resolution.

QA Scenarios:
- env-override: same secret at org/workspace/environment → environment value wins
- no-runtime-secrets: runtime_secrets parameter was removed (TypeError if passed)
- url-blocked: {{secrets.*}} in URL/query/path still raises ValueError
"""

import sys
from unittest.mock import MagicMock, patch

import pytest

sys.modules.setdefault("app.services.run_service", MagicMock())

from app.runner.executor import RunContext, WorkflowExecutor

_ENV_SECRET_VALUE = "env-scope-value-t14"
_WS_SECRET_VALUE = "ws-scope-value-t14"
_ORG_SECRET_VALUE = "org-scope-value-t14"


def _make_secret_doc(name: str, ciphertext: str = "Y2lwaGVy", key_id: str = "kp-test") -> MagicMock:
    doc = MagicMock()
    doc.name = name
    doc.ciphertext = ciphertext
    doc.keyId = key_id
    doc.secretId = f"sec-{name}"
    return doc


class TestRuntimeSecretsRejected:
    """runtime_secrets parameter was removed — passing it raises TypeError."""

    def test_executor_rejects_runtime_secrets(self):
        """Passing runtime_secrets kwarg raises TypeError (unknown parameter)."""
        with pytest.raises(TypeError):
            WorkflowExecutor(
                run_id="run-t14-reject",
                workflow_id="wf-t14-reject",
                runtime_secrets={"API_TOKEN": "should-not-be-accepted"},
            )

    def test_executor_constructs_without_runtime_secrets(self):
        ex = WorkflowExecutor(
            run_id="run-t14-ok",
            workflow_id="wf-t14-ok",
        )
        assert ex.run_id == "run-t14-ok"


class TestRunContext:
    """RunContext carries workspace/actor/environment for scoped execution."""

    def test_run_context_fields(self):
        ctx = RunContext(
            workspace_id="ws-123",
            org_id="org-456",
            actor_type="user",
            actor_id="user-789",
            environment_id="env-abc",
            environment_scope_type="workspace",
            environment_scope_id="ws-123",
        )
        assert ctx.workspace_id == "ws-123"
        assert ctx.org_id == "org-456"
        assert ctx.actor_type == "user"
        assert ctx.actor_id == "user-789"
        assert ctx.environment_id == "env-abc"

    def test_executor_accepts_run_context(self):
        ctx = RunContext(workspace_id="ws-123", actor_type="user", actor_id="u-1")
        ex = WorkflowExecutor(
            run_id="run-t14-ctx",
            workflow_id="wf-t14-ctx",
            run_context=ctx,
        )
        assert ex.run_context is ctx
        assert ex.run_context.workspace_id == "ws-123"


class TestEnvOverride:
    """Environment > Workspace > Organization override chain."""

    @pytest.mark.asyncio
    async def test_environment_scope_wins(self):
        """When the same secret exists at all three scopes, environment value is used."""
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
            environment_scope_type="environment",
            environment_scope_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-t14-override",
            workflow_id="wf-t14-override",
            run_context=ctx,
        )

        secret_name = "API_TOKEN"

        async def mock_get_by_scope_and_name(scope_type, scope_id, name):
            if scope_type == "environment" and scope_id == "env-1":
                return _make_secret_doc(name, ciphertext="ZW52LWNpcGhlcg==")
            if scope_type == "workspace" and scope_id == "ws-1":
                return _make_secret_doc(name, ciphertext="d3MtY2lwaGVy")
            if scope_type == "organization" and scope_id == "org-1":
                return _make_secret_doc(name, ciphertext="b3JnLWNpcGhlcg==")
            return None

        async def mock_resolve_secret(scope_type, scope_id, ciphertext_b64, key_id):
            if scope_type == "environment":
                return _ENV_SECRET_VALUE
            if scope_type == "workspace":
                return _WS_SECRET_VALUE
            if scope_type == "organization":
                return _ORG_SECRET_VALUE
            return "unknown"

        async def mock_audit(**kwargs):
            return "resolved-value"

        with (
            patch(
                "app.repositories.secret_repository.SecretRepository.get_by_scope_and_name",
                side_effect=mock_get_by_scope_and_name,
            ),
            patch(
                "app.services.scoped_secret_resolver.resolve_secret",
                side_effect=mock_resolve_secret,
            ),
            patch(
                "app.services.audit_resolver_helper.resolve_secret_with_audit",
                side_effect=mock_audit,
            ),
        ):
            await ex._resolve_single_secret(
                secret_name,
                ctx,
                type(
                    "SecretRepo",
                    (),
                    {"get_by_scope_and_name": staticmethod(mock_get_by_scope_and_name)},
                ),
                mock_resolve_secret,
                mock_audit,
            )

        # The first scope in the chain (environment) should be checked first
        chain = ex._build_scope_chain(ctx)
        assert chain[0] == ("environment", "env-1")
        assert chain[1] == ("workspace", "ws-1")
        assert chain[2] == ("organization", "org-1")

    @pytest.mark.asyncio
    async def test_workspace_scope_used_when_env_missing(self):
        """When secret is not at environment scope, workspace scope is used."""
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )

        async def mock_get_by_scope_and_name(scope_type, scope_id, name):
            if scope_type == "environment":
                return None  # Not at environment scope
            if scope_type == "workspace":
                return _make_secret_doc(name)
            return None

        async def mock_resolve(**kwargs):
            return _WS_SECRET_VALUE

        async def mock_audit(**kwargs):
            return "ok"

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                return await mock_get_by_scope_and_name(scope_type, scope_id, name)

        ex = WorkflowExecutor(
            run_id="run-t14-ws",
            workflow_id="wf-t14-ws",
            run_context=ctx,
        )
        result = await ex._resolve_single_secret(
            "API_TOKEN",
            ctx,
            FakeRepo,
            mock_resolve,
            mock_audit,
        )
        assert result == _WS_SECRET_VALUE

    @pytest.mark.asyncio
    async def test_org_scope_used_as_fallback(self):
        """When secret is not at env or workspace scope, org scope is used."""
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )

        async def mock_get_by_scope_and_name(scope_type, scope_id, name):
            if scope_type in ("environment", "workspace"):
                return None
            if scope_type == "organization":
                return _make_secret_doc(name)
            return None

        async def mock_resolve(**kwargs):
            return _ORG_SECRET_VALUE

        async def mock_audit(**kwargs):
            return "ok"

        class FakeRepo:
            @staticmethod
            async def get_by_scope_and_name(scope_type, scope_id, name):
                return await mock_get_by_scope_and_name(scope_type, scope_id, name)

        ex = WorkflowExecutor(
            run_id="run-t14-org",
            workflow_id="wf-t14-org",
            run_context=ctx,
        )
        result = await ex._resolve_single_secret(
            "API_TOKEN",
            ctx,
            FakeRepo,
            mock_resolve,
            mock_audit,
        )
        assert result == _ORG_SECRET_VALUE


class TestUrlBlockedPreserved:
    """URL/query/path secret blocking is preserved after Wave 3 changes."""

    def test_secrets_in_url_raises(self):
        ex = WorkflowExecutor(run_id="run-t14-url", workflow_id="wf-t14-url")
        ex.secrets = {"apiKey": "secret-value"}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            ex._substitute_variables(
                "https://api.example.com?key={{secrets.apiKey}}",
                allow_secrets=False,
            )

    def test_secrets_in_query_params_raises(self):
        ex = WorkflowExecutor(run_id="run-t14-qp", workflow_id="wf-t14-qp")
        ex.secrets = {"apiKey": "secret-value"}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            ex._parse_key_value_pairs(
                "key={{secrets.apiKey}}",
                allow_secrets=False,
            )

    def test_secrets_still_resolve_in_headers(self):
        ex = WorkflowExecutor(run_id="run-t14-hdr", workflow_id="wf-t14-hdr")
        ex.secrets = {"apiKey": "secret-value"}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        result = ex._substitute_variables("Bearer {{secrets.apiKey}}")
        assert result == "Bearer secret-value"


class TestScanSecretRefs:
    """Workflow scanning finds {{secrets.*}} references in node configs."""

    def test_scan_finds_secrets_in_config(self):
        ex = WorkflowExecutor(run_id="run-t14-scan", workflow_id="wf-t14-scan")
        workflow = {
            "nodes": [
                {
                    "nodeId": "http_1",
                    "type": "http-request",
                    "config": {
                        "url": "https://api.example.com",
                        "headers": "Authorization=Bearer {{secrets.API_TOKEN}}",
                        "body": '{"key": "{{secrets.DB_PASS}}"}',
                    },
                },
            ],
        }
        refs = ex._scan_secret_refs(workflow)
        assert "API_TOKEN" in refs
        assert "DB_PASS" in refs

    def test_scan_returns_empty_for_no_secrets(self):
        ex = WorkflowExecutor(run_id="run-t14-nosec", workflow_id="wf-t14-nosec")
        workflow = {
            "nodes": [
                {
                    "nodeId": "http_1",
                    "type": "http-request",
                    "config": {
                        "url": "https://api.example.com",
                        "headers": "Content-Type=application/json",
                    },
                },
            ],
        }
        refs = ex._scan_secret_refs(workflow)
        assert refs == set()
