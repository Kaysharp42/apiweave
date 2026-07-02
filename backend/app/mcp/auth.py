"""
Scoped service-token auth for MCP Streamable HTTP.

All MCP access requires a scoped service token (Bearer awst_...).
The legacy flat API key (MCP_API_KEY) path has been removed as part
of the GitHub-style scoped secrets refactor.

Service tokens are validated against the database and their scope/permissions
are propagated to MCP tool functions via scope_context contextvars.
"""

import logging
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.single_user import get_or_create_implicit_owner
from app.config import settings
from app.mcp.scope_context import McpScopeContext, get_scope, set_scope
from app.repositories.workspace_repository import WorkspaceRepository

logger = logging.getLogger(__name__)

# CORS headers applied to every MCP response so the sub-mount
# (which does not inherit the parent CORSMiddleware) stays usable
# from browser-based MCP clients.
_MCP_CORS_METHODS = "GET, POST, OPTIONS"
_MCP_CORS_HEADERS = "Authorization, Content-Type, MCP-API-Key"

# Service token prefix for identification
_SERVICE_TOKEN_PREFIX = "awst_"

# Permissions granted to the implicit single-user scope when
# MCP_REQUIRE_API_KEY=false. Mirrors the full "writer" set used by a
# scoped service token with everything enabled. If a new MCP permission
# is added, update this tuple so single-user mode doesn't silently lose
# access to the new capability.
_FULL_SINGLE_USER_PERMISSIONS: tuple[str, ...] = (
    "read",
    "write",
    "secrets.write",
    "runs.execute",
    "webhooks.manage",
)

# Cached single-user scope. Resolved once per process on first
# unauthenticated MCP request; subsequent requests reuse the same instance
# (the owner + workspace identity never changes for single-user mode).
_cached_default_scope: McpScopeContext | None = None


class _DefaultScopeUnavailable(Exception):
    """Single-user owner exists but no personal workspace was found."""


def _mcp_cors_headers(request: Request | None = None) -> dict[str, str]:
    """Build CORS headers for MCP responses.

    Echoes the request origin only when it appears in the allowlist. Never
    emits ``*`` together with ``Allow-Credentials: true`` (browsers reject
    the response), and never emits a comma-joined value (invalid per the
    CORS spec). When the request origin is not allowed, ``Allow-Origin`` is
    omitted so the browser blocks the response — which is the correct
    outcome for an untrusted origin.
    """
    allowed = settings.get_mcp_allowed_origins_list()
    request_origin = request.headers.get("origin") if request is not None else None

    headers: dict[str, str] = {
        "Access-Control-Allow-Methods": _MCP_CORS_METHODS,
        "Access-Control-Allow-Headers": _MCP_CORS_HEADERS,
        "Vary": "Origin",
    }

    if request_origin and request_origin in allowed:
        headers["Access-Control-Allow-Origin"] = request_origin
        headers["Access-Control-Allow-Credentials"] = "true"
    elif request_origin is None and len(allowed) == 1:
        headers["Access-Control-Allow-Origin"] = allowed[0]

    return headers


def _mcp_error_response(request: Request, status_code: int, message: str) -> JSONResponse:
    """Build a JSONResponse for MCP auth errors with CORS headers attached.

    Without these headers the browser blocks the response body, masking 401/403
    as opaque CORS failures instead of the real auth error.
    """
    return JSONResponse(
        status_code=status_code,
        content={"error": message},
        headers=_mcp_cors_headers(request),
    )


def _extract_bearer_token(request: Request) -> str | None:
    """Extract Bearer token from Authorization header."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


def validate_origin(request: Request, allowed_origins: list[str]) -> bool:
    """Validate the Origin header against allowed origins."""
    origin = request.headers.get("origin")
    if not origin:
        return True
    return origin in allowed_origins


async def _validate_and_set_scope(request: Request, raw_token: str) -> bool:
    """Validate a scoped service token and set the scope context.

    On success, stores the resolved ServiceToken in request.state.service_token
    and sets the McpScopeContext for downstream tool authorization.
    """
    from app.services import service_token_service

    token = await service_token_service.validate_token(raw_token)
    if not token:
        return False

    # Store resolved token for downstream scope checks
    request.state.service_token = token
    request.state.actor_type = "service_token"
    request.state.actor_id = token.tokenId

    # Set scope context for MCP tool functions
    set_scope(
        McpScopeContext(
            actor_type="service_token",
            actor_id=token.tokenId,
            scope_type=token.scopeType,
            scope_id=token.scopeId,
            permissions=list(token.permissions),
        )
    )

    return True


async def _set_default_scope() -> None:
    """Set the cached single-user scope for an unauthenticated MCP request.

    Resolves the implicit owner + personal workspace once per process and
    reuses the resulting :class:`McpScopeContext` on every subsequent call.
    A small race where two concurrent first-requests both resolve is
    harmless — ``get_or_create_implicit_owner`` is idempotent and the
    resulting context objects are equivalent.

    Raises :class:`_DefaultScopeUnavailable` when the implicit owner has no
    personal workspace; the middleware turns that into a 503 so the caller
    sees a meaningful error instead of an opaque downstream failure.
    """
    global _cached_default_scope

    if get_scope() is not None:
        return

    if _cached_default_scope is None:
        owner = await get_or_create_implicit_owner()
        workspace = await WorkspaceRepository.get_personal_for_user(owner.userId)
        if workspace is None:
            raise _DefaultScopeUnavailable(
                "No personal workspace exists for the single-user owner. "
                "Ensure DEPLOYMENT_MODE=single_user is set and the backend "
                "has completed first-run initialization."
            )
        _cached_default_scope = McpScopeContext(
            actor_type="mcp_unauthenticated",
            actor_id=owner.userId,
            scope_type="workspace",
            scope_id=workspace.workspaceId,
            permissions=list(_FULL_SINGLE_USER_PERMISSIONS),
        )

    set_scope(_cached_default_scope)


async def auth_middleware(request: Request, call_next):
    """
    ASGI middleware for MCP Streamable HTTP auth.

    All MCP access requires a scoped service token (Bearer awst_...) unless
    MCP_REQUIRE_API_KEY is False, in which case auth is skipped and a default
    scope is set for the single-user owner's personal workspace (intended for
    local single-user deployments). All error responses include CORS headers so
    browser clients can read the body instead of getting an opaque CORS block.
    """
    if not settings.MCP_ENABLED or not settings.MCP_HTTP_ENABLED:
        return await call_next(request)

    if not request.url.path.startswith("/mcp"):
        return await call_next(request)

    if request.method == "OPTIONS":
        return await call_next(request)

    if not settings.MCP_REQUIRE_API_KEY:
        if settings.DEPLOYMENT_MODE != "single_user":
            logger.error(
                "MCP_REQUIRE_API_KEY=false requires DEPLOYMENT_MODE=single_user; "
                "rejecting unauthenticated MCP request to avoid granting full "
                "scope to anonymous callers in a multi-tenant deployment."
            )
            return _mcp_error_response(
                request,
                503,
                "MCP misconfigured: MCP_REQUIRE_API_KEY=false is only valid when "
                "DEPLOYMENT_MODE=single_user. Set MCP_REQUIRE_API_KEY=true or fix "
                "DEPLOYMENT_MODE in backend/.env.",
            )
        try:
            await _set_default_scope()
        except _DefaultScopeUnavailable as exc:
            logger.error("MCP default scope unavailable: %s", exc)
            return _mcp_error_response(request, 503, str(exc))
        return await call_next(request)

    bearer_token = _extract_bearer_token(request)
    if not bearer_token:
        logger.warning("MCP request rejected: missing Authorization header")
        return _mcp_error_response(
            request,
            401,
            "Unauthorized: scoped service token required. " "Use Bearer awst_... authentication.",
        )

    if not bearer_token.startswith(_SERVICE_TOKEN_PREFIX):
        logger.warning("MCP request rejected: invalid token prefix")
        return _mcp_error_response(
            request,
            401,
            "Unauthorized: invalid token format. " "Scoped service tokens start with 'awst_'.",
        )

    if not await _validate_and_set_scope(request, bearer_token):
        logger.warning("MCP request rejected: invalid or expired service token")
        return _mcp_error_response(
            request,
            401,
            "Unauthorized: invalid or expired service token",
        )

    allowed = settings.get_mcp_allowed_origins_list()
    if not validate_origin(request, allowed):
        logger.warning("MCP request rejected: origin not allowed")
        return _mcp_error_response(request, 403, "Forbidden: origin not allowed")

    return await call_next(request)


class MCPCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        cors_headers = _mcp_cors_headers(request)

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
    return bool(token.scopeType == expected_scope_type and token.scopeId == expected_scope_id)


def check_token_permission(token, required_permission: str) -> bool:
    """
    Check if a service token has a specific permission.

    Returns True if the token's permissions include the required permission.
    """
    if not token:
        return False
    return required_permission in token.permissions
