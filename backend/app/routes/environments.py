"""
Environment API routes
CRUD operations for environments
Now using shared service layer
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.repositories import EnvironmentRepository
from app.services import (
    list_environments as svc_list_environments,
    get_environment as svc_get_environment,
    get_active_environment as svc_get_active_environment,
    create_environment as svc_create_environment,
    update_environment as svc_update_environment,
    delete_environment as svc_delete_environment,
    activate_environment as svc_activate_environment,
    duplicate_environment as svc_duplicate_environment,
)

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.post("", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def create_environment(environment: EnvironmentCreate):
    """Create a new environment"""
    return await svc_create_environment(environment)


@router.get("", response_model=List[Environment])
async def list_environments():
    """List all environments"""
    return await svc_list_environments()


@router.get("/{environment_id}", response_model=Environment)
async def get_environment(environment_id: str):
    """Get an environment by ID"""
    try:
        return await svc_get_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/active/current", response_model=Environment)
async def get_active_environment():
    """Get the currently active environment"""
    try:
        return await svc_get_active_environment()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.put("/{environment_id}", response_model=Environment)
async def update_environment(environment_id: str, update: EnvironmentUpdate):
    """Update an environment"""
    try:
        return await svc_update_environment(environment_id, update)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(environment_id: str):
    """Delete an environment"""
    try:
        await svc_delete_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/{environment_id}/activate", response_model=Environment)
async def activate_environment(environment_id: str):
    """Set an environment as active - deactivates all others"""
    try:
        return await svc_activate_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/{environment_id}/duplicate", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def duplicate_environment(environment_id: str):
    """Duplicate an existing environment"""
    try:
        return await svc_duplicate_environment(environment_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
