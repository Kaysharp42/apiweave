"""
Collections API routes
CRUD operations for workflow collections
Now using shared service layer
"""
from fastapi import APIRouter, HTTPException, status, Query, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import uuid
import json
import re

from app.models import Collection, CollectionCreate, CollectionUpdate, CollectionImportRequest, CollectionImportDryRunRequest
from app.repositories import CollectionRepository, WorkflowRepository, EnvironmentRepository
from app.services import (
    list_collections as svc_list_collections,
    get_collection as svc_get_collection,
    create_collection as svc_create_collection,
    update_collection as svc_update_collection,
    delete_collection as svc_delete_collection,
    add_workflow_to_collection as svc_add_workflow,
    remove_workflow_from_collection as svc_remove_workflow,
    list_collection_workflows as svc_list_collection_workflows,
    export_collection as svc_export_collection,
)
from app.services.secret_utils import (
    detect_secrets_in_value,
    sanitize_secrets_in_dict,
)
from app.services.exceptions import ConflictError

router = APIRouter(prefix="/api/collections", tags=["collections"])


@router.post("", response_model=Collection, status_code=status.HTTP_201_CREATED)
async def create_collection(collection: CollectionCreate):
    """Create a new collection"""
    return await svc_create_collection(collection)


@router.get("", response_model=List[Collection])
async def list_collections():
    """List all collections"""
    return await svc_list_collections()


@router.get("/{collection_id}", response_model=Collection)
async def get_collection(collection_id: str):
    """Get a collection by ID"""
    try:
        return await svc_get_collection(collection_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.put("/{collection_id}", response_model=Collection)
async def update_collection(collection_id: str, update: CollectionUpdate):
    """Update a collection"""
    try:
        return await svc_update_collection(collection_id, update)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(collection_id: str):
    """Delete a collection"""
    try:
        await svc_delete_collection(collection_id)
    except ConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return None


@router.post("/{collection_id}/workflows/{workflow_id}", status_code=status.HTTP_200_OK)
async def add_workflow_to_collection(collection_id: str, workflow_id: str):
    """Add a workflow to a collection"""
    try:
        return await svc_add_workflow(collection_id, workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{collection_id}/workflows/{workflow_id}", status_code=status.HTTP_200_OK)
async def remove_workflow_from_collection(collection_id: str, workflow_id: str):
    """Remove a workflow from a collection"""
    try:
        return await svc_remove_workflow(collection_id, workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/{collection_id}/workflows", response_model=List)
async def get_collection_workflows(collection_id: str):
    """Get all workflows in a collection"""
    try:
        return await svc_list_collection_workflows(collection_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


# Secret detection helpers now live in app.services.secret_utils


# Export/Import Endpoints

@router.get("/{collection_id}/export")
async def export_collection(collection_id: str, include_environment: bool = Query(True)):
    """Export a collection with all workflows and environments"""
    try:
        return await svc_export_collection(collection_id, include_environment)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post("/import/dry-run")
async def import_collection_dry_run(
    request: CollectionImportDryRunRequest
):
    """Validate collection import without persisting (SQL injection safe)"""
    bundle = request.bundle
    createNewCollection = request.createNewCollection
    targetCollectionId = request.targetCollectionId
    
    # Validate bundle structure
    errors = []
    warnings = []
    
    if bundle.get("type") != "awecollection":
        errors.append("Invalid bundle type. Expected 'awecollection'")
    
    if bundle.get("version") != "1.0":
        errors.append(f"Unsupported bundle version: {bundle.get('version')}")
    
    if not bundle.get("collection"):
        errors.append("Bundle missing collection metadata")
    
    if not bundle.get("workflows"):
        errors.append("Bundle contains no workflows")
    
    # Validate collection metadata
    collection = bundle.get("collection", {})
    if not collection.get("name"):
        errors.append("Collection name is required")
    
    # If not creating new, verify target collection exists using repository
    if not createNewCollection and targetCollectionId:
        target = await CollectionRepository.get_by_id(targetCollectionId)
        if not target:
            errors.append(f"Target collection {targetCollectionId} not found")
    
    # Validate environments
    env_count = 0
    for env in bundle.get("environments", []):
        if not env.get("name"):
            errors.append(f"Environment missing name")
        else:
            env_count += 1
    
    # Validate workflows
    wf_count = 0
    node_count = 0
    for wf in bundle.get("workflows", []):
        if not wf.get("name"):
            errors.append(f"Workflow missing name")
        else:
            wf_count += 1
            node_count += len(wf.get("nodes", []))
    
    # Check for secrets
    secret_count = len(bundle.get("secretReferences", []))
    if secret_count > 0:
        warnings.append(f"Bundle contains {secret_count} secret placeholders - re-enter sensitive values after import")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "workflowCount": wf_count,
            "environmentCount": env_count,
            "nodeCount": node_count,
            "secretCount": secret_count
        }
    }


@router.post("/import")
async def import_collection(
    request: CollectionImportRequest
):
    """Import a collection bundle (SQL injection safe)"""
    bundle = request.bundle
    createNewCollection = request.createNewCollection
    newCollectionName = request.newCollectionName
    targetCollectionId = request.targetCollectionId
    environmentMapping = request.environmentMapping
    
    # Run validation
    validation_request = CollectionImportDryRunRequest(
        bundle=bundle,
        createNewCollection=createNewCollection,
        targetCollectionId=targetCollectionId
    )
    validation = await import_collection_dry_run(validation_request)
    if not validation["valid"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Bundle validation failed: {', '.join(validation['errors'])}"
        )
    
    # Create or use existing collection
    if createNewCollection:
        if not newCollectionName:
            newCollectionName = bundle["collection"].get("name", "Imported Collection")
        
        # Use repository to create collection
        from app.models import CollectionCreate
        collection_create = CollectionCreate(
            name=newCollectionName,
            description=bundle["collection"].get("description", ""),
            color=bundle["collection"].get("color", "#3B82F6")
        )
        new_collection = await CollectionRepository.create(collection_create)
        collection_id = new_collection.collectionId
    else:
        collection_id = targetCollectionId
        if not collection_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Target collection ID is required when not creating new collection"
            )
        # Verify collection exists using repository
        col = await CollectionRepository.get_by_id(collection_id)
        if not col:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection {collection_id} not found"
            )
    
    # Build environment mapping
    env_mapping = {}
    if environmentMapping is None:
        environmentMapping = {}
    
    # Create/map environments using repository
    for bundle_env in bundle.get("environments", []):
        bundle_env_id = bundle_env.get("environmentId")
        
        # Check if mapping provided
        if bundle_env_id in environmentMapping:
            target_env_id = environmentMapping[bundle_env_id]
            if target_env_id == "create":
                # Create new environment using repository
                from app.models import EnvironmentCreate
                env_create = EnvironmentCreate(
                    name=bundle_env.get("name", "Imported Environment"),
                    description=None,
                    swaggerDocUrl=bundle_env.get("swaggerDocUrl"),
                    variables=bundle_env.get("variables", {}),
                    secrets={}
                )
                new_env = await EnvironmentRepository.create(env_create)
                env_mapping[bundle_env_id] = new_env.environmentId
            else:
                # Map to existing - verify it exists
                existing_env = await EnvironmentRepository.get_by_id(target_env_id)
                if not existing_env:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Environment {target_env_id} not found"
                    )
                env_mapping[bundle_env_id] = target_env_id
        else:
            # Auto-create if no mapping specified
            from app.models import EnvironmentCreate
            env_create = EnvironmentCreate(
                name=bundle_env.get("name", "Imported Environment"),
                description=None,
                swaggerDocUrl=bundle_env.get("swaggerDocUrl"),
                variables=bundle_env.get("variables", {}),
                secrets={}
            )
            new_env = await EnvironmentRepository.create(env_create)
            env_mapping[bundle_env_id] = new_env.environmentId
    
    # Import workflows using repository
    workflow_ids = []
    now = datetime.now(UTC)
    
    for bundle_wf in bundle.get("workflows", []):
        # Map environment if present
        env_id_to_use = None
        if bundle_wf.get("environmentId") in env_mapping:
            env_id_to_use = env_mapping[bundle_wf.get("environmentId")]
        
        # Create workflow using repository
        from app.models import WorkflowCreate
        workflow_create = WorkflowCreate(
            name=bundle_wf.get("name"),
            description=bundle_wf.get("description", ""),
            nodes=bundle_wf.get("nodes", []),
            edges=bundle_wf.get("edges", []),
            variables=bundle_wf.get("variables", {}),
            tags=bundle_wf.get("tags", []),
            collectionId=collection_id,
            nodeTemplates=[]
        )
        new_workflow = await WorkflowRepository.create(workflow_create)
        
        # Update workflow with environmentId if needed (not in WorkflowCreate)
        if env_id_to_use:
            new_workflow.environmentId = env_id_to_use
            await new_workflow.save()
        
        workflow_ids.append(new_workflow.workflowId)
    
    # Dispatch event to refresh collections
    import subprocess
    import platform
    
    return {
        "collectionId": collection_id,
        "collectionName": bundle["collection"].get("name", "Imported Collection") if createNewCollection else collection_id,
        "workflowIds": workflow_ids,
        "environmentMapping": env_mapping,
        "secretReferences": bundle.get("secretReferences", []),
        "workflowCount": len(workflow_ids)
    }


@router.post("/{collection_id}/workflows/{workflow_id}/assign")
async def assign_workflow_to_collection(
    collection_id: str,
    workflow_id: str
):
    """Assign an existing workflow to a collection (SQL injection safe)"""
    # Verify collection exists using repository
    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Verify workflow exists and assign using repository
    workflow = await WorkflowRepository.update_collection_assignment(workflow_id, collection_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return {"success": True, "workflowId": workflow_id, "collectionId": collection_id}

