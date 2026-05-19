"""Tests for shared MCP contract utilities."""

from app.mcp.contracts import (
    REDACTION_PLACEHOLDER,
    LargeResultMetadata,
    McpErrorEnvelope,
    PaginationMetadata,
    make_config_disabled_error,
    make_conflict_error,
    make_not_found_error,
    make_validation_error,
)


class TestMcpErrorEnvelope:
    def test_serialization(self):
        err = McpErrorEnvelope(
            code="not_found",
            message="Workflow not found: wf-123",
            retryable=False,
            suggested_next_tool="workflow_list",
            resource="wf-123",
        )
        result = err.to_tool_result()
        assert result["error"]["code"] == "not_found"
        assert result["error"]["message"] == "Workflow not found: wf-123"
        assert result["error"]["retryable"] is False
        assert result["error"]["suggested_next_tool"] == "workflow_list"
        assert result["error"]["resource"] == "wf-123"

    def test_optional_fields_default_none(self):
        err = McpErrorEnvelope(code="error", message="msg", retryable=False)
        result = err.to_tool_result()
        assert result["error"]["suggested_next_tool"] is None
        assert result["error"]["resource"] is None


class TestPaginationMetadata:
    def test_has_more_true(self):
        meta = PaginationMetadata(skip=0, limit=10, total=25, has_more=True)
        assert meta.has_more is True
        assert meta.total == 25

    def test_has_more_false(self):
        meta = PaginationMetadata(skip=20, limit=10, total=25, has_more=False)
        assert meta.has_more is False

    def test_clamp_limit(self):
        meta = PaginationMetadata(skip=0, limit=200, total=50, has_more=False)
        assert meta.clamp_limit(100) == 100
        assert meta.clamp_limit(50) == 50


class TestLargeResultMetadata:
    def test_gridfs_metadata(self):
        meta = LargeResultMetadata(
            stored_in_gridfs=True,
            payload_size_bytes=15_000_000,
            truncated=False,
            detail_tool="run_get_node_result",
            next_action="Use run_get_node_result to retrieve full payload",
        )
        assert meta.stored_in_gridfs is True
        assert meta.payload_size_bytes == 15_000_000
        assert meta.detail_tool == "run_get_node_result"

    def test_truncated_metadata(self):
        meta = LargeResultMetadata(
            stored_in_gridfs=False,
            payload_size_bytes=50_000,
            truncated=True,
            detail_tool=None,
            next_action="Output was truncated; reduce request size",
        )
        assert meta.truncated is True
        assert meta.stored_in_gridfs is False


class TestErrorFactories:
    def test_not_found_error(self):
        err = make_not_found_error("Workflow", "wf-123", "workflow_list")
        assert err.code == "not_found"
        assert "wf-123" in err.message
        assert err.retryable is False
        assert err.suggested_next_tool == "workflow_list"

    def test_validation_error(self):
        err = make_validation_error("Invalid URL", "wf-123")
        assert err.code == "validation_error"
        assert err.retryable is False
        assert err.resource == "wf-123"

    def test_config_disabled_error(self):
        err = make_config_disabled_error("Secret writes")
        assert err.code == "config_disabled"
        assert err.retryable is False

    def test_conflict_error(self):
        err = make_conflict_error("Name already exists", "env-123")
        assert err.code == "conflict"
        assert err.retryable is False


def test_redaction_placeholder():
    assert REDACTION_PLACEHOLDER == "<SECRET>"
