"""
Task 28 — Runtime secrets rejection (negative test).

Verifies that:
- The executor rejects runtime_secrets with a non-empty dict
- The executor accepts None and empty dict (backward compat)
- The error message is clear about the scoped secret model
"""

from __future__ import annotations

import pytest

from app.runner.executor import WorkflowExecutor


class TestRuntimeSecretsRejected:
    """runtime_secrets field is rejected — all secrets must use scoped storage."""

    def test_nonempty_runtime_secrets_raises(self):
        with pytest.raises(ValueError, match="runtime_secrets field is rejected"):
            WorkflowExecutor(
                run_id="run-reject-1",
                workflow_id="wf-reject-1",
                runtime_secrets={"API_KEY": "sk-live-123"},
            )

    def test_multiple_secrets_raises(self):
        with pytest.raises(ValueError, match="runtime_secrets field is rejected"):
            WorkflowExecutor(
                run_id="run-reject-2",
                workflow_id="wf-reject-2",
                runtime_secrets={"A": "1", "B": "2", "C": "3"},
            )

    def test_none_runtime_secrets_accepted(self):
        ex = WorkflowExecutor(
            run_id="run-ok-none",
            workflow_id="wf-ok-none",
            runtime_secrets=None,
        )
        assert ex.run_id == "run-ok-none"

    def test_empty_dict_runtime_secrets_accepted(self):
        ex = WorkflowExecutor(
            run_id="run-ok-empty",
            workflow_id="wf-ok-empty",
            runtime_secrets={},
        )
        assert ex.run_id == "run-ok-empty"

    def test_error_message_mentions_scoped_chain(self):
        """Error message guides users to the scoped secret model."""
        with pytest.raises(ValueError) as exc_info:
            WorkflowExecutor(
                run_id="run-msg",
                workflow_id="wf-msg",
                runtime_secrets={"KEY": "val"},
            )
        msg = str(exc_info.value)
        assert "scoped" in msg.lower() or "Environment" in msg
