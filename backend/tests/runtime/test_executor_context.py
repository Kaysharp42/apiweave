"""
Task 28 — Executor workspace/actor/environment context in run.

Verifies that:
- RunContext is correctly propagated to the executor
- The scope chain (Environment > Workspace > Organization) is built correctly
- Actor type/id are stored on the context
- Environment scope metadata is captured
"""
from __future__ import annotations

import pytest

from app.runner.executor import RunContext, WorkflowExecutor


class TestRunContextPropagation:
    """RunContext fields are correctly stored on the executor."""

    def test_executor_stores_run_context(self):
        ctx = RunContext(
            workspace_id="ws-100",
            org_id="org-200",
            actor_type="user",
            actor_id="user-300",
            environment_id="env-400",
            environment_scope_type="workspace",
            environment_scope_id="ws-100",
            effective_permissions={"workflows:run", "secrets:read"},
        )
        ex = WorkflowExecutor(
            run_id="run-ctx-1",
            workflow_id="wf-ctx-1",
            run_context=ctx,
        )
        assert ex.run_context is ctx
        assert ex.run_context.workspace_id == "ws-100"
        assert ex.run_context.org_id == "org-200"
        assert ex.run_context.actor_type == "user"
        assert ex.run_context.actor_id == "user-300"
        assert ex.run_context.environment_id == "env-400"
        assert ex.run_context.effective_permissions == {"workflows:run", "secrets:read"}

    def test_executor_without_run_context(self):
        """Legacy runs without RunContext still work (backward compat)."""
        ex = WorkflowExecutor(
            run_id="run-legacy",
            workflow_id="wf-legacy",
        )
        assert ex.run_context is None

    def test_service_token_actor(self):
        ctx = RunContext(
            workspace_id="ws-st",
            actor_type="service_token",
            actor_id="tok-abc",
        )
        ex = WorkflowExecutor(
            run_id="run-st",
            workflow_id="wf-st",
            run_context=ctx,
        )
        assert ex.run_context.actor_type == "service_token"
        assert ex.run_context.actor_id == "tok-abc"

    def test_webhook_actor(self):
        ctx = RunContext(
            workspace_id="ws-wh",
            actor_type="webhook_token",
            actor_id="wh-xyz",
        )
        ex = WorkflowExecutor(
            run_id="run-wh",
            workflow_id="wf-wh",
            run_context=ctx,
        )
        assert ex.run_context.actor_type == "webhook_token"


class TestScopeChain:
    """Scope chain is built in correct priority order."""

    def test_full_chain(self):
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
        )
        ex = WorkflowExecutor(
            run_id="run-chain-full",
            workflow_id="wf-chain-full",
            run_context=ctx,
        )
        chain = ex._build_scope_chain(ctx)
        assert chain == [
            ("environment", "env-1"),
            ("workspace", "ws-1"),
            ("organization", "org-1"),
        ]

    def test_chain_without_environment(self):
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
        )
        ex = WorkflowExecutor(
            run_id="run-chain-noenv",
            workflow_id="wf-chain-noenv",
            run_context=ctx,
        )
        chain = ex._build_scope_chain(ctx)
        assert chain == [
            ("workspace", "ws-1"),
            ("organization", "org-1"),
        ]

    def test_chain_workspace_only(self):
        ctx = RunContext(
            workspace_id="ws-only",
            actor_type="service_token",
            actor_id="tok-1",
        )
        ex = WorkflowExecutor(
            run_id="run-chain-ws",
            workflow_id="wf-chain-ws",
            run_context=ctx,
        )
        chain = ex._build_scope_chain(ctx)
        assert chain == [("workspace", "ws-only")]

    def test_chain_empty_context(self):
        ctx = RunContext(workspace_id="")
        ex = WorkflowExecutor(
            run_id="run-chain-empty",
            workflow_id="wf-chain-empty",
            run_context=ctx,
        )
        chain = ex._build_scope_chain(ctx)
        assert chain == []


class TestEnvironmentScopeMetadata:
    """Environment scope type/id are captured on RunContext."""

    def test_workspace_scoped_environment(self):
        ctx = RunContext(
            workspace_id="ws-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-1",
            environment_scope_type="workspace",
            environment_scope_id="ws-1",
        )
        assert ctx.environment_scope_type == "workspace"
        assert ctx.environment_scope_id == "ws-1"

    def test_organization_scoped_environment(self):
        ctx = RunContext(
            workspace_id="ws-1",
            org_id="org-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-org",
            environment_scope_type="organization",
            environment_scope_id="org-1",
        )
        assert ctx.environment_scope_type == "organization"
        assert ctx.environment_scope_id == "org-1"

    def test_environment_scoped_environment(self):
        ctx = RunContext(
            workspace_id="ws-1",
            actor_type="user",
            actor_id="u-1",
            environment_id="env-specific",
            environment_scope_type="environment",
            environment_scope_id="env-specific",
        )
        assert ctx.environment_scope_type == "environment"
        assert ctx.environment_scope_id == "env-specific"
