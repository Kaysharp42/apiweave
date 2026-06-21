"""Tests for WorkflowExecutor._normalize_key_value_field.

Covers:
- Legacy multi-line string parsing (backward compatibility).
- New array format with active/inactive rows.
- Variable substitution in both formats.
- Edge cases: empty input, None, unknown types, non-dict list entries.
"""

from __future__ import annotations

import pytest

from app.runner.executor import WorkflowExecutor


def _executor() -> WorkflowExecutor:
    return WorkflowExecutor(run_id="run-test", workflow_id="wf-test")


class TestLegacyStringFormat:
    """Legacy multi-line ``key=value`` strings must parse identically to before."""

    def test_empty_string(self) -> None:
        exe = _executor()
        assert exe._normalize_key_value_field("") == {}

    def test_none(self) -> None:
        exe = _executor()
        assert exe._normalize_key_value_field(None) == {}

    def test_basic_key_value(self) -> None:
        exe = _executor()
        result = exe._normalize_key_value_field("Content-Type: application/json\nAccept: */*")
        assert result == {"Content-Type": "application/json", "Accept": "*/*"}

    def test_equals_separator(self) -> None:
        exe = _executor()
        result = exe._normalize_key_value_field("foo=bar\nbaz=qux")
        assert result == {"foo": "bar", "baz": "qux"}

    def test_blank_lines_skipped(self) -> None:
        exe = _executor()
        result = exe._normalize_key_value_field("a=1\n\nb=2\n\n")
        assert result == {"a": "1", "b": "2"}

    def test_variable_substitution_in_values(self) -> None:
        exe = _executor()
        exe.workflow_variables["token"] = "abc123"
        result = exe._normalize_key_value_field("Authorization: Bearer {{variables.token}}")
        assert result == {"Authorization": "Bearer abc123"}


class TestArrayFormat:
    """New array-of-dicts format."""

    def test_basic_array(self) -> None:
        exe = _executor()
        rows = [
            {"key": "X-Foo", "value": "bar", "active": True},
            {"key": "X-Baz", "value": "qux", "active": True},
        ]
        result = exe._normalize_key_value_field(rows)
        assert result == {"X-Foo": "bar", "X-Baz": "qux"}

    def test_inactive_rows_skipped(self) -> None:
        exe = _executor()
        rows = [
            {"key": "X-Active", "value": "yes", "active": True},
            {"key": "X-Inactive", "value": "no", "active": False},
            {"key": "X-Default", "value": "also-yes"},
        ]
        result = exe._normalize_key_value_field(rows)
        assert result == {"X-Active": "yes", "X-Default": "also-yes"}
        assert "X-Inactive" not in result

    def test_active_defaults_to_true(self) -> None:
        exe = _executor()
        rows = [{"key": "K", "value": "V"}]
        result = exe._normalize_key_value_field(rows)
        assert result == {"K": "V"}

    def test_missing_key_skipped(self) -> None:
        exe = _executor()
        rows = [{"value": "orphan"}]
        result = exe._normalize_key_value_field(rows)
        assert result == {}

    def test_empty_value_preserved(self) -> None:
        exe = _executor()
        rows = [{"key": "Empty", "value": ""}]
        result = exe._normalize_key_value_field(rows)
        assert result == {"Empty": ""}

    def test_non_string_value_coerced(self) -> None:
        exe = _executor()
        rows = [{"key": "Num", "value": 42}]
        result = exe._normalize_key_value_field(rows)
        assert result == {"Num": "42"}

    def test_non_dict_entries_skipped(self) -> None:
        exe = _executor()
        rows = ["not-a-dict", 123, None, {"key": "K", "value": "V"}]
        result = exe._normalize_key_value_field(rows)
        assert result == {"K": "V"}

    def test_empty_list(self) -> None:
        exe = _executor()
        assert exe._normalize_key_value_field([]) == {}

    def test_variable_substitution_in_array(self) -> None:
        exe = _executor()
        exe.workflow_variables["host"] = "api.example.com"
        rows = [{"key": "Host", "value": "{{variables.host}}"}]
        result = exe._normalize_key_value_field(rows)
        assert result == {"Host": "api.example.com"}


class TestUnknownTypes:
    """Unknown field types must not crash — return empty dict with warning."""

    def test_integer_returns_empty(self) -> None:
        exe = _executor()
        assert exe._normalize_key_value_field(42) == {}

    def test_dict_returns_empty(self) -> None:
        exe = _executor()
        assert exe._normalize_key_value_field({"not": "supported"}) == {}


class TestAllowSecretsFlag:
    """allow_secrets=False must reject {{secrets.*}} in values."""

    def test_string_format_rejects_secrets(self) -> None:
        exe = _executor()
        with pytest.raises(ValueError, match="(?i)secret"):
            exe._normalize_key_value_field("key={{secrets.MY_SECRET}}", allow_secrets=False)

    def test_array_format_rejects_secrets(self) -> None:
        exe = _executor()
        with pytest.raises(ValueError, match="(?i)secret"):
            exe._normalize_key_value_field(
                [{"key": "k", "value": "{{secrets.MY_SECRET}}"}],
                allow_secrets=False,
            )

    def test_string_format_allows_secrets_by_default(self) -> None:
        exe = _executor()
        exe.secrets = {"MY_SECRET": "s3cret"}
        result = exe._normalize_key_value_field("key={{secrets.MY_SECRET}}")
        assert result == {"key": "s3cret"}
