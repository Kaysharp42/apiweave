"""
Tests for security-remediation task 11: structural masking integration.

Verifies that:
- mask_log_value correctly masks secrets in log text (used by executor._mask_secrets)
- mask_secrets_structural correctly masks secrets in result objects (used by executor._mask_result_secrets)
- Env debug log redaction works (mask_log_value applied to env values)
- Webhook payload sanitization works (mask_secrets_structural applied before Run.variables)

Note: We test the underlying functions directly because importing WorkflowExecutor
triggers a circular import in the test environment. The executor methods are thin
wrappers that delegate to these functions.
"""
import logging

import pytest

from app.services.secret_utils import (
    REDACTED,
    mask_log_value,
    mask_secrets_structural,
)


# ---------------------------------------------------------------------------
# _mask_secrets integration (executor delegates to mask_log_value)
# ---------------------------------------------------------------------------

class TestMaskSecretsLog:
    """mask_log_value is what executor._mask_secrets now calls."""

    def test_masks_secret_in_text(self):
        result = mask_log_value(
            "The token is super-secret-value ok",
            ["super-secret-value"],
        )
        assert "super-secret-value" not in result
        assert REDACTED in result

    def test_masks_multiple_secrets(self):
        result = mask_log_value(
            "alpha-secret and beta-secret",
            ["alpha-secret", "beta-secret"],
        )
        assert "alpha-secret" not in result
        assert "beta-secret" not in result

    def test_no_secrets_returns_unchanged(self):
        text = "nothing to mask here"
        assert mask_log_value(text, []) == text

    def test_empty_string_returns_empty(self):
        assert mask_log_value("", ["v"]) == ""

    def test_exact_match_full_redaction(self):
        result = mask_log_value("sk_live_abc123", ["sk_live_abc123"])
        assert result == REDACTED

    def test_longest_first_replacement(self):
        """Longest secret replaced first to avoid prefix collisions."""
        result = mask_log_value("found abc here", ["a", "abc"])
        assert result == f"found {REDACTED} here"


# ---------------------------------------------------------------------------
# _mask_result_secrets integration (executor delegates to mask_secrets_structural)
# ---------------------------------------------------------------------------

class TestMaskResultSecrets:
    """mask_secrets_structural is what executor._mask_result_secrets now calls."""

    def test_masks_dict_values(self):
        data = {"response": "Bearer sk_live_abc123", "status": 200}
        result = mask_secrets_structural(data, ["sk_live_abc123"])
        assert "sk_live_abc123" not in str(result)
        assert result["status"] == 200

    def test_masks_by_key_name(self):
        data = {"api_key": "some-value", "safe": "ok"}
        result = mask_secrets_structural(data, [])
        assert result["api_key"] == REDACTED
        assert result["safe"] == "ok"

    def test_masks_nested_structure(self):
        data = {
            "level1": {
                "password": "hunter2",
                "items": ["hunter2", "public"],
            }
        }
        result = mask_secrets_structural(data, ["hunter2"])
        assert result["level1"]["password"] == REDACTED
        assert result["level1"]["items"][0] == REDACTED
        assert result["level1"]["items"][1] == "public"

    def test_no_secrets_returns_unchanged(self):
        data = {"foo": "bar"}
        result = mask_secrets_structural(data, [])
        assert result == {"foo": "bar"}

    def test_string_input_masked(self):
        result = mask_secrets_structural("contains secret-val here", ["secret-val"])
        assert "secret-val" not in result
        assert REDACTED in result

    def test_non_string_non_dict_non_list_passes_through(self):
        assert mask_secrets_structural(42, ["x"]) == 42
        assert mask_secrets_structural(True, ["x"]) is True
        assert mask_secrets_structural(None, ["x"]) is None


# ---------------------------------------------------------------------------
# Env debug log redaction
# ---------------------------------------------------------------------------

class TestEnvDebugLogRedaction:
    """The env substitution debug log must not contain raw secret values.

    executor.py line ~814 now does:
        safe_value_repr = mask_log_value(str(value), list(self.secrets.values()) ...)
        self.logger.debug(f"... -> {safe_value_repr}")
    """

    def test_secret_value_is_redacted_in_log(self):
        secret_val = "my-super-secret-env-val"
        log_output = mask_log_value(secret_val, [secret_val])
        assert log_output == REDACTED
        assert secret_val not in log_output

    def test_partial_secret_in_log_is_redacted(self):
        secret_val = "db-password-123"
        log_output = mask_log_value(f"Connected with {secret_val}", [secret_val])
        assert secret_val not in log_output
        assert REDACTED in log_output

    def test_non_secret_value_passes_through(self):
        log_output = mask_log_value("localhost:5432", [])
        assert log_output == "localhost:5432"


# ---------------------------------------------------------------------------
# Webhook payload sanitization
# ---------------------------------------------------------------------------

class TestWebhookPayloadSanitization:
    """Webhook payload is sanitized via mask_secrets_structural before
    being stored in Run.variables (webhooks.py ~line 849)."""

    def test_payload_with_secret_key_name_is_redacted(self):
        payload = {"api_key": "sk_live_123", "name": "test"}
        sanitized = mask_secrets_structural(payload, [])
        assert sanitized["api_key"] == REDACTED
        assert sanitized["name"] == "test"

    def test_payload_with_secret_value_is_redacted(self):
        payload = {"message": "token is sk_live_abc"}
        sanitized = mask_secrets_structural(payload, ["sk_live_abc"])
        assert "sk_live_abc" not in sanitized["message"]
        assert REDACTED in sanitized["message"]

    def test_empty_payload_passes_through(self):
        sanitized = mask_secrets_structural({}, [])
        assert sanitized == {}

    def test_nested_payload_with_mixed_keys(self):
        payload = {
            "user": "alice",
            "auth": {"access_token": "tok_123", "scope": "read"},
            "data": {"api_key": "key_456", "value": "public"},
        }
        sanitized = mask_secrets_structural(payload, [])
        assert sanitized["user"] == "alice"
        assert sanitized["auth"]["access_token"] == REDACTED
        assert sanitized["auth"]["scope"] == "read"
        assert sanitized["data"]["api_key"] == REDACTED
        assert sanitized["data"]["value"] == "public"
