"""
Workspace API routes (skeleton)
GitHub-style nested route structure for workspaces.
"""
import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


@router.get("")
async def list_workspaces() -> dict[str, object]:
    """List all workspaces (skeleton)."""
    return {"workspaces": [], "total": 0}


@router.get("/healthz")
async def workspaces_healthz() -> dict[str, str]:
    """Health check for workspaces routes."""
    return {"status": "ok"}
