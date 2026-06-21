"""
Security test fixtures for APIWeave.

Provides reusable fixtures for SSRF, secret masking, file upload sandboxing,
OpenAPI spec validation, webhook body size, and safe HTTP client tests.
"""

from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from typing import Any

import pytest

# ---------------------------------------------------------------------------
# 1. internal_http_mock_server
# ---------------------------------------------------------------------------


class _QuietHandler(BaseHTTPRequestHandler):
    """Minimal handler that returns 200 OK for any request."""

    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self) -> None:  # noqa: N802
        self.do_GET()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        # Suppress request logging during tests
        pass


def _find_free_port() -> int:
    """Bind to port 0, grab the assigned port, then release."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def internal_http_mock_server() -> SimpleNamespace:
    """Start a local HTTP server on 127.0.0.1:<random_port> for SSRF tests.

    Yields a namespace with:
      - host: str
      - port: int
      - base_url: str  (e.g. "http://127.0.0.1:54321")
    """
    port = _find_free_port()
    server = HTTPServer(("127.0.0.1", port), _QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield SimpleNamespace(
        host="127.0.0.1",
        port=port,
        base_url=f"http://127.0.0.1:{port}",
    )

    server.shutdown()
    server.server_close()


# ---------------------------------------------------------------------------
# 2. blocked_ip_cases
# ---------------------------------------------------------------------------

_BLOCKED_TARGETS: list[dict[str, str]] = [
    # Loopback
    {"target": "http://127.0.0.1/admin", "reason": "loopback-ipv4"},
    {"target": "http://localhost/admin", "reason": "loopback-hostname"},
    {"target": "http://[::1]/admin", "reason": "loopback-ipv6"},
    # RFC 1918 private
    {"target": "http://10.0.0.1/internal", "reason": "rfc1918-10/8"},
    {"target": "http://172.16.0.1/internal", "reason": "rfc1918-172.16/12"},
    {"target": "http://192.168.1.1/internal", "reason": "rfc1918-192.168/16"},
    # Link-local
    {"target": "http://169.254.169.254/latest/meta-data/", "reason": "link-local-metadata"},
    {"target": "http://169.254.0.1/internal", "reason": "link-local-169.254/16"},
    # Cloud metadata (explicit)
    {"target": "http://169.254.169.254/metadata/v1/", "reason": "cloud-metadata-ipv4"},
    # IPv6 link-local / unique-local
    {"target": "http://[fe80::1]/internal", "reason": "ipv6-link-local"},
    {"target": "http://[fc00::1]/internal", "reason": "ipv6-unique-local"},
    {"target": "http://[fd00::1]/internal", "reason": "ipv6-ula"},
    # Multicast
    {"target": "http://224.0.0.1/", "reason": "ipv4-multicast"},
    {"target": "http://[ff02::1]/", "reason": "ipv6-multicast"},
]


@pytest.fixture(params=_BLOCKED_TARGETS, ids=lambda p: p["reason"])
def blocked_ip_cases(request: pytest.FixtureRequest) -> dict[str, str]:
    """Parametrized fixture yielding SSRF target dicts.

    Each dict has:
      - target: str  — the URL to test
      - reason: str  — human-readable category label
    """
    return request.param  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# 3. env_secret
# ---------------------------------------------------------------------------


@pytest.fixture()
def env_secret(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Register a test environment secret and tear it down after the test.

    Yields a dict with:
      - name: str   — the secret key name
      - value: str  — the secret value
    """
    name = "TEST_API_KEY"
    value = "super-secret-test-value-do-not-leak"
    monkeypatch.setenv(name, value)

    yield {"name": name, "value": value}

    # monkeypatch handles teardown automatically


# ---------------------------------------------------------------------------
# 4. upload_sandbox_tmp
# ---------------------------------------------------------------------------


@pytest.fixture()
def upload_sandbox_tmp(
    tmp_path: pytest.TempPathFactory,
    monkeypatch: pytest.MonkeyPatch,
) -> SimpleNamespace:
    """Create a temp directory as UPLOADS_BASE_DIR with a known file inside.

    Yields a namespace with:
      - base_dir: Path
      - known_file: Path   — a pre-existing file inside the sandbox
      - known_file_name: str
    """
    base_dir = tmp_path / "uploads_sandbox"  # type: ignore[operator]
    base_dir.mkdir()

    known_file_name = "existing_secret.txt"
    known_file = base_dir / known_file_name
    known_file.write_text("sensitive-content-inside-sandbox", encoding="utf-8")

    # Point the env var that production code reads
    monkeypatch.setenv("UPLOADS_BASE_DIR", str(base_dir))

    return SimpleNamespace(
        base_dir=base_dir,
        known_file=known_file,
        known_file_name=known_file_name,
    )


# ---------------------------------------------------------------------------
# 5. openapi_spec_fixture
# ---------------------------------------------------------------------------

_MINIMAL_OPENAPI_SPEC: dict[str, Any] = {
    "openapi": "3.0.3",
    "info": {
        "title": "Security Test API",
        "version": "1.0.0",
        "description": "Minimal OpenAPI 3.0 spec for security tests",
    },
    "paths": {
        "/health": {
            "get": {
                "operationId": "healthCheck",
                "summary": "Health check endpoint",
                "responses": {
                    "200": {
                        "description": "OK",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "status": {"type": "string"},
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        "/users/{userId}": {
            "get": {
                "operationId": "getUser",
                "summary": "Get user by ID",
                "parameters": [
                    {
                        "name": "userId",
                        "in": "path",
                        "required": True,
                        "schema": {"type": "string"},
                    },
                ],
                "responses": {
                    "200": {
                        "description": "User found",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string"},
                                        "name": {"type": "string"},
                                    },
                                },
                            },
                        },
                    },
                    "404": {"description": "Not found"},
                },
            },
        },
    },
}


@pytest.fixture()
def openapi_spec_fixture() -> dict[str, Any]:
    """Provide a valid OpenAPI 3.0 spec dict and its JSON-encoded form.

    Returns a dict with:
      - spec: dict       — the parsed OpenAPI spec
      - spec_json: str   — JSON-encoded string of the spec
    """
    return {
        "spec": _MINIMAL_OPENAPI_SPEC,
        "spec_json": json.dumps(_MINIMAL_OPENAPI_SPEC),
    }


# ---------------------------------------------------------------------------
# 6. webhook_body_cases
# ---------------------------------------------------------------------------


def _make_body(size_kb: int) -> bytes:
    """Generate a deterministic body of exactly *size_kb* kilobytes."""
    # Use a repeating pattern so content is predictable
    chunk = b"A" * 1024
    return chunk * size_kb


_WEBHOOK_BODY_CASES: list[dict[str, Any]] = [
    {"label": "1KB", "size_bytes": 1024, "body": _make_body(1)},
    {"label": "50KB", "size_bytes": 50 * 1024, "body": _make_body(50)},
    {"label": "100KB", "size_bytes": 100 * 1024, "body": _make_body(100)},
]


@pytest.fixture(params=_WEBHOOK_BODY_CASES, ids=lambda p: p["label"])
def webhook_body_cases(request: pytest.FixtureRequest) -> dict[str, Any]:
    """Parametrized fixture providing webhook body samples at 1KB, 50KB, 100KB.

    Each dict has:
      - label: str       — human-readable size label
      - size_bytes: int  — expected size in bytes
      - body: bytes      — the raw body content
    """
    return request.param  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# 7. safe_url_client
# ---------------------------------------------------------------------------


@pytest.fixture()
def safe_url_client(internal_http_mock_server: SimpleNamespace) -> SimpleNamespace:
    """Return a configured safe_http client namespace with test settings.

    This fixture provides configuration values that production safe_http code
    will consume. It does NOT import or call production code directly.

    Yields a namespace with:
      - allowed_hosts: list[str]
      - blocked_cidrs: list[str]
      - timeout_seconds: float
      - max_redirects: int
      - mock_server_base_url: str  — from internal_http_mock_server
    """
    return SimpleNamespace(
        allowed_hosts=["api.example.com", "httpbin.org"],
        blocked_cidrs=[
            "127.0.0.0/8",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
            "169.254.0.0/16",
            "fc00::/7",
            "fe80::/10",
            "ff00::/8",
        ],
        timeout_seconds=5.0,
        max_redirects=0,
        mock_server_base_url=internal_http_mock_server.base_url,
    )
