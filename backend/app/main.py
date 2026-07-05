"""
APIWeave - Visual API Test Workflows Made Simple
Main FastAPI application entry point
"""

import hmac
import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.auth.dependencies import STATE_CHANGING_METHODS, csrf_protect
from app.auth.router import router as auth_router
from app.config import settings
from app.database import close_db, connect_db
from app.routes import (
    audit,
    auth_admin,
    billing,
    environment_protection,
    invites,
    keys,
    mcp_config,
    orgs,
    projects,
    runs,
    scoped_environments,
    secrets,
    service_tokens,
    webhooks,
    workspaces,
)
from app.services.webhook_runner import webhook_runner

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    await connect_db()
    await webhook_runner.start()

    if settings.MCP_ENABLED and settings.MCP_HTTP_ENABLED:
        from app.mcp.server import mcp_server, register_prompts, register_resources, register_tools
        from app.mcp.transport import streamable_http_lifespan

        register_tools()
        register_resources()
        register_prompts()
        async with streamable_http_lifespan(mcp_server):
            logger.info("MCP Streamable HTTP mounted at /mcp")
            yield
    else:
        yield

    await webhook_runner.stop()
    await close_db()


app = FastAPI(
    title="APIWeave",
    description="Visual API Test Workflows Made Simple",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.get_trusted_hosts_list(),
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Webhook-Token",
        "X-Webhook-Signature",
        "X-Webhook-Timestamp",
        "X-CSRF-Token",
        "X-Desktop-Token",
        "Idempotency-Key",
    ],
)

# Include routers
app.include_router(runs.router)
app.include_router(webhooks.router)
app.include_router(mcp_config.router)
app.include_router(auth_router)
app.include_router(auth_admin.router)
app.include_router(invites.router)
app.include_router(orgs.router)
app.include_router(workspaces.router)
app.include_router(projects.router)
app.include_router(keys.router)
app.include_router(scoped_environments.router)
app.include_router(secrets.router)
app.include_router(service_tokens.router)
app.include_router(environment_protection.router)
app.include_router(audit.router)
app.include_router(billing.router)

_CSRF_EXEMPT_PREFIXES = (
    "/api/auth/login",
    "/api/auth/callback",
    "/api/webhooks/",  # Webhooks are called by external systems, not browsers
)
_CSRF_EXEMPT_EXACT = {
    "/api/auth/csrf-token",
    "/api/auth/logout",
    "/api/auth/session/touch",
}


@app.middleware("http")
async def csrf_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return await call_next(request)

    path = request.url.path
    if path in _CSRF_EXEMPT_EXACT or any(path.startswith(p) for p in _CSRF_EXEMPT_PREFIXES):
        return await call_next(request)

    if (
        request.method in STATE_CHANGING_METHODS
        and "session" in request.cookies
        and "csrftoken" not in request.cookies
    ):
        return Response(
            status_code=403,
            content='{"detail":"CSRF token missing or invalid"}',
            media_type="application/json",
        )

    if "session" in request.cookies and "csrftoken" in request.cookies:
        try:
            await csrf_protect(request)
        except HTTPException:
            return Response(
                status_code=403,
                content='{"detail":"CSRF token missing or invalid"}',
                media_type="application/json",
            )

    return await call_next(request)


# MCP Streamable HTTP mount
if settings.MCP_ENABLED and settings.MCP_HTTP_ENABLED:
    from app.mcp.auth import MCPCORSMiddleware, auth_middleware
    from app.mcp.server import mcp_server, register_prompts, register_resources, register_tools

    register_tools()
    register_resources()
    register_prompts()

    app.middleware("http")(auth_middleware)

    mcp_streamable_http = mcp_server.streamable_http_app()
    mcp_streamable_http.add_middleware(MCPCORSMiddleware)
    app.mount("/mcp", mcp_streamable_http)
    logger.info("MCP Streamable HTTP mounted at /mcp")


def desktop_request_allowed(
    method: str, path: str, provided_token: str, expected_token: str
) -> bool:
    """Decide whether a request may pass the desktop-shell token gate.

    No-op (always allowed) when ``expected_token`` is empty. Otherwise every
    request needs a matching token EXCEPT CORS preflight, /health (boot gate),
    and the /mcp mount (external MCP clients reach it; it enforces its own auth).
    """
    if not expected_token:
        return True
    if method == "OPTIONS" or path == "/health" or path == "/mcp" or path.startswith("/mcp/"):
        return True
    return hmac.compare_digest(provided_token, expected_token)


@app.middleware("http")
async def desktop_token_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Gate every request behind the desktop shell's per-launch token.

    Added last so it's the outermost layer (runs first), rejecting browser /
    external requests before any auth or CSRF logic.
    """
    if not desktop_request_allowed(
        request.method,
        request.url.path,
        request.headers.get("X-Desktop-Token", ""),
        settings.DESKTOP_UI_TOKEN,
    ):
        return Response(
            status_code=403,
            content='{"detail":"Forbidden"}',
            media_type="application/json",
        )
    return await call_next(request)


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "name": "APIWeave",
        "version": "0.1.0",
        "status": "running",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "database": "connected",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
