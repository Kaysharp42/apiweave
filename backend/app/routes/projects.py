"""
Project API routes — direct access to projects with workspace isolation.

These routes provide direct project access by project ID, enforcing
workspace isolation. The primary project CRUD is nested under workspaces
(see workspaces.py), but these routes allow direct project lookup.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.dependencies import get_current_active_user
from app.models import User
from app.services import project_service
from app.services.exceptions import ResourceNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects_placeholder() -> dict[str, Any]:
    """
    Placeholder — projects should be listed via workspace-scoped routes:
    GET /api/workspaces/{workspace_id}/projects
    """
    return {
        "message": (
            "Use workspace-scoped project listing: " "GET /api/workspaces/{workspace_id}/projects"
        ),
        "projects": [],
        "total": 0,
    }


@router.get("/healthz")
async def projects_healthz() -> dict[str, str]:
    """Health check for projects routes."""
    return {"status": "ok"}


@router.get("/{project_id}", response_model=dict[str, Any])
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    """Get a project by ID with workspace isolation enforcement."""
    try:
        return await project_service.get_project(project_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
