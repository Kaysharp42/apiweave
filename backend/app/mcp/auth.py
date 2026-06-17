"""
API-key and Origin validation helpers for MCP Streamable HTTP.

Supports two authentication modes:
1. Scoped service tokens (Bearer awst_...) — preferred, scope-enforced
2. Flat API key (MCP_API_KEY) — legacy, for backward compatibility

Service tokens are validated against the database and their scope/permissions
are stored in request.state for downstream tool authorization.
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

# Service token prefix for identification
_SERVICE_TOKEN_PREFIX = "awst_"


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


def _extract_bearer_token(request: Request) -> str | None:
    """Extract Bearer token from Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


async def validate_service_token(
    request: Request,
    raw_token: str,
) -> bool:
    """
    Validate a scoped service token for MCP access.

    Checks:
    - Token exists and is not revoked/expired
    - Token has MCP-related permissions

    On success, stores the resolved ServiceToken in request.state.service_token
    for downstream scope enforcement.
    """
    # Lazy import to avoid circular dependency at module load
    from app.services import service_token_service

    token = await service_token_service.validate_token(raw_token)
    if not token:
        return False

    # Store resolved token for downstream scope checks
    request.state.service_token = token
    request.state.actor_type = "service_token"
    request.state.actor_id = token.tokenId
    return True


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
    """
    ASGI middleware for MCP Streamable HTTP auth.

    Authentication priority:
    1. Scoped service token (Bearer awst_...) — preferred
    2. Flat API key (MCP_API_KEY) — legacy fallback
    """
    if not settings.MCP_ENABLED or not settings.MCP_HTTP_ENABLED:
        return await call_next(request)

    if not request.url.path.startswith("/mcp"):
        return await call_next(request)

    # Try scoped service token first
    bearer_token = _extract_bearer_token(request)
    if bearer_token and bearer_token.startswith(_SERVICE_TOKEN_PREFIX):
        if await validate_service_token(request, bearer_token):
            allowed = settings.get_mcp_allowed_origins_list()
            if not validate_origin(request, allowed):
                logger.warning("MCP request rejected: origin not allowed")
                return JSONResponse(
                    status_code=403,
                    content={"error": "Forbidden: origin not allowed"},
                )
            return await call_next(request)
        else:
            logger.warning("MCP request rejected: invalid service token")
            return JSONResponse(
                status_code=401,
                content={"error": "Unauthorized: invalid or expired service token"},
            )

    # Fall back to flat API key
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


async def get_mcp_service_token(request: Request):
    """
    FastAPI dependency to retrieve the authenticated service token from request.state.

    Returns the ServiceToken if authenticated via service token, None otherwise.
    Use this in MCP tool handlers to enforce scope checks.
    """
    return getattr(request.state, "service_token", None)


def check_token_scope(
    token,
    expected_scope_type: str,
    expected_scope_id: str,
) -> bool:
    """
    Check if a service token has access to the specified scope.

    Returns True if the token's scope matches the expected scope.
    """
    if not token:
        return False
    return (
        token.scopeType == expected_scope_type
        and token.scopeId == expected_scope_id
    )


def check_token_permission(token, required_permission: str) -> bool:
    """
    Check if a service token has a specific permission.

    Returns True if the token's permissions include the required permission.
    """
    if not token:
        return False
    return required_permission in token.permissions
