"""
APIWeave - Visual API Test Workflows Made Simple
Main FastAPI application entry point
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import connect_db, close_db
from app.config import settings
from app.routes import workflows, runs, environments, collections, webhooks

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    await connect_db()

    if settings.MCP_ENABLED and settings.MCP_HTTP_ENABLED:
        from app.mcp.server import mcp_server, register_tools
        from app.mcp.transport import streamable_http_lifespan

        register_tools()
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

# MCP Streamable HTTP mount
if settings.MCP_ENABLED and settings.MCP_HTTP_ENABLED:
    from app.mcp.auth import auth_middleware
    from app.mcp.server import mcp_server, register_tools

    register_tools()

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
