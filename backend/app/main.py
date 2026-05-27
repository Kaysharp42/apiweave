"""
APIWeave - Visual API Test Workflows Made Simple
Main FastAPI application entry point
"""

import logging
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.auth.dependencies import STATE_CHANGING_METHODS, csrf_protect
from app.auth.router import router as auth_router
from app.config import settings
from app.database import close_db, connect_db
from app.routes import auth_admin, collections, environments, mcp_config, runs, webhooks, workflows

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    await connect_db()

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

    await close_db()


app = FastAPI(
    title="APIWeave",
    description="Visual API Test Workflows Made Simple",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(workflows.router)
app.include_router(runs.router)
app.include_router(environments.router)
app.include_router(collections.router)
app.include_router(webhooks.router)
app.include_router(mcp_config.router)
app.include_router(auth_router)
app.include_router(auth_admin.router)

_CSRF_EXEMPT_PREFIXES = (
    "/api/auth/login",
    "/api/auth/callback",
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
    from app.mcp.auth import auth_middleware
    from app.mcp.server import mcp_server, register_prompts, register_resources, register_tools

    register_tools()
    register_resources()
    register_prompts()

    app.middleware("http")(auth_middleware)

    mcp_streamable_http = mcp_server.streamable_http_app()
    app.mount("/mcp", mcp_streamable_http)
    logger.info("MCP Streamable HTTP mounted at /mcp")


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
