"""
Environment API routes
CRUD operations for environments
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Environment, EnvironmentCreate, EnvironmentUpdate
from app.database import get_database

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.post("", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def create_environment(environment: EnvironmentCreate):
    """Create a new environment"""
    db = get_database()
    
    environment_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    environment_doc = {
        "environmentId": environment_id,
        "name": environment.name,
        "description": environment.description,
        "variables": environment.variables,
        "isActive": False,  # New environments are not active by default
        "createdAt": now,
        "updatedAt": now
    }
    
    await db.environments.insert_one(environment_doc)
    
    return Environment(**environment_doc)


@router.get("", response_model=List[Environment])
async def list_environments():
    """List all environments"""
    db = get_database()
    
    cursor = db.environments.find({}).sort("createdAt", -1)
    environments = await cursor.to_list(length=None)
    
    return [Environment(**env) for env in environments]


@router.get("/{environment_id}", response_model=Environment)
async def get_environment(environment_id: str):
    """Get an environment by ID"""
    db = get_database()
    
    environment = await db.environments.find_one({"environmentId": environment_id})
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    return Environment(**environment)


@router.get("/active/current", response_model=Environment)
async def get_active_environment():
    """Get the currently active environment"""
    db = get_database()
    
    environment = await db.environments.find_one({"isActive": True})
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active environment set"
        )
    
    return Environment(**environment)


@router.put("/{environment_id}", response_model=Environment)
async def update_environment(environment_id: str, update: EnvironmentUpdate):
    """Update an environment"""
    db = get_database()
    
    # Check if environment exists
    existing = await db.environments.find_one({"environmentId": environment_id})
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    # Build update document
    update_doc = {"updatedAt": datetime.now(UTC)}
    if update.name is not None:
        update_doc["name"] = update.name
    if update.description is not None:
        update_doc["description"] = update.description
    if update.variables is not None:
        update_doc["variables"] = update.variables
    if update.isActive is not None:
        update_doc["isActive"] = update.isActive
        
        # If setting this environment as active, deactivate all others
        if update.isActive:
            await db.environments.update_many(
                {"environmentId": {"$ne": environment_id}},
                {"$set": {"isActive": False}}
            )
    
    # Update the environment
    await db.environments.update_one(
        {"environmentId": environment_id},
        {"$set": update_doc}
    )
    
    # Fetch and return updated environment
    updated_env = await db.environments.find_one({"environmentId": environment_id})
    return Environment(**updated_env)


@router.delete("/{environment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment(environment_id: str):
    """Delete an environment"""
    db = get_database()
    
    # Check if environment exists
    environment = await db.environments.find_one({"environmentId": environment_id})
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    # Check if any workflows are attached to this environment
    workflows_count = await db.workflows.count_documents({"environmentId": environment_id})
    if workflows_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete environment. {workflows_count} workflow(s) are still attached to it."
        )
    
    # Delete the environment
    await db.environments.delete_one({"environmentId": environment_id})


@router.post("/{environment_id}/activate", response_model=Environment)
async def activate_environment(environment_id: str):
    """Set an environment as active (deactivates all others)"""
    db = get_database()
    
    # Check if environment exists
    environment = await db.environments.find_one({"environmentId": environment_id})
    if not environment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    # Deactivate all environments
    await db.environments.update_many(
        {},
        {"$set": {"isActive": False}}
    )
    
    # Activate the specified environment
    await db.environments.update_one(
        {"environmentId": environment_id},
        {"$set": {"isActive": True, "updatedAt": datetime.now(UTC)}}
    )
    
    # Fetch and return activated environment
    updated_env = await db.environments.find_one({"environmentId": environment_id})
    return Environment(**updated_env)


@router.post("/{environment_id}/duplicate", response_model=Environment, status_code=status.HTTP_201_CREATED)
async def duplicate_environment(environment_id: str):
    """Duplicate an existing environment"""
    db = get_database()
    
    # Check if environment exists
    source_env = await db.environments.find_one({"environmentId": environment_id})
    if not source_env:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Environment {environment_id} not found"
        )
    
    # Create duplicate
    new_environment_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    duplicate_doc = {
        "environmentId": new_environment_id,
        "name": f"{source_env['name']} (Copy)",
        "description": source_env.get("description"),
        "variables": source_env.get("variables", {}),
        "isActive": False,  # Duplicates are never active by default
        "createdAt": now,
        "updatedAt": now
    }
    
    await db.environments.insert_one(duplicate_doc)
    
    return Environment(**duplicate_doc)
