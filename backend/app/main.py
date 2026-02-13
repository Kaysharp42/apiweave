"""
APIWeave - Visual API Test Workflows
Main FastAPI application entry point
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_db, connect_db
from app.routes import collections, environments, runs, webhooks, workflows


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    await connect_db()
    yield
    # Shutdown
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


@app.get("/")
async def root():
    """Root endpoint"""
    return {"name": "APIWeave", "version": "0.1.0", "status": "running"}


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "database": "connected",  # TODO: Add actual DB health check
    }


# Import and include routers
# from app.api import workflows, runs
# app.include_router(workflows.router, prefix="/api/workflows", tags=["workflows"])
# app.include_router(runs.router, prefix="/api/runs", tags=["runs"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
