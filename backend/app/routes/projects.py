"""
Project API routes (skeleton)
GitHub-style nested route structure for projects.
"""
import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects() -> dict[str, object]:
    """List all projects (skeleton)."""
    return {"projects": [], "total": 0}


@router.get("/healthz")
async def projects_healthz() -> dict[str, str]:
    """Health check for projects routes."""
    return {"status": "ok"}
