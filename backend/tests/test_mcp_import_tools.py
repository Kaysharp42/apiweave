"""Tests for Phase 4 MCP import tools."""

from __future__ import annotations

import json
from typing import Any

import pytest
from app.mcp.tools import imports as import_tools

SAMPLE_OPENAPI_JSON = json.dumps(
    {
        "openapi": "3.0.0",
        "info": {"title": "Pet Store API", "version": "1.0.0"},
        "servers": [{"url": "https://api.example.com"}],
        "paths": {
            "/pets": {
                "get": {
                    "operationId": "listPets",
                    "summary": "List all pets",
                    "responses": {"200": {"description": "OK"}},
                },
                "post": {
                    "operationId": "createPet",
                    "summary": "Create a pet",
                    "requestBody": {
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string"},
                                    },
                                }
                            }
                        }
                    },
                    "responses": {"201": {"description": "Created"}},
                },
            },
            "/pets/{petId}": {
                "get": {
                    "operationId": "getPet",
                    "summary": "Get a pet by ID",
                    "parameters": [
                        {
                            "name": "petId",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        }
                    ],
                    "responses": {"200": {"description": "OK"}},
                },
            },
        },
    }
)

SAMPLE_HAR_JSON = json.dumps(
    {
        "log": {
            "version": "1.2",
            "creator": {"name": "test", "version": "1.0"},
            "entries": [
                {
                    "request": {
                        "method": "GET",
                        "url": "https://api.example.com/users",
                        "headers": [{"name": "Accept", "value": "application/json"}],
                        "queryString": [],
                        "cookies": [],
                    },
                    "response": {
                        "status": 200,
                        "statusText": "OK",
                        "headers": [],
                        "bodySize": 100,
                    },
                },
                {
                    "request": {
                        "method": "POST",
                        "url": "https://api.example.com/users",
                        "headers": [{"name": "Content-Type", "value": "application/json"}],
                        "queryString": [],
                        "cookies": [],
                        "postData": {"text": '{"name": "Alice"}'},
                    },
                    "response": {
                        "status": 201,
                        "statusText": "Created",
                        "headers": [],
                        "bodySize": 50,
                    },
                },
            ],
        }
    }
)

SAMPLE_CURL = (
    "curl https://api.example.com/users\n"
    "curl -X POST https://api.example.com/users "
    '-H "Content-Type: application/json" '
    '-d \'{"name": "Bob"}\''
)


@pytest.mark.asyncio
async def test_import_openapi_returns_nodes_from_json_string():
    response = await import_tools.import_openapi(SAMPLE_OPENAPI_JSON)

    assert response.api_title == "Pet Store API"
    assert response.total_endpoints == 3
    assert len(response.nodes) == 3
    assert response.definitions[0].name == "Pet Store API"
    assert response.definitions[0].endpoint_count == 3


@pytest.mark.asyncio
async def test_import_openapi_sanitizes_secret_like_headers(monkeypatch):
    openapi_with_secret = json.dumps(
        {
            "openapi": "3.0.0",
            "info": {"title": "Test API", "version": "1.0"},
            "paths": {
                "/secure": {
                    "get": {
                        "parameters": [
                            {
                                "name": "Authorization",
                                "in": "header",
                                "schema": {"type": "string", "example": "Bearer sk-abc123"},
                            }
                        ],
                        "responses": {"200": {"description": "OK"}},
                    }
                }
            },
        }
    )

    response = await import_tools.import_openapi(openapi_with_secret, sanitize=True)

    assert response.total_endpoints == 1
    node_config = response.nodes[0]["config"]
    headers_str = node_config.get("headers", "")
    assert "[FILTERED]" in headers_str
    assert "sk-abc123" not in headers_str


@pytest.mark.asyncio
async def test_import_openapi_dry_run_returns_preview():
    response = await import_tools.import_openapi_dry_run(SAMPLE_OPENAPI_JSON)

    assert response.valid is True
    assert response.errors == []
    assert response.node_count == 3
    assert response.api_title == "Pet Store API"
    assert response.endpoint_count == 3


@pytest.mark.asyncio
async def test_import_openapi_dry_run_invalid_content():
    response = await import_tools.import_openapi_dry_run("not valid json or yaml")

    assert response.valid is False
    assert len(response.errors) > 0
    assert response.node_count == 0


@pytest.mark.asyncio
async def test_import_openapi_dry_run_missing_paths():
    response = await import_tools.import_openapi_dry_run(
        json.dumps({"openapi": "3.0.0", "info": {"title": "Empty", "version": "1.0"}})
    )

    assert response.valid is False
    assert any("no paths" in err.lower() for err in response.errors)


@pytest.mark.asyncio
async def test_import_openapi_dry_run_empty_content():
    response = await import_tools.import_openapi_dry_run("")

    assert response.valid is False
    assert response.errors == ["OpenAPI content is required"]


@pytest.mark.asyncio
async def test_import_har_returns_nodes_with_example_data():
    response = await import_tools.import_har(SAMPLE_HAR_JSON)

    assert response.total_requests == 2
    assert len(response.nodes) == 2
    assert response.example is True
    assert response.nodes[0]["config"]["method"] == "GET"
    assert response.nodes[1]["config"]["method"] == "POST"


@pytest.mark.asyncio
async def test_import_har_sanitizes_secret_headers():
    har_with_secret = json.dumps(
        {
            "log": {
                "version": "1.2",
                "creator": {"name": "test", "version": "1.0"},
                "entries": [
                    {
                        "request": {
                            "method": "GET",
                            "url": "https://api.example.com/secure",
                            "headers": [
                                {"name": "Authorization", "value": "Bearer sk-secret-key-123"}
                            ],
                            "queryString": [],
                            "cookies": [],
                        },
                        "response": {
                            "status": 200,
                            "statusText": "OK",
                            "headers": [],
                            "bodySize": 0,
                        },
                    }
                ],
            }
        }
    )

    response = await import_tools.import_har(har_with_secret, sanitize=True)

    assert response.total_requests == 1
    headers_str = response.nodes[0]["config"].get("headers", "")
    assert "[FILTERED]" in headers_str
    assert "sk-secret-key-123" not in headers_str


@pytest.mark.asyncio
async def test_import_har_dry_run_returns_preview():
    response = await import_tools.import_har_dry_run(SAMPLE_HAR_JSON)

    assert response.valid is True
    assert response.errors == []
    assert response.node_count == 2


@pytest.mark.asyncio
async def test_import_har_dry_run_invalid_json():
    response = await import_tools.import_har_dry_run("not valid json")

    assert response.valid is False
    assert len(response.errors) > 0


@pytest.mark.asyncio
async def test_import_har_dry_run_missing_log():
    response = await import_tools.import_har_dry_run(json.dumps({"not_log": {}}))

    assert response.valid is False
    assert any("log" in err.lower() for err in response.errors)


@pytest.mark.asyncio
async def test_import_har_dry_run_empty_entries():
    response = await import_tools.import_har_dry_run(json.dumps({"log": {"entries": []}}))

    assert response.valid is False
    assert any("no entries" in err.lower() for err in response.errors)


@pytest.mark.asyncio
async def test_import_curl_returns_nodes():
    response = await import_tools.import_curl(SAMPLE_CURL)

    assert response.total_requests == 2
    assert len(response.nodes) == 2
    assert response.nodes[0]["config"]["method"] == "GET"
    assert response.nodes[1]["config"]["method"] == "POST"


@pytest.mark.asyncio
async def test_import_curl_sanitizes_secret_headers():
    curl_with_secret = (
        "curl https://api.example.com/secure " '-H "Authorization: Bearer sk-secret-token"'
    )

    response = await import_tools.import_curl(curl_with_secret, sanitize=True)

    assert response.total_requests == 1
    headers_str = response.nodes[0]["config"].get("headers", "")
    assert "[FILTERED]" in headers_str
    assert "sk-secret-token" not in headers_str


@pytest.mark.asyncio
async def test_import_curl_empty_content():
    with pytest.raises(ValueError, match="Curl content is required"):
        await import_tools.import_curl("")


@pytest.mark.asyncio
async def test_import_openapi_empty_content():
    with pytest.raises(ValueError, match="OpenAPI content is required"):
        await import_tools.import_openapi("")


@pytest.mark.asyncio
async def test_import_openapi_no_paths():
    with pytest.raises(ValueError, match="no paths"):
        await import_tools.import_openapi(
            json.dumps({"openapi": "3.0.0", "info": {"title": "Empty", "version": "1.0"}})
        )


@pytest.mark.asyncio
async def test_import_har_empty_content():
    with pytest.raises(ValueError, match="HAR content is required"):
        await import_tools.import_har("")


@pytest.mark.asyncio
async def test_import_har_invalid_json():
    with pytest.raises(ValueError, match="Invalid HAR JSON"):
        await import_tools.import_har("not valid json")


@pytest.mark.asyncio
async def test_import_har_missing_log():
    with pytest.raises(ValueError, match="missing 'log'"):
        await import_tools.import_har(json.dumps({"not_log": {}}))


def test_register_import_tools_registers_phase_4_tool_names():
    class FakeServer:
        def __init__(self) -> None:
            self.names: list[str] = []

        def tool(self, name: str, description: str):
            assert description
            self.names.append(name)

            def decorator(function: Any) -> Any:
                return function

            return decorator

    server = FakeServer()
    import_tools.register_import_tools(server)  # type: ignore[arg-type]

    assert server.names == [
        "import_openapi_url",
        "import_openapi",
        "import_openapi_dry_run",
        "import_har",
        "import_har_dry_run",
        "import_curl",
    ]
