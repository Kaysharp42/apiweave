import base64
import json
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import aiohttp
import pytest

from app.runner import executor as executor_module
from app.runner.executor import WorkflowExecutor
from app.services import safe_http as safe_http_module


class FakeResponseHeaders(dict[str, str]):
    def __init__(
        self,
        values: dict[str, str] | None = None,
        set_cookies: list[str] | None = None,
    ) -> None:
        super().__init__(values or {})
        self._set_cookies = set_cookies or []

    def getall(self, key: str, default: list[str] | None = None) -> list[str]:
        if key.lower() == "set-cookie":
            return self._set_cookies
        return default or []


class FakeResponse:
    def __init__(
        self,
        body: str,
        headers: FakeResponseHeaders | None = None,
        status: int = 200,
        history: list[Any] | None = None,
    ) -> None:
        self._body = body
        self.headers = headers or FakeResponseHeaders({"Content-Type": "application/json"})
        self.status = status
        self.history = history or []

    async def text(self) -> str:
        return self._body

    def close(self) -> None:
        pass


class FakeRequestContext:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response

    async def __aenter__(self) -> FakeResponse:
        return self.response

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None


class FakeClientSession:
    response = FakeResponse('{"ok": true}')
    last_request: dict[str, Any] = {}

    async def __aenter__(self) -> "FakeClientSession":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None

    async def close(self) -> None:
        return None

    def request(self, **kwargs: Any) -> FakeRequestContext:
        FakeClientSession.last_request = kwargs
        return FakeRequestContext(FakeClientSession.response)


_fake_session_instance = FakeClientSession()


def _executor() -> WorkflowExecutor:
    return WorkflowExecutor(run_id="run-1", workflow_id="wf-1")


def _node(config: dict[str, Any]) -> dict[str, Any]:
    return {"nodeId": "http-1", "type": "http-request", "config": config}


async def _fake_safe_request(
    method: str,
    url: str,
    **kwargs: Any,
) -> tuple[FakeResponse, FakeClientSession]:
    FakeClientSession.last_request = {"method": method, "url": url, **kwargs}
    return FakeClientSession.response, _fake_session_instance


def _install_fake_http(
    monkeypatch: pytest.MonkeyPatch,
    response: FakeResponse | None = None,
) -> None:
    FakeClientSession.response = response or FakeResponse('{"ok": true}')
    FakeClientSession.last_request = {}
    monkeypatch.setattr(safe_http_module, "safe_request", _fake_safe_request)


def _install_deterministic_timer(monkeypatch: pytest.MonkeyPatch) -> None:
    times: Iterator[float] = iter([100.000, 100.123])
    monkeypatch.setattr(executor_module.time, "time", lambda: next(times))


def _quiet_logger() -> SimpleNamespace:
    return SimpleNamespace(
        debug=lambda *args, **kwargs: None,
        info=lambda *args, **kwargs: None,
        warning=lambda *args, **kwargs: None,
        error=lambda *args, **kwargs: None,
    )


class FakeUpdateRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def update_one(
        self,
        filter_doc: dict[str, object],
        update_doc: dict[str, object],
        upsert: bool = False,
    ) -> None:
        self.calls.append(
            {
                "filter": filter_doc,
                "update": update_doc,
                "upsert": upsert,
            }
        )


class FakeGridFSBucket:
    last_instance: "FakeGridFSBucket | None" = None

    def __init__(self, db: object) -> None:
        self.db = db
        self.upload_calls: list[dict[str, object]] = []
        FakeGridFSBucket.last_instance = self

    async def upload_from_stream(
        self,
        filename: str,
        source: bytes,
        metadata: dict[str, object],
    ) -> str:
        self.upload_calls.append(
            {
                "filename": filename,
                "source": source,
                "metadata": metadata,
            }
        )
        return "gridfs-file-123"


def _form_fields(form_data: aiohttp.FormData) -> dict[str, Any]:
    return {field[0]["name"]: field[2] for field in form_data._fields}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("body_type", "config_body", "expected_data", "expected_json", "expected_content_type"),
    [
        ("json", '{"name":"Ada"}', None, {"name": "Ada"}, "application/json"),
        ("raw", "hello", "hello", None, "text/plain"),
        (
            "x-www-form-urlencoded",
            "",
            "token=abc+123",
            None,
            "application/x-www-form-urlencoded",
        ),
        (
            "binary",
            base64.b64encode(b"bytes").decode("ascii"),
            b"bytes",
            None,
            "application/octet-stream",
        ),
        ("xml", "<root />", "<root />", None, "application/xml"),
        ("html", "<p>Hello</p>", "<p>Hello</p>", None, "text/html"),
        ("none", "", None, None, None),
    ],
)
async def test_execute_http_request_body_type_serialization_formats(
    monkeypatch: pytest.MonkeyPatch,
    body_type: str,
    config_body: str,
    expected_data: Any,
    expected_json: Any,
    expected_content_type: str | None,
) -> None:
    _install_fake_http(monkeypatch)
    executor = _executor()
    executor.workflow_variables = {"token": "abc 123"}

    config: dict[str, Any] = {
        "method": "POST",
        "url": "https://api.example.test/resource",
        "bodyType": body_type,
        "body": config_body,
    }
    if body_type == "x-www-form-urlencoded":
        config["urlEncodedEntries"] = [
            {"key": "token", "value": "{{variables.token}}", "active": True},
        ]

    await executor._execute_http_request(_node(config))

    actual_request = FakeClientSession.last_request
    assert actual_request["data"] == expected_data
    assert actual_request["json"] == expected_json
    if expected_content_type is None:
        assert "Content-Type" not in actual_request["headers"]
    else:
        assert actual_request["headers"]["Content-Type"] == expected_content_type


@pytest.mark.asyncio
async def test_execute_http_request_form_data_substitutes_row_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_http(monkeypatch)
    executor = _executor()
    executor.workflow_variables = {"name": "Ada"}

    await executor._execute_http_request(
        _node(
            {
                "method": "POST",
                "url": "https://api.example.test/upload",
                "headers": "Content-Type: application/json",
                "bodyType": "form-data",
                "formDataEntries": [
                    {
                        "key": "name",
                        "value": "{{variables.name}}",
                        "type": "text",
                        "active": True,
                    },
                    {"key": "ignored", "value": "inactive", "type": "text", "active": False},
                ],
            }
        )
    )

    actual_request = FakeClientSession.last_request
    assert isinstance(actual_request["data"], aiohttp.FormData)
    assert _form_fields(actual_request["data"]) == {"name": "Ada"}
    assert "Content-Type" not in actual_request["headers"]


@pytest.mark.asyncio
async def test_execute_http_request_form_data_preserves_file_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_http(monkeypatch)
    file_payload = base64.b64encode(b"file-bytes").decode("ascii")

    await _executor()._execute_http_request(
        _node(
            {
                "method": "POST",
                "url": "https://api.example.test/upload",
                "bodyType": "form-data",
                "formDataEntries": [
                    {
                        "key": "avatar",
                        "value": "profile.png",
                        "type": "file",
                        "active": True,
                        "fileName": "profile.png",
                        "contentType": "image/png",
                        "fileData": file_payload,
                    },
                ],
            }
        )
    )

    actual_request = FakeClientSession.last_request
    assert isinstance(actual_request["data"], aiohttp.FormData)
    assert actual_request["data"]._fields[0][0]["name"] == "avatar"
    assert actual_request["data"]._fields[0][0]["filename"] == "profile.png"
    assert actual_request["data"]._fields[0][1]["Content-Type"] == "image/png"
    assert actual_request["data"]._fields[0][2] == b"file-bytes"
    assert "Content-Type" not in actual_request["headers"]


@pytest.mark.asyncio
async def test_execute_http_request_parses_multiple_set_cookie_headers_with_attributes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = FakeResponse(
        '{"ok": true}',
        FakeResponseHeaders(
            {"Content-Type": "application/json"},
            set_cookies=[
                "session=abc123; Path=/; HttpOnly; SameSite=Lax",
                "theme=dark; Max-Age=3600; Secure",
            ],
        ),
    )
    _install_fake_http(monkeypatch, response)

    result = await _executor()._execute_http_request(
        _node({"method": "GET", "url": "https://api.example.test/cookies"})
    )

    assert result["cookieCount"] == 2
    assert result["cookies"] == [
        {
            "name": "session",
            "value": "abc123",
            "attributes": {"Path": "/", "HttpOnly": True, "SameSite": "Lax"},
        },
        {
            "name": "theme",
            "value": "dark",
            "attributes": {"Max-Age": "3600", "Secure": True},
        },
    ]
    assert result["response"]["cookies"] == result["cookies"]


@pytest.mark.asyncio
async def test_execute_http_request_computes_response_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = _executor()
    executor.logger = _quiet_logger()
    _install_deterministic_timer(monkeypatch)
    _install_fake_http(
        monkeypatch,
        FakeResponse(
            "<html>✓</html>",
            FakeResponseHeaders({"Content-Type": "text/html; charset=utf-8"}),
            status=201,
        ),
    )

    result = await executor._execute_http_request(
        _node({"method": "GET", "url": "https://api.example.test/page"})
    )

    assert result["responseSizeBytes"] == 16
    assert result["contentType"] == "text/html; charset=utf-8"
    assert result["bodyFormat"] == "html"
    assert result["responseTimeMs"] == 123
    assert result["duration"] == 123


@pytest.mark.asyncio
async def test_execute_http_request_counts_response_redirect_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_http(
        monkeypatch,
        FakeResponse(
            "{\"ok\": true}",
            FakeResponseHeaders({"Content-Type": "application/json"}),
            history=[object(), object()],
        ),
    )

    result = await _executor()._execute_http_request(
        _node({"method": "GET", "url": "https://api.example.test/redirects"})
    )

    assert result["redirectCount"] == 2


@pytest.mark.asyncio
async def test_execute_http_request_handles_missing_response_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = FakeResponse("{\"ok\": true}")
    delattr(response, "history")
    _install_fake_http(monkeypatch, response)

    result = await _executor()._execute_http_request(
        _node({"method": "GET", "url": "https://api.example.test/no-history"})
    )

    assert result["redirectCount"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("headers", "body", "expected_data", "expected_json", "expected_headers"),
    [
        ("", '{"legacy":true}', None, {"legacy": True}, {"Content-Type": "application/json"}),
        (
            "Content-Type: text/plain",
            "legacy text",
            "legacy text",
            None,
            {"Content-Type": "text/plain"},
        ),
    ],
)
async def test_execute_http_request_legacy_string_body_configs_remain_supported(
    monkeypatch: pytest.MonkeyPatch,
    headers: str,
    body: str,
    expected_data: str | None,
    expected_json: dict[str, bool] | None,
    expected_headers: dict[str, str],
) -> None:
    _install_fake_http(monkeypatch)

    await _executor()._execute_http_request(
        _node(
            {
                "method": "POST",
                "url": "https://api.example.test/legacy",
                "headers": headers,
                "body": body,
            }
        )
    )

    actual_request = FakeClientSession.last_request
    assert actual_request["data"] == expected_data
    assert actual_request["json"] == expected_json
    assert actual_request["headers"] == expected_headers


@pytest.mark.asyncio
async def test_update_node_status_stores_large_result_in_gridfs_with_preserved_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_node_results = FakeUpdateRecorder()
    fake_runs = FakeUpdateRecorder()
    fake_db = SimpleNamespace(node_results=fake_node_results, runs=fake_runs)
    monkeypatch.setattr(executor_module, "AsyncIOMotorGridFSBucket", FakeGridFSBucket)

    executor = _executor()
    executor.logger = _quiet_logger()

    large_body = "x" * (14 * 1024 * 1024 + 1024)
    result = {
        "responseSizeBytes": len(large_body),
        "contentType": "application/json; charset=utf-8",
        "bodyFormat": "json",
        "responseTimeMs": 321,
        "duration": 321,
        "body": large_body,
    }

    await executor._update_node_status(fake_db, "node-1", "completed", result)

    assert len(fake_node_results.calls) == 1
    node_result_call = fake_node_results.calls[0]
    assert node_result_call["filter"] == {"runId": "run-1", "nodeId": "node-1"}
    assert node_result_call["upsert"] is True

    stored_result = node_result_call["update"]["$set"]["result"]
    assert isinstance(stored_result, dict)
    assert stored_result["stored_in_gridfs"] is True
    assert stored_result["gridfs_file_id"] == "gridfs-file-123"
    assert stored_result["responseSizeBytes"] == len(large_body)
    assert stored_result["contentType"] == "application/json; charset=utf-8"
    assert stored_result["bodyFormat"] == "json"
    assert stored_result["responseTimeMs"] == 321
    assert stored_result["duration"] == 321
    assert stored_result["body"] == large_body

    gridfs_bucket = FakeGridFSBucket.last_instance
    assert gridfs_bucket is not None
    assert len(gridfs_bucket.upload_calls) == 1
    upload_call = gridfs_bucket.upload_calls[0]
    assert upload_call["filename"] == "run-1_node-1_result.json"
    assert upload_call["source"] == json.dumps(result).encode("utf-8")
    assert upload_call["metadata"]["runId"] == "run-1"
    assert upload_call["metadata"]["nodeId"] == "node-1"
    assert upload_call["metadata"]["status"] == "completed"
    assert upload_call["metadata"]["size_mb"] > 14
    assert isinstance(upload_call["metadata"]["timestamp"], str)

    assert len(fake_runs.calls) == 1
    assert fake_runs.calls[0]["filter"] == {"runId": "run-1"}
    assert fake_runs.calls[0]["update"]["$set"]["nodeStatuses.node-1"]["status"] == "completed"
