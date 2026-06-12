"""
Tests for secret_utils structural masking and log masking helpers.
Security-remediation wave 1 — task 5.
"""
from app.services.secret_utils import (
    REDACTED,
    is_secret_key,
    mask_log_value,
    mask_secrets_structural,
    sanitize_secrets_in_dict,
)


class TestMaskSecretsStructural:
    """mask_secrets_structural walks dict/list/str and masks by key-name
    and exact-value replacement."""

    def test_real_secret_redacted_by_key(self):
        data = {"api_key": "sk_live_abc123"}
        result = mask_secrets_structural(data, ["sk_live_abc123"])
        assert result["api_key"] == REDACTED

    def test_real_secret_redacted_by_value(self):
        data = {"foo": "bar", "baz": "sk_live_abc123"}
        result = mask_secrets_structural(data, ["sk_live_abc123"])
        assert result["foo"] == "bar"
        assert result["baz"] == REDACTED

    def test_non_secret_request_id_preserved(self):
        data = {"headers": {"X-Request-Token-Id": "req_123"}}
        result = mask_secrets_structural(data, [])
        assert result == {"headers": {"X-Request-Token-Id": "req_123"}}

    def test_longest_first_replacement(self):
        data = {"msg": "found abc here"}
        result = mask_secrets_structural(data, ["a", "abc"])
        assert "abc" not in result["msg"]
        assert result["msg"] == f"found {REDACTED} here"

    def test_nested_dict_walk(self):
        data = {
            "level1": {
                "level2": {
                    "password": "hunter2",
                    "safe_field": "visible",
                }
            }
        }
        result = mask_secrets_structural(data, ["hunter2"])
        assert result["level1"]["level2"]["password"] == REDACTED
        assert result["level1"]["level2"]["safe_field"] == "visible"

    def test_list_walk(self):
        data = {"items": ["sk_live_abc123", "public_value", "sk_live_abc123"]}
        result = mask_secrets_structural(data, ["sk_live_abc123"])
        assert result["items"][0] == REDACTED
        assert result["items"][1] == "public_value"
        assert result["items"][2] == REDACTED

    def test_partial_value_not_replaced(self):
        data = {"note": "sk_live_abcdef"}
        result = mask_secrets_structural(data, ["sk_live_abc"])
        assert result["note"] == f"{REDACTED}def"

    def test_no_secret_unchanged(self):
        data = {"api_key": "some_value", "nested": {"token": "abc"}}
        result = mask_secrets_structural(data, [])
        assert result["api_key"] == REDACTED  # key-name match still applies
        assert result["nested"]["token"] == REDACTED  # key-name match


class TestMaskLogValue:
    """mask_log_value masks secrets in flat log strings."""

    def test_exact_match_returns_redacted(self):
        assert mask_log_value("sk_live_abc123", ["sk_live_abc123"]) == REDACTED

    def test_partial_match_replaces_inline(self):
        result = mask_log_value("auth: sk_live_abc123 granted", ["sk_live_abc123"])
        assert result == f"auth: {REDACTED} granted"

    def test_no_secrets_returns_unchanged(self):
        assert mask_log_value("hello world", []) == "hello world"

    def test_longest_first_in_log(self):
        result = mask_log_value("found abc here", ["a", "abc"])
        assert result == f"found {REDACTED} here"


class TestIsSecretKeyNewPatterns:
    """New key patterns added in security-remediation wave 1."""

    def test_credential_suffix(self):
        assert is_secret_key("db_credential") is True
        assert is_secret_key("db_credentials") is True

    def test_auth_suffix(self):
        assert is_secret_key("basic_auth") is True

    def test_key_suffix(self):
        assert is_secret_key("encryption_key") is True
        assert is_secret_key("signing-key") is True

    def test_private_key_suffix(self):
        assert is_secret_key("my_private_key") is True

    def test_client_secret_suffix(self):
        assert is_secret_key("oauth_client_secret") is True

    def test_non_secret_keys_not_matched(self):
        assert is_secret_key("name") is False
        assert is_secret_key("url") is False
        assert is_secret_key("monkey") is False
        assert is_secret_key("donkey") is False
        assert is_secret_key("X-Request-Token-Id") is False


class TestSanitizeSecretsInDictKeyNameOnly:
    """sanitize_secrets_in_dict now uses key-name detection only."""

    def test_key_name_still_redacted(self):
        secret_refs: list[str] = []
        data = {"api_key": "abc123", "name": "test"}
        result = sanitize_secrets_in_dict(data, secret_refs)
        assert result["api_key"] == "<SECRET>"
        assert result["name"] == "test"

    def test_value_pattern_no_longer_redacted(self):
        secret_refs: list[str] = []
        data = {"config": "bearer token123"}
        result = sanitize_secrets_in_dict(data, secret_refs)
        assert result["config"] == "bearer token123"

    def test_nested_key_name_redacted(self):
        secret_refs: list[str] = []
        data = {"outer": {"token": "my-secret-value"}}
        result = sanitize_secrets_in_dict(data, secret_refs)
        assert result["outer"]["token"] == "<SECRET>"
