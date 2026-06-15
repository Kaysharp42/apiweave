"""Tests for executor secrets resolution (T7).

Verifies that:
- {{secrets.X}} resolves to decrypted plaintext in headers and body
- {{secrets.X}} is blocked in URL/query/path contexts (F5 preserved)
- Decrypted secret values are masked in log output
- Decrypted secret values are masked in stored results
- EnvironmentRepository.get_decrypted_secrets returns Dict[str, str]
"""
import logging
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.modules.setdefault("app.services.run_service", MagicMock())

from app.runner.executor import WorkflowExecutor
from app.services.secret_utils import REDACTED, mask_log_value, mask_secrets_structural


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
        data = {"response": {"api_key": "some-value", "safe": "ok"}}
        masked = executor._mask_result_secrets(data)
        assert masked["response"]["api_key"] == REDACTED
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
