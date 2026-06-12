"""Tests for {{secrets.*}} substitution restrictions in URL/query/path contexts (F5)."""
import logging
import sys
from unittest.mock import MagicMock

import pytest

# Break circular import: executor -> app.services -> run_service -> executor
sys.modules.setdefault("app.services.run_service", MagicMock())

from app.runner.executor import WorkflowExecutor


@pytest.fixture()
def executor():
    ex = WorkflowExecutor(run_id="run-test-9", workflow_id="wf-test-9")
    ex.secrets = {"api_key": "super-secret-value-123"}
    ex.environment_variables = {"baseUrl": "https://api.example.com"}
    ex.workflow_variables = {"userId": "user-42"}
    ex.results = {"node-1": {"response": {"body": {"token": "prev-token"}}}}
    return ex


class TestSecretsBlockedInUrl:
    def test_secrets_in_url_raises(self, executor):
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            executor._substitute_variables(
                "https://api.example.com?key={{secrets.api_key}}",
                allow_secrets=False,
            )

    def test_secrets_with_whitespace_raises(self, executor):
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            executor._substitute_variables(
                "{{ secrets.api_key }}",
                allow_secrets=False,
            )

    def test_secrets_in_body_still_resolves(self, executor):
        result = executor._substitute_variables('{"key": "{{secrets.api_key}}"}')
        assert "super-secret-value-123" in result

    def test_secrets_in_header_still_resolves(self, executor):
        result = executor._substitute_variables("Bearer {{secrets.api_key}}")
        assert "super-secret-value-123" in result

    def test_env_in_url_allowed(self, executor):
        result = executor._substitute_variables(
            "{{env.baseUrl}}/users",
            allow_secrets=False,
        )
        assert result == "https://api.example.com/users"

    def test_variables_in_url_allowed(self, executor):
        result = executor._substitute_variables(
            "/users/{{variables.userId}}",
            allow_secrets=False,
        )
        assert result == "/users/user-42"

    def test_prev_in_url_allowed(self, executor):
        result = executor._substitute_variables(
            "/auth/{{prev.response.body.token}}",
            allow_secrets=False,
        )
        assert result == "/auth/prev-token"


class TestDebugLogRedaction:
    def test_env_debug_log_masks_secret_value(self, executor, caplog):
        executor.environment_variables = {"token": "super-secret-value-123"}
        with caplog.at_level(logging.DEBUG, logger=f"run_{executor.run_id}"):
            executor._substitute_variables("{{env.token}}")
        for record in caplog.records:
            assert "super-secret-value-123" not in record.getMessage()
