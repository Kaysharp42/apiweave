"""
Tests for Phase 7 MCP bug fixes.
"""
import pytest

from app.services.exceptions import ConflictError, ResourceNotFoundError
from app.services.import_service import parse_curl_to_workflow, parse_har_to_workflow
from app.services.secret_utils import is_secret_key, sanitize_secrets_in_dict


class TestSecretKeyDetection:
    """Fix 7.5: Secret redaction should detect secret-like keys."""

    def test_is_secret_key_detects_common_patterns(self):
        assert is_secret_key("api_key") is True
        assert is_secret_key("api-key") is True
        assert is_secret_key("apiKey") is True
        assert is_secret_key("secret") is True
        assert is_secret_key("token") is True
        assert is_secret_key("password") is True
        assert is_secret_key("auth_token") is True
        assert is_secret_key("access_token") is True
        assert is_secret_key("refresh_token") is True
        assert is_secret_key("client_secret") is True
        assert is_secret_key("private_key") is True

    def test_is_secret_key_allows_normal_keys(self):
        assert is_secret_key("name") is False
        assert is_secret_key("url") is False
        assert is_secret_key("description") is False
        assert is_secret_key("count") is False
        assert is_secret_key("id") is False

    def test_sanitize_redacts_by_key_name(self):
        secret_refs = []
        data = {"api_key": "abc123", "name": "test"}
        result = sanitize_secrets_in_dict(data, secret_refs)
        assert result["api_key"] == "<SECRET>"
        assert result["name"] == "test"
        assert len(secret_refs) == 1

    def test_sanitize_no_longer_redacts_by_value_pattern(self):
        """Value-pattern heuristics removed to prevent over-redaction."""
        secret_refs = []
        data = {"config": "bearer token123"}
        result = sanitize_secrets_in_dict(data, secret_refs)
        assert result["config"] == "bearer token123"

    def test_sanitize_redacts_nested_by_key(self):
        secret_refs = []
        data = {"outer": {"token": "my-secret-value"}}
        result = sanitize_secrets_in_dict(data, secret_refs)
        assert result["outer"]["token"] == "<SECRET>"


class TestImportSanitization:
    """Fix 7.6: Import tools should sanitize cookies and bodies."""

    def test_curl_cookies_sanitized(self):
        curl = 'curl -H "Authorization: Bearer test" -b "token=secret123; api_key=abc123" http://example.com'
        result = parse_curl_to_workflow(curl, sanitize=True)
        http_nodes = [n for n in result["nodes"] if n["type"] == "http-request"]
        assert len(http_nodes) == 1
        cookies = http_nodes[0]["config"]["cookies"]
        assert "secret123" not in cookies
        assert "abc123" not in cookies
        assert "[FILTERED]" in cookies

    def test_curl_body_sanitized(self):
        curl = 'curl -X POST -d "password=secret123" http://example.com'
        result = parse_curl_to_workflow(curl, sanitize=True)
        http_nodes = [n for n in result["nodes"] if n["type"] == "http-request"]
        assert len(http_nodes) == 1
        body = http_nodes[0]["config"]["body"]
        assert body == "[FILTERED]"

    def test_har_cookies_sanitized(self):
        har_data = {
            "log": {
                "entries": [{
                    "request": {
                        "method": "GET",
                        "url": "http://example.com",
                        "cookies": [
                            {"name": "token", "value": "secret123"},
                            {"name": "api_key", "value": "abc123"},
                        ],
                        "headers": [],
                    },
                    "response": {"status": 200, "headers": []},
                }]
            }
        }
        result = parse_har_to_workflow(har_data, sanitize=True)
        http_nodes = [n for n in result["nodes"] if n["type"] == "http-request"]
        assert len(http_nodes) == 1
        cookies = http_nodes[0]["config"]["cookies"]
        assert "secret123" not in cookies
        assert "abc123" not in cookies

    def test_har_body_sanitized(self):
        har_data = {
            "log": {
                "entries": [{
                    "request": {
                        "method": "POST",
                        "url": "http://example.com",
                        "cookies": [],
                        "headers": [],
                        "postData": {"text": "password=secret123&token=abc"},
                    },
                    "response": {"status": 200, "headers": []},
                }]
            }
        }
        result = parse_har_to_workflow(har_data, sanitize=True)
        http_nodes = [n for n in result["nodes"] if n["type"] == "http-request"]
        assert len(http_nodes) == 1
        body = http_nodes[0]["config"]["body"]
        assert body == "[FILTERED]"


class TestCustomExceptions:
    """Fix 7.9: Custom exceptions for proper HTTP mapping."""

    def test_conflict_error_is_value_error(self):
        err = ConflictError("test")
        assert isinstance(err, ValueError)

    def test_resource_not_found_error_is_value_error(self):
        err = ResourceNotFoundError("test")
        assert isinstance(err, ValueError)


class TestOpenApiEndpointLimit:
    """Fix 7.8: Direct import_openapi should enforce endpoint limits."""

    @pytest.mark.asyncio
    async def test_import_openapi_enforces_limit(self):
        """Verify that import_openapi raises ValueError when endpoint count exceeds limit."""
        from app.mcp.tools.imports import import_openapi
        from app.utils.openapi_import_limits import MAX_IMPORTED_OPENAPI_ENDPOINTS

        # Build an OpenAPI spec with more endpoints than the limit
        paths = {}
        for i in range(MAX_IMPORTED_OPENAPI_ENDPOINTS + 5):
            paths[f"/endpoint/{i}"] = {"get": {"summary": f"Endpoint {i}"}}

        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test API", "version": "1.0"},
            "paths": paths,
        }

        with pytest.raises(ValueError, match="exceeded safety limit"):
            await import_openapi(content=str(spec).replace("'", '"'))

    @pytest.mark.asyncio
    async def test_import_openapi_dry_run_enforces_limit(self):
        """Verify that import_openapi_dry_run reports errors when limit exceeded."""
        from app.mcp.tools.imports import import_openapi_dry_run
        from app.utils.openapi_import_limits import MAX_IMPORTED_OPENAPI_ENDPOINTS

        paths = {}
        for i in range(MAX_IMPORTED_OPENAPI_ENDPOINTS + 5):
            paths[f"/endpoint/{i}"] = {"get": {"summary": f"Endpoint {i}"}}

        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test API", "version": "1.0"},
            "paths": paths,
        }

        result = await import_openapi_dry_run(content=str(spec).replace("'", '"'))
        assert result.valid is False
        assert any("exceeded safety limit" in e for e in result.errors)
