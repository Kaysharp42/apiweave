"""
Collections API routes
CRUD operations for workflow collections
"""
from fastapi import APIRouter, HTTPException, status
from typing import List, Optional
from datetime import datetime, UTC
import uuid

from app.models import Collection, CollectionCreate, CollectionUpdate
from app.database import get_database

router = APIRouter(prefix="/api/collections", tags=["collections"])


@router.post("", response_model=Collection, status_code=status.HTTP_201_CREATED)
async def create_collection(collection: CollectionCreate):
    """Create a new collection"""
    db = get_database()
    
    collection_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    collection_doc = {
        "collectionId": collection_id,
        "name": collection.name,
        "description": collection.description,
        "color": collection.color or "#3B82F6",  # Default blue
        "workflowCount": 0,
        "createdAt": now,
        "updatedAt": now
    }
    
    await db.collections.insert_one(collection_doc)
    
    return Collection(**collection_doc)


@router.get("", response_model=List[Collection])
async def list_collections():
    """List all collections"""
    db = get_database()
    
    cursor = db.collections.find({}).sort("createdAt", -1)
    collections_list = await cursor.to_list(length=None)
    
    # Calculate workflow count for each collection
    for col in collections_list:
        count = await db.workflows.count_documents({"collectionId": col["collectionId"]})
        col["workflowCount"] = count
    
    return [Collection(**col) for col in collections_list]


@router.get("/{collection_id}", response_model=Collection)
async def get_collection(collection_id: str):
    """Get a collection by ID"""
    db = get_database()
    
    collection = await db.collections.find_one({"collectionId": collection_id})
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Get workflow count
    count = await db.workflows.count_documents({"collectionId": collection_id})
    collection["workflowCount"] = count
    
    return Collection(**collection)


@router.put("/{collection_id}", response_model=Collection)
async def update_collection(collection_id: str, update: CollectionUpdate):
    """Update a collection"""
    db = get_database()
    
    # Check if collection exists
    existing = await db.collections.find_one({"collectionId": collection_id})
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Build update document
    update_doc = {"updatedAt": datetime.now(UTC)}
    if update.name is not None:
        update_doc["name"] = update.name
    if update.description is not None:
        update_doc["description"] = update.description
    if update.color is not None:
        update_doc["color"] = update.color
    
    # Update the collection
    await db.collections.update_one(
        {"collectionId": collection_id},
        {"$set": update_doc}
    )
    
    # Fetch and return updated collection
    updated_col = await db.collections.find_one({"collectionId": collection_id})
    
    # Get workflow count
    count = await db.workflows.count_documents({"collectionId": collection_id})
    updated_col["workflowCount"] = count
    
    return Collection(**updated_col)


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(collection_id: str):
    """Delete a collection"""
    db = get_database()
    
    # Check if collection exists
    collection = await db.collections.find_one({"collectionId": collection_id})
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Check if any workflows are in this collection
    workflows_count = await db.workflows.count_documents({"collectionId": collection_id})
    if workflows_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete collection. {workflows_count} workflow(s) are still in it."
        )
    
    # Delete the collection
    await db.collections.delete_one({"collectionId": collection_id})


@router.post("/{collection_id}/workflows/{workflow_id}", status_code=status.HTTP_200_OK)
async def add_workflow_to_collection(collection_id: str, workflow_id: str):
    """Add a workflow to a collection"""
    db = get_database()
    
    # Verify collection exists
    collection = await db.collections.find_one({"collectionId": collection_id})
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Add workflow to collection
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": {"collectionId": collection_id, "updatedAt": datetime.now(UTC)}}
    )
    
    # Return updated workflow
    updated = await db.workflows.find_one({"workflowId": workflow_id})
    from app.models import Workflow
    return Workflow(**updated)


@router.delete("/{collection_id}/workflows/{workflow_id}", status_code=status.HTTP_200_OK)
async def remove_workflow_from_collection(collection_id: str, workflow_id: str):
    """Remove a workflow from a collection"""
    db = get_database()
    
    # Verify workflow exists and is in this collection
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    if workflow.get("collectionId") != collection_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Workflow is not in collection {collection_id}"
        )
    
    # Remove from collection
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": {"collectionId": None, "updatedAt": datetime.now(UTC)}}
    )
    
    # Return updated workflow
    updated = await db.workflows.find_one({"workflowId": workflow_id})
    from app.models import Workflow
    return Workflow(**updated)


@router.get("/{collection_id}/workflows", response_model=List)
async def get_collection_workflows(collection_id: str):
    """Get all workflows in a collection"""
    db = get_database()
    
    # Verify collection exists
    collection = await db.collections.find_one({"collectionId": collection_id})
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    workflows = await db.workflows.find(
        {"collectionId": collection_id}
    ).sort("createdAt", -1).to_list(None)
    
    from app.models import Workflow
    return [Workflow(**w) for w in workflows]
