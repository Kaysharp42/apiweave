"""
Tests for Wave 3 Task 18: value-aware masking and export/log redaction.

Verifies:
- SecretMasker performs pure value-based masking (no key-name heuristic).
- Secret values under non-secret key names (e.g. "message") are redacted.
- Export redaction: resolved secret values never appear in exported data.
- Audit context masking: value-based defense-in-depth on audit context.
"""
import json

from app.services.secret_utils import REDACTED, SecretMasker


class TestSecretMaskerValueBased:
    """SecretMasker masks by resolved value only — key names are irrelevant."""

    def test_empty_masker_passes_through(self):
        masker = SecretMasker()
        assert masker.mask_struct({"message": "hello"}) == {"message": "hello"}
        assert masker.mask_text("hello") == "hello"
        assert masker.has_secrets is False
        assert masker.secret_count == 0

    def test_none_resolved_secrets(self):
        masker = SecretMasker(None)
        assert masker.has_secrets is False

    def test_secret_in_non_secret_key_is_masked(self):
        """QA Scenario task-18a: secret under key 'message' must be <REDACTED>."""
        masker = SecretMasker({"API_TOKEN": "super-secret-value-12345"})
        data = {"message": "auth: super-secret-value-12345 granted", "status": 200}
        result = masker.mask_struct(data)
        assert "super-secret-value-12345" not in result["message"]
        assert REDACTED in result["message"]
        assert result["status"] == 200

    def test_secret_in_nested_non_secret_key(self):
        masker = SecretMasker({"DB_PASS": "hunter2"})
        data = {
            "response": {
                "body": {"message": "connected with hunter2", "code": "OK"},
            }
        }
        result = masker.mask_struct(data)
        assert "hunter2" not in json.dumps(result)
        assert result["response"]["body"]["code"] == "OK"

    def test_secret_in_list_values(self):
        masker = SecretMasker({"KEY": "s3cret"})
        data = {"items": ["s3cret", "public", "also-s3cret-here"]}
        result = masker.mask_struct(data)
        assert result["items"][0] == REDACTED
        assert result["items"][1] == "public"
        assert "s3cret" not in result["items"][2]

    def test_multiple_secrets_longest_first(self):
        masker = SecretMasker({"SHORT": "abc", "LONG": "abcdef"})
        data = {"msg": "found abcdef here"}
        result = masker.mask_struct(data)
        assert "abcdef" not in result["msg"]
        assert "abc" not in result["msg"].replace(REDACTED, "")

    def test_exact_match_returns_redacted(self):
        masker = SecretMasker({"TOKEN": "sk_live_abc123"})
        assert masker.mask_text("sk_live_abc123") == REDACTED

    def test_partial_inline_replacement(self):
        masker = SecretMasker({"TOKEN": "sk_live_abc123"})
        result = masker.mask_text("Bearer sk_live_abc123 granted")
        assert result == f"Bearer {REDACTED} granted"

    def test_empty_secret_values_ignored(self):
        masker = SecretMasker({"EMPTY": "", "VALID": "real-value"})
        assert masker.secret_count == 1
        result = masker.mask_text("contains real-value here")
        assert "real-value" not in result

    def test_non_string_values_pass_through(self):
        masker = SecretMasker({"KEY": "secret"})
        assert masker.mask_struct(42) == 42
        assert masker.mask_struct(True) is True
        assert masker.mask_struct(None) is None

    def test_key_name_not_used_for_masking(self):
        """Key names like 'api_key' should NOT trigger masking without value match."""
        masker = SecretMasker({"OTHER": "different-value"})
        data = {"api_key": "some-public-value", "safe": "ok"}
        result = masker.mask_struct(data)
        assert result["api_key"] == "some-public-value"
        assert result["safe"] == "ok"


class TestExportRedaction:
    """QA Scenario task-18b: exports contain no resolved secret values."""

    def test_export_with_secret_value_in_body(self):
        """Simulate an export payload containing a resolved secret value."""
        secret_value = "NEVER_LEAK_ME_abc123"
        masker = SecretMasker({"API_TOKEN": secret_value})

        export_data = {
            "workflows": [
                {
                    "name": "Test Workflow",
                    "nodes": [
                        {
                            "nodeId": "httpRequest_1",
                            "config": {
                                "body": json.dumps({"token": secret_value}),
                                "url": "https://api.example.com",
                            },
                        }
                    ],
                    "variables": {"extracted": secret_value},
                }
            ],
            "environments": [
                {
                    "name": "Production",
                    "variables": {"baseUrl": "https://api.example.com"},
                }
            ],
        }

        masked = masker.mask_struct(export_data)
        serialized = json.dumps(masked)
        assert secret_value not in serialized
        assert REDACTED in serialized

    def test_export_no_false_positives(self):
        """Non-secret data should pass through unchanged."""
        masker = SecretMasker({"TOKEN": "super-secret"})
        export_data = {
            "workflows": [{"name": "Test", "variables": {"baseUrl": "https://example.com"}}],
        }
        masked = masker.mask_struct(export_data)
        assert masked["workflows"][0]["variables"]["baseUrl"] == "https://example.com"


class TestAuditContextMasking:
    """Audit context value-based defense-in-depth."""

    def test_mask_context_values_masks_strings(self):
        from app.services.audit_service import mask_context_values

        masker = SecretMasker({"TOKEN": "secret-val-123"})
        context = {"runId": "run_1", "detail": "used secret-val-123 for auth"}
        masked = mask_context_values(context, masker)
        assert "secret-val-123" not in masked["detail"]
        assert masked["runId"] == "run_1"

    def test_mask_context_values_no_secrets(self):
        from app.services.audit_service import mask_context_values

        masker = SecretMasker()
        context = {"runId": "run_1", "detail": "all good"}
        masked = mask_context_values(context, masker)
        assert masked == context

    def test_mask_context_values_non_string_passthrough(self):
        from app.services.audit_service import mask_context_values

        masker = SecretMasker({"TOKEN": "secret"})
        context = {"count": 42, "flag": True, "detail": "has secret in it"}
        masked = mask_context_values(context, masker)
        assert masked["count"] == 42
        assert masked["flag"] is True
        assert "secret" not in masked["detail"]
