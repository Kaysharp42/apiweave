"""Tests for CORS tightening and MCP CORS middleware (Wave 3 / Task 14)."""

from starlette.testclient import TestClient

from app.main import app


class TestCORSMiddlewareConfiguration:
    def test_cors_middleware_uses_explicit_methods(self):
        cors_mw = None
        for mw in app.user_middleware:
            if mw.cls.__name__ == "CORSMiddleware":
                cors_mw = mw
                break

        assert cors_mw is not None, "CORSMiddleware not found in app.user_middleware"
        methods = cors_mw.kwargs.get("allow_methods", [])
        assert "*" not in methods, "allow_methods must not contain wildcard '*'"
        expected = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
        assert set(methods) == expected

    def test_cors_middleware_uses_explicit_headers(self):
        cors_mw = None
        for mw in app.user_middleware:
            if mw.cls.__name__ == "CORSMiddleware":
                cors_mw = mw
                break

        assert cors_mw is not None
        headers = cors_mw.kwargs.get("allow_headers", [])
        assert "*" not in headers, "allow_headers must not contain wildcard '*'"
        assert "Authorization" in headers
        assert "Content-Type" in headers


class TestMCPCORSMiddleware:
    def test_mcp_cors_options_request(self):
        from starlette.applications import Starlette
        from starlette.routing import Route

        from app.mcp.auth import MCPCORSMiddleware

        async def dummy(request):
            from starlette.responses import PlainTextResponse
            return PlainTextResponse("ok")

        inner = Starlette(routes=[Route("/", dummy)])
        inner.add_middleware(MCPCORSMiddleware)

        client = TestClient(inner)
        resp = client.options("/")
        assert resp.status_code == 200
        assert "access-control-allow-origin" in resp.headers
        assert "access-control-allow-methods" in resp.headers
        assert "GET" in resp.headers["access-control-allow-methods"]

    def test_mcp_cors_adds_headers_to_normal_response(self):
        from starlette.applications import Starlette
        from starlette.routing import Route

        from app.mcp.auth import MCPCORSMiddleware

        async def dummy(request):
            from starlette.responses import PlainTextResponse
            return PlainTextResponse("ok")

        inner = Starlette(routes=[Route("/", dummy)])
        inner.add_middleware(MCPCORSMiddleware)

        client = TestClient(inner)
        resp = client.get("/")
        assert resp.status_code == 200
        assert "access-control-allow-origin" in resp.headers
        assert "access-control-allow-methods" in resp.headers
