"""Tests for SSRF protection in executor._execute_http_request (Task 7)."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.runner.executor import WorkflowExecutor


def _executor() -> WorkflowExecutor:
    return WorkflowExecutor(run_id="run-test", workflow_id="wf-test")


def _node(config: dict[str, Any]) -> dict[str, Any]:
    return {"nodeId": "http-1", "type": "http-request", "config": config}


class FakeResponseHeaders(dict[str, str]):
    def getall(self, key: str, default: list[str] | None = None) -> list[str]:
        if key.lower() == "set-cookie":
            return []
        return default or []


class FakeResponse:
    def __init__(self, body: str = '{"ok":true}', status: int = 200) -> None:
        self._body = body
        self.status = status
        self.headers = FakeResponseHeaders({"Content-Type": "application/json"})
        self.history: list[Any] = []

    async def text(self) -> str:
        return self._body

    def close(self) -> None:
        pass


async def test_blocked_internal_loopback_url() -> None:
    """127.0.0.1 is a private/loopback address — must be rejected with SSRF error."""
    exe = _executor()
    node = _node({"method": "GET", "url": "http://127.0.0.1:8000/health"})

    result = await exe._execute_http_request(node)

    assert result["status"] == "error"
    assert "SSRF blocked" in result["error"]
    assert result["method"] == "GET"
    assert result["duration"] == 0


async def test_blocked_cloud_metadata_url() -> None:
    """169.254.169.254 is the AWS/cloud metadata endpoint — must be rejected."""
    exe = _executor()
    node = _node({"method": "GET", "url": "http://169.254.169.254/latest/meta-data/"})

    result = await exe._execute_http_request(node)

    assert result["status"] == "error"
    assert "SSRF blocked" in result["error"]


async def test_blocked_rfc1918_private_url() -> None:
    """10.x, 172.16.x, 192.168.x private ranges must be rejected."""
    exe = _executor()
    node = _node({"method": "POST", "url": "http://192.168.1.1/admin"})

    result = await exe._execute_http_request(node)

    assert result["status"] == "error"
    assert "SSRF blocked" in result["error"]


async def test_valid_public_url_calls_safe_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """A valid public URL must pass validation and reach safe_request."""
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    mock_safe_request = AsyncMock(return_value=(fake_response, AsyncMock()))
    monkeypatch.setattr(safe_http_module, "safe_request", mock_safe_request)

    exe = _executor()
    node = _node(
        {
            "method": "POST",
            "url": "https://api.example.com/data",
            "body": '{"key": "value"}',
            "bodyType": "json",
            "timeout": 15,
        }
    )

    result = await exe._execute_http_request(node)

    mock_safe_request.assert_awaited_once()
    call_kwargs = mock_safe_request.call_args
    assert call_kwargs.args[0] == "POST"
    assert call_kwargs.args[1] == "https://api.example.com/data"
    assert call_kwargs.kwargs["timeout"] == 15.0
    assert result["statusCode"] == 200


async def test_unsafe_scheme_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    """file:// and other non-http schemes must be rejected."""
    from app.services import safe_http as safe_http_module

    mock_safe_request = AsyncMock()
    monkeypatch.setattr(safe_http_module, "safe_request", mock_safe_request)

    exe = _executor()
    node = _node({"method": "GET", "url": "file:///etc/passwd"})

    result = await exe._execute_http_request(node)

    assert result["status"] == "error"
    assert "SSRF blocked" in result["error"]
    mock_safe_request.assert_not_awaited()
