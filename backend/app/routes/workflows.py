"""
Workflow API routes
CRUD operations for workflows
"""
from fastapi import APIRouter, HTTPException, status
from typing import List
from datetime import datetime, UTC
import uuid
import json
from bson import ObjectId

from app.models import Workflow, WorkflowCreate, WorkflowUpdate
from app.database import get_database
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


@router.post("", response_model=Workflow, status_code=status.HTTP_201_CREATED)
async def create_workflow(workflow: WorkflowCreate):
    """Create a new workflow"""
    db = get_database()
    
    workflow_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    workflow_doc = {
        "workflowId": workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "nodes": [node.model_dump() for node in workflow.nodes],
        "edges": [edge.model_dump() for edge in workflow.edges],
        "variables": workflow.variables,
        "tags": workflow.tags,
        "createdAt": now,
        "updatedAt": now,
        "version": 1
    }
    
    await db.workflows.insert_one(workflow_doc)
    
    return Workflow(**workflow_doc)


@router.get("", response_model=List[Workflow])
async def list_workflows(skip: int = 0, limit: int = 100, tag: str = None):
    """List all workflows"""
    db = get_database()
    
    query = {}
    if tag:
        query["tags"] = tag
    
    cursor = db.workflows.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    workflows = await cursor.to_list(length=limit)
    
    return [Workflow(**workflow) for workflow in workflows]


@router.get("/{workflow_id}", response_model=Workflow)
async def get_workflow(workflow_id: str):
    """Get a workflow by ID"""
    db = get_database()
    
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return Workflow(**workflow)


@router.put("/{workflow_id}", response_model=Workflow)
async def update_workflow(workflow_id: str, update: WorkflowUpdate):
    """Update a workflow"""
    db = get_database()
    
    # Check if workflow exists
    existing = await db.workflows.find_one({"workflowId": workflow_id})
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Build update document
    update_doc = {"updatedAt": datetime.now(UTC)}
    if update.name is not None:
        update_doc["name"] = update.name
    if update.description is not None:
        update_doc["description"] = update.description
    if update.nodes is not None:
        update_doc["nodes"] = [node.model_dump() for node in update.nodes]
    if update.edges is not None:
        update_doc["edges"] = [edge.model_dump() for edge in update.edges]
    if update.variables is not None:
        update_doc["variables"] = update.variables
    if update.tags is not None:
        update_doc["tags"] = update.tags
    
    # Increment version
    update_doc["version"] = existing.get("version", 1) + 1
    
    await db.workflows.update_one(
        {"workflowId": workflow_id},
        {"$set": update_doc}
    )
    
    # Fetch and return updated workflow
    updated = await db.workflows.find_one({"workflowId": workflow_id})
    return Workflow(**updated)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: str):
    """Delete a workflow"""
    db = get_database()
    
    result = await db.workflows.delete_one({"workflowId": workflow_id})
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return None


@router.post("/{workflow_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_workflow(workflow_id: str):
    """Trigger a workflow run"""
    db = get_database()
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    run_id = str(uuid.uuid4())
    now = datetime.now(UTC)
    
    run_doc = {
        "runId": run_id,
        "workflowId": workflow_id,
        "status": "pending",
        "trigger": "manual",
        "variables": workflow.get("variables", {}),
        "callbackUrl": None,
        "results": [],
        "createdAt": now,
        "startedAt": None,
        "completedAt": None,
        "duration": None,
        "error": None
    }
    
    await db.runs.insert_one(run_doc)
    
    # TODO: Trigger actual workflow execution (via queue/worker)
    
    return {
        "message": "Workflow run triggered",
        "runId": run_id,
        "workflowId": workflow_id,
        "status": "pending"
    }


@router.get("/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str, page: int = 1, limit: int = 10):
    """Get runs for a workflow with pagination (lightweight list view)"""
    db = get_database()
    
    # Verify workflow exists
    workflow = await db.workflows.find_one({"workflowId": workflow_id})
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Calculate skip value for pagination
    skip = (page - 1) * limit
    
    # Get total count
    total_count = await db.runs.count_documents({"workflowId": workflow_id})
    
    # Get runs sorted by most recent first (createdAt descending)
    # Only fetch essential fields for list view - exclude heavy nodeStatuses
    projection = {
        "_id": 0,
        "runId": 1,
        "workflowId": 1,
        "status": 1,
        "trigger": 1,
        "createdAt": 1,
        "startedAt": 1,
        "completedAt": 1,
        "duration": 1,
        "error": 1
    }
    
    cursor = db.runs.find(
        {"workflowId": workflow_id},
        projection
    ).sort("createdAt", -1).skip(skip).limit(limit)
    
    runs = await cursor.to_list(length=limit)
    
    # Calculate pagination info
    total_pages = (total_count + limit - 1) // limit  # Ceiling division
    
    return {
        "runs": runs,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total_count,
            "totalPages": total_pages,
            "hasNext": page < total_pages,
            "hasPrevious": page > 1
        }
    }


@router.get("/{workflow_id}/runs/{run_id}")
async def get_run_status(workflow_id: str, run_id: str):
    """Get the status of a workflow run with full node results"""
    db = get_database()
    
    run = await db.runs.find_one({"runId": run_id, "workflowId": workflow_id})
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    # Remove MongoDB _id from response
    run.pop('_id', None)
    
    # Fetch full node results from separate collection
    if run.get('nodeStatuses'):
        gridfs_bucket = AsyncIOMotorGridFSBucket(db)
        
        for node_id in run['nodeStatuses'].keys():
            full_result = await db.node_results.find_one(
                {"runId": run_id, "nodeId": node_id},
                {"_id": 0}
            )
            if full_result:
                result = full_result.get('result', {})
                
                # Check if result is stored in GridFS
                if isinstance(result, dict) and result.get('stored_in_gridfs'):
                    gridfs_file_id = result.get('gridfs_file_id')
                    if gridfs_file_id:
                        try:
                            # Download the file from GridFS
                            grid_out = await gridfs_bucket.open_download_stream(ObjectId(gridfs_file_id))
                            file_data = await grid_out.read()
                            
                            # Parse JSON and replace with actual result
                            actual_result = json.loads(file_data.decode('utf-8'))
                            
                            # Replace summary with full result (including GridFS metadata)
                            run['nodeStatuses'][node_id] = {
                                "status": full_result.get('status'),
                                "result": actual_result,  # Full result from GridFS
                                "timestamp": full_result.get('timestamp'),
                                "metadata": {
                                    "stored_in_gridfs": True,
                                    "size_mb": result.get('size_mb')
                                }
                            }
                        except Exception as e:
                            # If GridFS fetch fails, keep the reference
                            run['nodeStatuses'][node_id] = {
                                "status": full_result.get('status'),
                                "result": {"error": f"Failed to retrieve large result: {str(e)}"},
                                "timestamp": full_result.get('timestamp')
                            }
                    else:
                        # Missing file ID
                        run['nodeStatuses'][node_id] = {
                            "status": full_result.get('status'),
                            "result": result,
                            "timestamp": full_result.get('timestamp')
                        }
                else:
                    # Regular result (not in GridFS)
                    run['nodeStatuses'][node_id] = {
                        "status": full_result.get('status'),
                        "result": result,
                        "timestamp": full_result.get('timestamp')
                    }
    
    return run


@router.get("/{workflow_id}/runs/{run_id}/nodes/{node_id}/result")
async def get_node_result(workflow_id: str, run_id: str, node_id: str):
    """
    Get the full result for a specific node in a run.
    Handles both regular results and GridFS-stored large results.
    """
    db = get_database()
    
    # Verify run exists
    run = await db.runs.find_one({"runId": run_id, "workflowId": workflow_id})
    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    # Fetch node result
    node_result = await db.node_results.find_one(
        {"runId": run_id, "nodeId": node_id},
        {"_id": 0}
    )
    
    if not node_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Result for node {node_id} not found"
        )
    
    # Check if result is stored in GridFS
    result = node_result.get('result', {})
    if result.get('stored_in_gridfs'):
        gridfs_file_id = result.get('gridfs_file_id')
        if not gridfs_file_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="GridFS file ID missing"
            )
        
        try:
            # Initialize GridFS bucket
            gridfs_bucket = AsyncIOMotorGridFSBucket(db)
            
            # Download the file from GridFS
            grid_out = await gridfs_bucket.open_download_stream(ObjectId(gridfs_file_id))
            file_data = await grid_out.read()
            
            # Parse JSON and return
            full_result = json.loads(file_data.decode('utf-8'))
            
            return {
                "nodeId": node_id,
                "runId": run_id,
                "status": node_result.get('status'),
                "timestamp": node_result.get('timestamp'),
                "result": full_result,
                "metadata": {
                    "stored_in_gridfs": True,
                    "size_mb": result.get('size_mb'),
                    "gridfs_file_id": gridfs_file_id
                }
            }
            
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to retrieve result from GridFS: {str(e)}"
            )
    
    # Regular result (not in GridFS)
    return {
        "nodeId": node_id,
        "runId": run_id,
        "status": node_result.get('status'),
        "timestamp": node_result.get('timestamp'),
        "result": result,
        "metadata": {
            "stored_in_gridfs": False
        }
    }
