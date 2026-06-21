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


class TestSecretsBlockedInQueryAndPath:
    """F5 partial implementation fix: secrets blocked in query params and path variables."""

    def test_secrets_in_query_params_raises(self, executor):
        """Query param values must reject secret substitution."""
        text = "api_key={{secrets.api_key}}"
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            executor._parse_key_value_pairs(text, allow_secrets=False)

    def test_secrets_in_path_variables_raises(self, executor):
        """Path variable values must reject secret substitution."""
        text = "userId={{secrets.api_key}}"
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            executor._parse_key_value_pairs(text, allow_secrets=False)

    def test_secrets_in_query_params_default_allows(self, executor):
        """Backward compat: default allow_secrets=True still resolves secrets."""
        text = "api_key={{secrets.api_key}}"
        result = executor._parse_key_value_pairs(text)
        assert result == {"api_key": "super-secret-value-123"}

    def test_env_in_query_params_allowed(self, executor):
        """Non-secret variables in query params still work."""
        text = "userId={{variables.userId}}"
        result = executor._parse_key_value_pairs(text, allow_secrets=False)
        assert result == {"userId": "user-42"}

    def test_secrets_in_headers_still_resolves_via_parser(self, executor):
        """Headers parser must still allow secrets (Bearer auth tokens)."""
        text = "Authorization=Bearer {{secrets.api_key}}"
        result = executor._parse_key_value_pairs(text)
        assert result == {"Authorization": "Bearer super-secret-value-123"}

    def test_secrets_in_cookies_still_resolves_via_parser(self, executor):
        """Cookies parser must still allow secrets."""
        text = "session={{secrets.api_key}}"
        result = executor._parse_key_value_pairs(text)
        assert result == {"session": "super-secret-value-123"}
