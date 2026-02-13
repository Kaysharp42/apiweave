"""
Environment API routes
CRUD operations for environments
Now using Beanie ODM with repository pattern - FULLY MIGRATED ✅
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.repositories import EnvironmentRepository

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.post("", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def create_environment(environment: EnvironmentCreate):
    """Create a new environment (SQL injection safe)"""
    created_environment = await EnvironmentRepository.create(environment)
    return created_environment


@router.get("", response_model=List[Environment])
async def list_environments():
    """List all environments (SQL injection safe)"""
    environments, _ = await EnvironmentRepository.list_all(skip=0, limit=1000)
    return environments


@router.get("/{environment_id}", response_model=Environment)
async def get_environment(environment_id: str):
    """Get an environment by ID (SQL injection safe)"""
    environment = await EnvironmentRepository.get_by_id(environment_id)
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    return environment


@router.get("/active/current", response_model=Environment)
async def get_active_environment():
    """Get the currently active environment (SQL injection safe)"""
    environment = await EnvironmentRepository.get_active()
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active environment set"
        )
    
    return environment


@router.put("/{environment_id}", response_model=Environment)
async def update_environment(environment_id: str, update: EnvironmentUpdate):
    """Update an environment (SQL injection safe)"""
    # Handle isActive special case - deactivate others if setting active
    if update.isActive:
        await EnvironmentRepository.set_active(environment_id)
    
    # Update the environment
    updated_env = await EnvironmentRepository.update(environment_id, update)
    
    if not updated_env:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    return updated_env


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(environment_id: str):
    """Delete an environment (SQL injection safe)"""
    # Check if environment exists using repository
    environment = await EnvironmentRepository.get_by_id(environment_id)
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    # Check if any workflows reference this environment using Beanie
    from app.models import Workflow
    workflows_count = await Workflow.find(Workflow.environmentId == environment_id).count()
    if workflows_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete environment. {workflows_count} workflow(s) are still attached to it."
        )
    
    # Delete the environment using repository
    success = await EnvironmentRepository.delete(environment_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete environment"
        )


@router.post("/{environment_id}/activate", response_model=Environment)
async def activate_environment(environment_id: str):
    """Set an environment as active - deactivates all others (SQL injection safe)"""
    # Use repository to set active (handles deactivation of others)
    environment = await EnvironmentRepository.set_active(environment_id)
    
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    return environment


@router.post("/{environment_id}/duplicate", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def duplicate_environment(environment_id: str):
    """Duplicate an existing environment (SQL injection safe)"""
    # Check if environment exists using repository
    source_env = await EnvironmentRepository.get_by_id(environment_id)
    if not source_env:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    # Create duplicate using repository
    from app.models import EnvironmentCreate
    duplicate_data = EnvironmentCreate(
        name=f"{source_env.name} (Copy)",
        description=source_env.description,
        swaggerDocUrl=source_env.swaggerDocUrl,
        variables=source_env.variables.copy() if source_env.variables else {},
        secrets=source_env.secrets.copy() if source_env.secrets else {}
    )
    
    duplicate_env = await EnvironmentRepository.create(duplicate_data)
    return duplicate_env
