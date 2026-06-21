"""
Task 28 — Runtime secrets rejection (negative test).

Verifies that:
- The executor no longer accepts runtime_secrets (parameter was removed)
- Passing runtime_secrets raises TypeError (unexpected keyword argument)
"""

from __future__ import annotations

import pytest
from app.runner.executor import WorkflowExecutor


class TestRuntimeSecretsRejected:
    """runtime_secrets parameter was removed — passing it raises TypeError."""

    def test_nonempty_runtime_secrets_raises(self):
        with pytest.raises(TypeError):
            WorkflowExecutor(
                run_id="run-reject-1",
                workflow_id="wf-reject-1",
                runtime_secrets={"API_KEY": "sk-live-123"},
            )

    def test_multiple_secrets_raises(self):
        with pytest.raises(TypeError):
            WorkflowExecutor(
                run_id="run-reject-2",
                workflow_id="wf-reject-2",
                runtime_secrets={"A": "1", "B": "2", "C": "3"},
            )

    def test_none_runtime_secrets_accepted(self):
        """Constructing without runtime_secrets works fine."""
        ex = WorkflowExecutor(
            run_id="run-ok-none",
            workflow_id="wf-ok-none",
        )
        assert ex.run_id == "run-ok-none"

    def test_empty_dict_runtime_secrets_accepted(self):
        """Constructing without runtime_secrets works fine (no kwarg)."""
        ex = WorkflowExecutor(
            run_id="run-ok-empty",
            workflow_id="wf-ok-empty",
        )
        assert ex.run_id == "run-ok-empty"

    def test_error_message_mentions_scoped_chain(self):
        """Passing runtime_secrets raises TypeError (parameter removed)."""
        with pytest.raises(TypeError):
            WorkflowExecutor(
                run_id="run-msg",
                workflow_id="wf-msg",
                runtime_secrets={"KEY": "val"},
            )
