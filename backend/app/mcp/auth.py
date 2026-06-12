"""
API-key and Origin validation helpers for MCP Streamable HTTP.
"""
import logging
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings

logger = logging.getLogger(__name__)

# CORS headers applied to every MCP response so the sub-mount
# (which does not inherit the parent CORSMiddleware) stays usable
# from browser-based MCP clients.
_MCP_CORS_METHODS = "GET, POST, OPTIONS"
_MCP_CORS_HEADERS = "Authorization, Content-Type, MCP-API-Key"


def _mcp_cors_origin_header() -> str:
    allowed = settings.get_mcp_allowed_origins_list()
    if len(allowed) == 1:
        return allowed[0]
    return ", ".join(allowed) if allowed else "*"


def _mcp_cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": _mcp_cors_origin_header(),
        "Access-Control-Allow-Methods": _MCP_CORS_METHODS,
        "Access-Control-Allow-Headers": _MCP_CORS_HEADERS,
    }


def validate_api_key(request: Request) -> bool:
    """Validate the API key from Authorization or X-API-Key header."""
    if not settings.MCP_REQUIRE_API_KEY:
        return True

    if not settings.MCP_API_KEY:
        logger.warning("MCP_REQUIRE_API_KEY is true but MCP_API_KEY is not set")
        return False

    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        provided = auth_header[7:]
    else:
        provided = request.headers.get("x-api-key", "")

    if not provided:
        return False

    return provided == settings.MCP_API_KEY


def validate_origin(request: Request, allowed_origins: list[str]) -> bool:
    """Validate the Origin header against allowed origins."""
    origin = request.headers.get("origin")
    if not origin:
        return True
    return origin in allowed_origins


async def auth_middleware(request: Request, call_next):
    """ASGI middleware for MCP Streamable HTTP auth."""
    if not settings.MCP_ENABLED or not settings.MCP_HTTP_ENABLED:
        return await call_next(request)

    if not request.url.path.startswith("/mcp"):
        return await call_next(request)

    if not validate_api_key(request):
        logger.warning("MCP request rejected: invalid or missing API key")
        return JSONResponse(
            status_code=401,
            content={"error": "Unauthorized: invalid or missing API key"},
        )

    allowed = settings.get_mcp_allowed_origins_list()
    if not validate_origin(request, allowed):
        logger.warning("MCP request rejected: origin not allowed")
        return JSONResponse(
            status_code=403,
            content={"error": "Forbidden: origin not allowed"},
        )

    return await call_next(request)


class MCPCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        cors_headers = _mcp_cors_headers()

        if request.method == "OPTIONS":
            return Response(status_code=200, headers=cors_headers)

        response = await call_next(request)
        for key, value in cors_headers.items():
            response.headers[key] = value
        return response
