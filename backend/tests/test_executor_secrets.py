"""Tests for executor secrets resolution (T7, extended T16).

Verifies that:
- {{secrets.X}} resolves to decrypted plaintext in headers and body
- {{secrets.X}} is blocked in URL/query/path contexts (F5 preserved)
- Decrypted secret values are masked in log output
- Decrypted secret values are masked in stored results
- EnvironmentRepository.get_decrypted_secrets returns Dict[str, str]
- E2: secrets resolve in outgoing HTTP headers and body (mocked aiohttp)
- E6: log files do not leak secret plaintext after resolution
- E7: export sanitization scrubs secret-keyed values from bundles
- F4/F5: no regression in URL/query/path blocking patterns
"""
import json
import logging
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.modules.setdefault("app.services.run_service", MagicMock())

from app.runner.executor import WorkflowExecutor
from app.services.secret_utils import (
    REDACTED,
    mask_log_value,
    mask_secrets_structural,
    sanitize_secrets_in_dict,
)


@pytest.fixture()
def executor():
    ex = WorkflowExecutor(run_id="run-test-t7", workflow_id="wf-test-t7")
    ex.secrets = {"api_key": "sk_live_decrypted_abc123", "db_password": "hunter2_secret"}
    ex.environment_variables = {"baseUrl": "https://api.example.com"}
    ex.workflow_variables = {}
    ex.results = {}
    return ex


class TestHeaderResolution:
    def test_secret_resolves_in_header(self, executor):
        result = executor._substitute_variables("Bearer {{secrets.api_key}}")
        assert result == "Bearer sk_live_decrypted_abc123"

    def test_multiple_secrets_in_headers(self, executor):
        result = executor._substitute_variables(
            "X-Api-Key: {{secrets.api_key}}\nX-Db-Pass: {{secrets.db_password}}"
        )
        assert "sk_live_decrypted_abc123" in result
        assert "hunter2_secret" in result


class TestBodyResolution:
    def test_secret_resolves_in_json_body(self, executor):
        result = executor._substitute_variables(
            '{"key": "{{secrets.api_key}}", "pass": "{{secrets.db_password}}"}'
        )
        assert "sk_live_decrypted_abc123" in result
        assert "hunter2_secret" in result

    def test_secret_resolves_in_form_body(self, executor):
        result = executor._substitute_variables("api_key={{secrets.api_key}}")
        assert result == "api_key=sk_live_decrypted_abc123"


class TestUrlBlocked:
    def test_secrets_in_url_raises(self, executor):
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            executor._substitute_variables(
                "https://api.example.com?key={{secrets.api_key}}",
                allow_secrets=False,
            )

    def test_secrets_in_query_params_raises(self, executor):
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            executor._parse_key_value_pairs(
                "key={{secrets.api_key}}",
                allow_secrets=False,
            )


class TestLogMasked:
    def test_mask_secrets_masks_decrypted_value(self, executor):
        text = f"Request sent with token sk_live_decrypted_abc123"
        masked = executor._mask_secrets(text)
        assert "sk_live_decrypted_abc123" not in masked
        assert REDACTED in masked

    def test_mask_secrets_masks_all_secrets(self, executor):
        text = "key=sk_live_decrypted_abc123 pass=hunter2_secret"
        masked = executor._mask_secrets(text)
        assert "sk_live_decrypted_abc123" not in masked
        assert "hunter2_secret" not in masked

    def test_debug_log_does_not_leak_secret(self, executor, caplog):
        executor.environment_variables = {"token": "sk_live_decrypted_abc123"}
        with caplog.at_level(logging.DEBUG, logger=f"run_{executor.run_id}"):
            executor._substitute_variables("{{env.token}}")
        for record in caplog.records:
            assert "sk_live_decrypted_abc123" not in record.getMessage()


class TestNoResultLeak:
    def test_mask_result_secrets_masks_values(self, executor):
        data = {"response": {"body": {"token": "sk_live_decrypted_abc123"}}}
        masked = executor._mask_result_secrets(data)
        assert "sk_live_decrypted_abc123" not in str(masked)
        assert masked["response"]["body"]["token"] == REDACTED

    def test_mask_result_secrets_masks_by_key_name(self, executor):
        """Wave 3 Task 18: key-name heuristic removed; only resolved values are masked.
        A value under a secret-sounding key that is NOT a resolved secret value
        should pass through unchanged."""
        data = {"response": {"api_key": "some-value", "safe": "ok"}}
        masked = executor._mask_result_secrets(data)
        assert masked["response"]["api_key"] == "some-value"
        assert masked["response"]["safe"] == "ok"


class TestGetDecryptedSecrets:
    @pytest.mark.asyncio
    async def test_returns_plaintext_dict(self):
        from app.repositories.environment_repository import EnvironmentRepository

        mock_env = MagicMock()
        mock_env.secrets = {
            "legacy_key": "plain-text-value",
            "encrypted_key": {
                "ciphertext": "Y2lwaGVydGV4dA==",
                "kek_id": "kek-1",
                "algorithm": "aes-256-gcm",
                "nonce": "bm9uY2U=",
            },
        }

        with patch.object(
            EnvironmentRepository, "get_by_id", new=AsyncMock(return_value=mock_env)
        ), patch(
            "app.services.secret_crypto.decrypt",
            new=AsyncMock(return_value="decrypted-value"),
        ):
            result = await EnvironmentRepository.get_decrypted_secrets("env-123")

        assert result == {"legacy_key": "plain-text-value", "encrypted_key": "decrypted-value"}

    @pytest.mark.asyncio
    async def test_returns_empty_for_missing_env(self):
        from app.repositories.environment_repository import EnvironmentRepository

        with patch.object(
            EnvironmentRepository, "get_by_id", new=AsyncMock(return_value=None)
        ):
            result = await EnvironmentRepository.get_decrypted_secrets("nonexistent")

        assert result == {}


# ---------------------------------------------------------------------------
# Helpers for E2 tests (T16 extension)
# ---------------------------------------------------------------------------

# Secret values are defined once and passed via indirect parametrization so
# they never appear as bare string literals in test function signatures
# (which could be captured by log-scraping fixtures).
_SECRET_HEADER_VALUE = "sk-t16-header-z9Qx4vLm"
_SECRET_BODY_VALUE = "sk-t16-body-pR7wN3kY"


def _make_mock_response(
    status: int = 200,
    body: str = '{"ok": true}',
    content_type: str = "application/json",
) -> MagicMock:
    resp = AsyncMock()
    resp.status = status
    resp.text = AsyncMock(return_value=body)
    hdrs = {"Content-Type": content_type}
    headers_mock = MagicMock()
    headers_mock.__getitem__.side_effect = hdrs.__getitem__
    headers_mock.get.side_effect = lambda key, default="": hdrs.get(key, default)
    headers_mock.getall = MagicMock(return_value=[])
    resp.headers = headers_mock
    return resp


def _make_mock_session() -> MagicMock:
    session = AsyncMock()
    session.close = AsyncMock()
    return session


# ---------------------------------------------------------------------------
# T16-1: E2 — secret resolves in Authorization header (mocked HTTP)
# ---------------------------------------------------------------------------


class TestE2SecretInAuthHeader:
    """E2 acceptance: outgoing HTTP request carries the resolved secret
    in the Authorization header."""

    @pytest.mark.asyncio
    async def test_header_resolved_in_outgoing_request(self):
        ex = WorkflowExecutor(run_id="run-t16-hdr", workflow_id="wf-t16-hdr")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        node = {
            "nodeId": "http_1",
            "type": "httpRequest",
            "config": {
                "method": "GET",
                "url": "https://api.example.com/data",
                "headers": f"Authorization=Bearer {{{{secrets.apiKey}}}}",
                "body": "",
                "timeout": 5,
                "queryParams": "",
                "pathVariables": "",
                "cookies": "",
                "fileUploads": [],
            },
        }

        mock_resp = _make_mock_response()
        mock_sess = _make_mock_session()

        captured_headers: dict = {}

        async def fake_safe_request(method, url, **kwargs):
            captured_headers.update(kwargs.get("headers", {}))
            return mock_resp, mock_sess

        with patch(
            "app.services.safe_http.safe_request",
            side_effect=fake_safe_request,
        ), patch("app.services.safe_http.validate_url"):
            await ex._execute_http_request(node)

        assert captured_headers.get("Authorization") == f"Bearer {_SECRET_HEADER_VALUE}"

    @pytest.mark.asyncio
    async def test_multiple_secret_headers_resolved(self):
        ex = WorkflowExecutor(run_id="run-t16-hdr2", workflow_id="wf-t16-hdr2")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE, "dbPass": _SECRET_BODY_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        node = {
            "nodeId": "http_2",
            "type": "httpRequest",
            "config": {
                "method": "POST",
                "url": "https://api.example.com/submit",
                "headers": (
                    f"X-Api-Key={{{{secrets.apiKey}}}}\n"
                    f"X-Db-Pass={{{{secrets.dbPass}}}}"
                ),
                "body": "{}",
                "bodyType": "json",
                "timeout": 5,
                "queryParams": "",
                "pathVariables": "",
                "cookies": "",
                "fileUploads": [],
            },
        }

        mock_resp = _make_mock_response()
        mock_sess = _make_mock_session()
        captured: dict = {}

        async def fake_safe_request(method, url, **kwargs):
            captured.update(kwargs.get("headers", {}))
            return mock_resp, mock_sess

        with patch(
            "app.services.safe_http.safe_request",
            side_effect=fake_safe_request,
        ), patch("app.services.safe_http.validate_url"):
            await ex._execute_http_request(node)

        assert captured["X-Api-Key"] == _SECRET_HEADER_VALUE
        assert captured["X-Db-Pass"] == _SECRET_BODY_VALUE


# ---------------------------------------------------------------------------
# T16-2: E2 — secret resolves in JSON body (mocked HTTP)
# ---------------------------------------------------------------------------


class TestE2SecretInJsonBody:
    """E2 acceptance: outgoing HTTP request body contains the resolved
    secret value after template substitution."""

    @pytest.mark.asyncio
    async def test_body_resolved_in_outgoing_request(self):
        ex = WorkflowExecutor(run_id="run-t16-body", workflow_id="wf-t16-body")
        ex.secrets = {"payload": _SECRET_BODY_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        body_template = json.dumps({"key": "{{secrets.payload}}"})
        node = {
            "nodeId": "http_3",
            "type": "httpRequest",
            "config": {
                "method": "POST",
                "url": "https://api.example.com/data",
                "headers": "Content-Type=application/json",
                "body": body_template,
                "bodyType": "json",
                "timeout": 5,
                "queryParams": "",
                "pathVariables": "",
                "cookies": "",
                "fileUploads": [],
            },
        }

        mock_resp = _make_mock_response()
        mock_sess = _make_mock_session()
        captured_json: dict = {}

        async def fake_safe_request(method, url, **kwargs):
            if kwargs.get("json") is not None:
                captured_json.update(kwargs["json"])
            return mock_resp, mock_sess

        with patch(
            "app.services.safe_http.safe_request",
            side_effect=fake_safe_request,
        ), patch("app.services.safe_http.validate_url"):
            await ex._execute_http_request(node)

        assert captured_json.get("key") == _SECRET_BODY_VALUE


# ---------------------------------------------------------------------------
# T16-3: F5 — secret in URL still blocked (E2 via _execute_http_request)
# ---------------------------------------------------------------------------


class TestF5UrlBlockedE2E:
    """F5 acceptance: _execute_http_request raises ValueError when the URL
    template contains a {{secrets.*}} placeholder."""

    @pytest.mark.asyncio
    async def test_url_blocked_in_http_request_node(self):
        ex = WorkflowExecutor(run_id="run-t16-url", workflow_id="wf-t16-url")
        ex.secrets = {"host": "evil.example.com"}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        node = {
            "nodeId": "http_4",
            "type": "httpRequest",
            "config": {
                "method": "GET",
                "url": "https://{{secrets.host}}/path",
                "headers": "",
                "body": "",
                "timeout": 5,
                "queryParams": "",
                "pathVariables": "",
                "cookies": "",
                "fileUploads": [],
            },
        }

        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            await ex._execute_http_request(node)

    @pytest.mark.asyncio
    async def test_query_params_blocked_in_http_request_node(self):
        ex = WorkflowExecutor(run_id="run-t16-qp", workflow_id="wf-t16-qp")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        node = {
            "nodeId": "http_5",
            "type": "httpRequest",
            "config": {
                "method": "GET",
                "url": "https://api.example.com/data",
                "headers": "",
                "body": "",
                "timeout": 5,
                "queryParams": "key={{secrets.apiKey}}",
                "pathVariables": "",
                "cookies": "",
                "fileUploads": [],
            },
        }

        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            await ex._execute_http_request(node)


# ---------------------------------------------------------------------------
# T16-4: E6 — log masking (run log does not contain secret plaintext)
# ---------------------------------------------------------------------------


class TestE6LogMasking:
    """E6 acceptance: after secret resolution the executor's logger output
    does not contain the raw secret value."""

    def test_log_masked_after_substitution(self, caplog):
        ex = WorkflowExecutor(run_id="run-t16-log", workflow_id="wf-t16-log")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        result = ex._substitute_variables("Bearer {{secrets.apiKey}}")
        assert result == f"Bearer {_SECRET_HEADER_VALUE}"

        masked = ex._mask_secrets(result)
        assert _SECRET_HEADER_VALUE not in masked
        assert REDACTED in masked

    def test_log_masked_captures_no_plaintext(self, caplog):
        ex = WorkflowExecutor(run_id="run-t16-log2", workflow_id="wf-t16-log2")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        with caplog.at_level(logging.DEBUG, logger=f"run_{ex.run_id}"):
            ex._substitute_variables("Bearer {{secrets.apiKey}}")

        for record in caplog.records:
            msg = record.getMessage()
            assert _SECRET_HEADER_VALUE not in msg, (
                f"Secret leaked in log record: {msg}"
            )

    def test_mask_secrets_structural_in_result(self):
        """Result objects passed through mask_secrets_structural do not
        contain the raw secret value anywhere in their string form."""
        data = {
            "request": {
                "headers": {"Authorization": f"Bearer {_SECRET_HEADER_VALUE}"},
            },
            "response": {"body": {"token": _SECRET_HEADER_VALUE}},
        }
        masked = mask_secrets_structural(data, [_SECRET_HEADER_VALUE])
        serialized = json.dumps(masked)
        assert _SECRET_HEADER_VALUE not in serialized


# ---------------------------------------------------------------------------
# T16-5: E7 — export scrub (sanitized export does not contain secrets)
# ---------------------------------------------------------------------------


class TestE7ExportScrub:
    """E7 acceptance: workflow export sanitization replaces secret-keyed
    values with <SECRET> placeholder."""

    def test_export_scrubs_secret_keyed_variables(self):
        workflow_variables = {
            "baseUrl": "https://api.example.com",
            "api_key": _SECRET_HEADER_VALUE,
            "auth_token": _SECRET_BODY_VALUE,
        }
        secret_refs: list[str] = []
        sanitized = sanitize_secrets_in_dict(workflow_variables, secret_refs)

        assert sanitized["baseUrl"] == "https://api.example.com"
        assert sanitized["api_key"] == "<SECRET>"
        assert sanitized["auth_token"] == "<SECRET>"
        assert _SECRET_HEADER_VALUE not in json.dumps(sanitized)
        assert _SECRET_BODY_VALUE not in json.dumps(sanitized)

    def test_export_scrubs_nested_node_config(self):
        node_config = {
            "method": "POST",
            "url": "https://api.example.com/data",
            "headers": {
                "Authorization": f"Bearer {_SECRET_HEADER_VALUE}",
                "Content-Type": "application/json",
            },
        }
        secret_refs: list[str] = []
        sanitized = sanitize_secrets_in_dict(node_config, secret_refs)

        assert sanitized["headers"]["Authorization"] == "<SECRET>"
        assert sanitized["headers"]["Content-Type"] == "application/json"
        assert sanitized["method"] == "POST"

    def test_export_preserves_non_secret_data(self):
        data = {
            "name": "My Workflow",
            "description": "Test workflow",
            "variables": {
                "baseUrl": "https://api.example.com",
                "timeout": "30",
            },
        }
        secret_refs: list[str] = []
        sanitized = sanitize_secrets_in_dict(data, secret_refs)
        assert sanitized == data


# ---------------------------------------------------------------------------
# T16-6: No result leak (stored results do not contain decrypted secrets)
# ---------------------------------------------------------------------------


class TestNoResultLeakExtended:
    """Extended no-leak tests: verify that _mask_result_secrets catches
    secrets in deeply nested structures and list items."""

    def test_mask_deeply_nested_secret(self):
        ex = WorkflowExecutor(run_id="run-t16-nested", workflow_id="wf-t16-nested")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        data = {
            "level1": {
                "level2": {
                    "level3": {
                        "response": f"token={_SECRET_HEADER_VALUE}",
                    }
                }
            }
        }
        masked = ex._mask_result_secrets(data)
        serialized = json.dumps(masked)
        assert _SECRET_HEADER_VALUE not in serialized

    def test_mask_secret_in_list_items(self):
        ex = WorkflowExecutor(run_id="run-t16-list", workflow_id="wf-t16-list")
        ex.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        ex.environment_variables = {}
        ex.workflow_variables = {}
        ex.results = {}

        data = {
            "tokens": [_SECRET_HEADER_VALUE, "public-value", _SECRET_BODY_VALUE],
        }
        ex.secrets["dbPass"] = _SECRET_BODY_VALUE
        masked = ex._mask_result_secrets(data)
        serialized = json.dumps(masked)
        assert _SECRET_HEADER_VALUE not in serialized
        assert _SECRET_BODY_VALUE not in serialized
        assert "public-value" in serialized

    def test_mask_empty_secrets_is_noop(self):
        ex = WorkflowExecutor(run_id="run-t16-empty", workflow_id="wf-t16-empty")
        ex.secrets = {}
        data = {"token": "some-value"}
        masked = ex._mask_result_secrets(data)
        assert masked == data


# ---------------------------------------------------------------------------
# T16-7: F4/F5 no regression (parametrized blocking patterns)
# ---------------------------------------------------------------------------


class TestF4F5NoRegression:
    """F4/F5 acceptance: all existing secret-blocking patterns still work.
    Uses indirect parametrization so secret values are never in test IDs."""

    @pytest.fixture()
    def ex(self):
        executor = WorkflowExecutor(run_id="run-t16-reg", workflow_id="wf-t16-reg")
        executor.secrets = {"apiKey": _SECRET_HEADER_VALUE}
        executor.environment_variables = {"baseUrl": "https://api.example.com"}
        executor.workflow_variables = {"userId": "user-42"}
        executor.results = {}
        return executor

    @pytest.mark.parametrize(
        "template",
        [
            pytest.param(
                "https://{{secrets.apiKey}}.example.com/path",
                id="secret-in-host",
            ),
            pytest.param(
                "https://api.example.com?key={{secrets.apiKey}}",
                id="secret-in-query-value",
            ),
            pytest.param(
                "https://api.example.com/{{secrets.apiKey}}",
                id="secret-in-path-segment",
            ),
        ],
    )
    def test_url_context_blocks_secrets(self, ex, template):
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            ex._substitute_variables(template, allow_secrets=False)

    @pytest.mark.parametrize(
        "kv_text",
        [
            pytest.param(
                "key={{secrets.apiKey}}",
                id="kv-equals-secret",
            ),
            pytest.param(
                "key: {{secrets.apiKey}}",
                id="kv-colon-secret",
            ),
        ],
    )
    def test_query_path_kv_blocks_secrets(self, ex, kv_text):
        with pytest.raises(ValueError, match="Secret substitution not allowed"):
            ex._parse_key_value_pairs(kv_text, allow_secrets=False)

    def test_env_vars_still_resolve_in_url(self, ex):
        result = ex._substitute_variables(
            "{{env.baseUrl}}/users",
            allow_secrets=False,
        )
        assert result == "https://api.example.com/users"

    def test_workflow_vars_still_resolve_in_url(self, ex):
        result = ex._substitute_variables(
            "/users/{{variables.userId}}",
            allow_secrets=False,
        )
        assert result == "/users/user-42"

    def test_secrets_still_resolve_in_headers(self, ex):
        result = ex._substitute_variables("Bearer {{secrets.apiKey}}")
        assert result == f"Bearer {_SECRET_HEADER_VALUE}"

    def test_secrets_still_resolve_in_body(self, ex):
        result = ex._substitute_variables('{"key": "{{secrets.apiKey}}"}')
        assert _SECRET_HEADER_VALUE in result
