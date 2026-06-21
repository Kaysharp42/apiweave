"""Tests for auth handling, followRedirects, and sslVerify in the HTTP executor.

Covers:
- _apply_auth_to_request: bearer, basic, apiKey (header + query), none, unknown.
- Variable substitution in auth tokens.
- Config headers override auth headers.
- followRedirects=False skips the redirect loop.
- sslVerify=False is propagated to safe_request.
"""

from __future__ import annotations

import base64
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


# ---------------------------------------------------------------------------
# _apply_auth_to_request — unit tests
# ---------------------------------------------------------------------------


class TestApplyAuthNone:
    def test_no_auth_config(self) -> None:
        exe = _executor()
        headers, url = exe._apply_auth_to_request({}, {"X": "1"}, "https://api.test.com/")
        assert headers == {"X": "1"}
        assert url == "https://api.test.com/"

    def test_auth_type_none(self) -> None:
        exe = _executor()
        config = {"auth": {"type": "none"}}
        headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers == {}
        assert url == "https://api.test.com/"

    def test_auth_type_empty_string(self) -> None:
        exe = _executor()
        config = {"auth": {"type": ""}}
        headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert "Authorization" not in headers

    def test_unknown_auth_type_warns_and_noops(self, caplog: pytest.LogCaptureFixture) -> None:
        exe = _executor()
        config = {"auth": {"type": "kerberos"}}
        import logging

        with caplog.at_level(logging.WARNING, logger="app.runner.executor"):
            headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert "Authorization" not in headers
        assert "Unknown auth.type" in caplog.text


class TestApplyAuthBearer:
    def test_bearer_adds_header(self) -> None:
        exe = _executor()
        config = {"auth": {"type": "bearer", "bearer": {"token": "my-token"}}}
        headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers["Authorization"] == "Bearer my-token"

    def test_bearer_variable_substitution(self) -> None:
        exe = _executor()
        exe.workflow_variables["tok"] = "resolved-token"
        config = {"auth": {"type": "bearer", "bearer": {"token": "{{variables.tok}}"}}}
        headers, _ = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers["Authorization"] == "Bearer resolved-token"

    def test_bearer_does_not_override_explicit_header(self) -> None:
        exe = _executor()
        config = {"auth": {"type": "bearer", "bearer": {"token": "auto"}}}
        existing = {"Authorization": "Manual"}
        headers, _ = exe._apply_auth_to_request(config, existing, "https://api.test.com/")
        assert headers["Authorization"] == "Manual"

    def test_bearer_case_insensitive_override(self) -> None:
        exe = _executor()
        config = {"auth": {"type": "bearer", "bearer": {"token": "auto"}}}
        existing = {"authorization": "Manual"}
        headers, _ = exe._apply_auth_to_request(config, existing, "https://api.test.com/")
        assert headers["authorization"] == "Manual"
        assert "Authorization" not in headers


class TestApplyAuthBasic:
    def test_basic_adds_header(self) -> None:
        exe = _executor()
        config = {"auth": {"type": "basic", "basic": {"username": "user", "password": "pass"}}}
        headers, _ = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        expected = base64.b64encode(b"user:pass").decode("ascii")
        assert headers["Authorization"] == f"Basic {expected}"

    def test_basic_variable_substitution(self) -> None:
        exe = _executor()
        exe.workflow_variables["u"] = "admin"
        exe.workflow_variables["p"] = "s3cret"
        config = {
            "auth": {
                "type": "basic",
                "basic": {"username": "{{variables.u}}", "password": "{{variables.p}}"},
            }
        }
        headers, _ = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        expected = base64.b64encode(b"admin:s3cret").decode("ascii")
        assert headers["Authorization"] == f"Basic {expected}"

    def test_basic_does_not_override_explicit_header(self) -> None:
        exe = _executor()
        config = {"auth": {"type": "basic", "basic": {"username": "u", "password": "p"}}}
        existing = {"Authorization": "Keep-Me"}
        headers, _ = exe._apply_auth_to_request(config, existing, "https://api.test.com/")
        assert headers["Authorization"] == "Keep-Me"


class TestApplyAuthApiKey:
    def test_apikey_in_header(self) -> None:
        exe = _executor()
        config = {
            "auth": {
                "type": "apiKey",
                "apiKey": {"key": "X-API-Key", "value": "abc123", "addTo": "header"},
            }
        }
        headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers["X-API-Key"] == "abc123"
        assert url == "https://api.test.com/"

    def test_apikey_in_query(self) -> None:
        exe = _executor()
        config = {
            "auth": {
                "type": "apiKey",
                "apiKey": {"key": "api_key", "value": "abc123", "addTo": "query"},
            }
        }
        headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert "api_key" not in headers
        assert "api_key=abc123" in url

    def test_apikey_in_query_appends_to_existing(self) -> None:
        exe = _executor()
        config = {
            "auth": {
                "type": "apiKey",
                "apiKey": {"key": "api_key", "value": "abc", "addTo": "query"},
            }
        }
        _, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/?existing=1")
        assert url == "https://api.test.com/?existing=1&api_key=abc"

    def test_apikey_defaults_to_header(self) -> None:
        exe = _executor()
        config = {
            "auth": {
                "type": "apiKey",
                "apiKey": {"key": "X-Key", "value": "val"},
            }
        }
        headers, url = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers["X-Key"] == "val"
        assert "X-Key" not in url

    def test_apikey_empty_key_skipped(self) -> None:
        exe = _executor()
        config = {
            "auth": {
                "type": "apiKey",
                "apiKey": {"key": "", "value": "val", "addTo": "header"},
            }
        }
        headers, _ = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers == {}

    def test_apikey_variable_substitution(self) -> None:
        exe = _executor()
        exe.workflow_variables["k"] = "resolved-key"
        config = {
            "auth": {
                "type": "apiKey",
                "apiKey": {"key": "X-Key", "value": "{{variables.k}}", "addTo": "header"},
            }
        }
        headers, _ = exe._apply_auth_to_request(config, {}, "https://api.test.com/")
        assert headers["X-Key"] == "resolved-key"


# ---------------------------------------------------------------------------
# Integration: _execute_http_request with auth + followRedirects + sslVerify
# ---------------------------------------------------------------------------


async def test_bearer_auth_integration(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        captured_kwargs["method"] = method
        captured_kwargs["url"] = url
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node(
        {
            "method": "GET",
            "url": "https://api.example.com/data",
            "auth": {"type": "bearer", "bearer": {"token": "tok-123"}},
        }
    )

    result = await exe._execute_http_request(node)
    assert result["statusCode"] == 200
    assert captured_kwargs["headers"]["Authorization"] == "Bearer tok-123"


async def test_follow_redirects_false_propagated(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse(status=302)
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node(
        {
            "method": "GET",
            "url": "https://api.example.com/",
            "followRedirects": False,
        }
    )

    await exe._execute_http_request(node)
    assert captured_kwargs["follow_redirects"] is False


async def test_follow_redirects_default_true(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node({"method": "GET", "url": "https://api.example.com/"})

    await exe._execute_http_request(node)
    assert captured_kwargs["follow_redirects"] is True


async def test_ssl_verify_false_propagated(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node(
        {
            "method": "GET",
            "url": "https://api.example.com/",
            "sslVerify": False,
        }
    )

    await exe._execute_http_request(node)
    assert captured_kwargs["ssl_verify"] is False


async def test_ssl_verify_default_true(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node({"method": "GET", "url": "https://api.example.com/"})

    await exe._execute_http_request(node)
    assert captured_kwargs["ssl_verify"] is True


async def test_array_format_headers_integration(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node(
        {
            "method": "GET",
            "url": "https://api.example.com/",
            "headers": [
                {"key": "X-Custom", "value": "yes", "active": True},
                {"key": "X-Skipped", "value": "no", "active": False},
            ],
        }
    )

    await exe._execute_http_request(node)
    assert captured_kwargs["headers"]["X-Custom"] == "yes"
    assert "X-Skipped" not in captured_kwargs["headers"]


async def test_explicit_headers_override_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import safe_http as safe_http_module

    fake_response = FakeResponse()
    captured_kwargs: dict[str, Any] = {}

    async def fake_safe_request(method: str, url: str, **kwargs: Any):
        captured_kwargs.update(kwargs)
        return fake_response, AsyncMock()

    monkeypatch.setattr(safe_http_module, "safe_request", fake_safe_request)

    exe = _executor()
    node = _node(
        {
            "method": "GET",
            "url": "https://api.example.com/",
            "headers": [{"key": "Authorization", "value": "Manual"}],
            "auth": {"type": "bearer", "bearer": {"token": "auto-token"}},
        }
    )

    await exe._execute_http_request(node)
    assert captured_kwargs["headers"]["Authorization"] == "Manual"
