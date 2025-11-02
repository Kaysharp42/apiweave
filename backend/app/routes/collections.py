"""
Collections API routes
CRUD operations for workflow collections
Now using Beanie ODM with repository pattern
"""
from fastapi import APIRouter, HTTPException, status, Query, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import uuid
import json
import re

from app.models import Collection, CollectionCreate, CollectionUpdate, CollectionImportRequest, CollectionImportDryRunRequest
from app.repositories import CollectionRepository, WorkflowRepository, EnvironmentRepository

router = APIRouter(prefix="/api/collections", tags=["collections"])


@router.post("", response_model=Collection, status_code=status.HTTP_201_CREATED)
async def create_collection(collection: CollectionCreate):
    """Create a new collection (SQL injection safe)"""
    created_collection = await CollectionRepository.create(collection)
    return created_collection


@router.get("", response_model=List[Collection])
async def list_collections():
    """List all collections (SQL injection safe)"""
    collections_list, _ = await CollectionRepository.list_all(skip=0, limit=1000)
    
    # Calculate workflow count for each collection using repository
    for col in collections_list:
        count = await WorkflowRepository.count_by_collection(col.collectionId)
        col.workflowCount = count
    
    return collections_list


@router.get("/{collection_id}", response_model=Collection)
async def get_collection(collection_id: str):
    """Get a collection by ID (SQL injection safe)"""
    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Get workflow count using repository
    count = await WorkflowRepository.count_by_collection(collection_id)
    collection.workflowCount = count
    
    return collection


@router.put("/{collection_id}", response_model=Collection)
async def update_collection(collection_id: str, update: CollectionUpdate):
    """Update a collection (SQL injection safe)"""
    # Update using repository
    updated_col = await CollectionRepository.update(collection_id, update)
    
    if not updated_col:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Get workflow count using repository
    count = await WorkflowRepository.count_by_collection(collection_id)
    updated_col.workflowCount = count
    
    return updated_col


@router.delete("/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_collection(collection_id: str):
    """Delete a collection (SQL injection safe)"""
    # Check if collection exists
    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Check if any workflows are in this collection using repository
    workflows_count = await WorkflowRepository.count_by_collection(collection_id)
    if workflows_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete collection. {workflows_count} workflow(s) are still in it."
        )
    
    # Delete the collection using repository
    deleted = await CollectionRepository.delete(collection_id)
    return None


@router.post("/{collection_id}/workflows/{workflow_id}", status_code=status.HTTP_200_OK)
async def add_workflow_to_collection(collection_id: str, workflow_id: str):
    """Add a workflow to a collection (SQL injection safe)"""
    # Verify collection exists using repository
    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Verify workflow exists and assign to collection using repository
    updated = await WorkflowRepository.update_collection_assignment(workflow_id, collection_id)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return updated


@router.delete("/{collection_id}/workflows/{workflow_id}", status_code=status.HTTP_200_OK)
async def remove_workflow_from_collection(collection_id: str, workflow_id: str):
    """Remove a workflow from a collection (SQL injection safe)"""
    # Verify workflow exists and is in this collection using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    if workflow.collectionId != collection_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Workflow is not in collection {collection_id}"
        )
    
    # Remove from collection using repository
    updated = await WorkflowRepository.update_collection_assignment(workflow_id, None)
    
    return updated


@router.get("/{collection_id}/workflows", response_model=List)
async def get_collection_workflows(collection_id: str):
    """Get all workflows in a collection (SQL injection safe)"""
    # Verify collection exists using repository
    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Get workflows using repository
    workflows = await WorkflowRepository.list_by_collection(collection_id)
    
    return workflows


# Helper functions for export/import

def detect_secrets_in_value(value: str) -> bool:
    """Detect if a value might be a secret based on patterns"""
    if not isinstance(value, str):
        return False
    
    secret_patterns = [
        r'bearer\s+[a-zA-Z0-9_\-\.]+',  # Bearer tokens
        r'api[_-]?key',  # API keys
        r'secret',  # Secret keywords
        r'token',  # Token keywords
        r'password',  # Password keywords
        r'sk_live_',  # Stripe live keys
        r'pk_live_',  # Stripe public keys
    ]
    
    for pattern in secret_patterns:
        if re.search(pattern, value, re.IGNORECASE):
            return True
    
    return False


def sanitize_secrets_in_dict(data: Dict[str, Any], secret_refs: List[str], path: str = "") -> Dict[str, Any]:
    """
    Recursively replace potential secret values with <SECRET> placeholder
    and track their paths in secret_refs list
    """
    if not isinstance(data, dict):
        return data
    
    sanitized = {}
    for key, value in data.items():
        current_path = f"{path}.{key}" if path else key
        
        if isinstance(value, dict):
            sanitized[key] = sanitize_secrets_in_dict(value, secret_refs, current_path)
        elif isinstance(value, str) and detect_secrets_in_value(value):
            sanitized[key] = "<SECRET>"
            secret_refs.append(current_path)
        else:
            sanitized[key] = value
    
    return sanitized


# Export/Import Endpoints

@router.get("/{collection_id}/export")
async def export_collection(collection_id: str, include_environment: bool = Query(True)):
    """Export a collection with all workflows and environments (SQL injection safe)"""
    # Verify collection exists using repository
    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Collection {collection_id} not found"
        )
    
    # Get all workflows in collection using repository
    workflows_list, _ = await WorkflowRepository.list_by_collection(collection_id, skip=0, limit=1000)
    
    # Get unique environment IDs from workflows
    environment_ids = set()
    for wf in workflows_list:
        if wf.environmentId:
            environment_ids.add(wf.environmentId)
    
    # Get environments if requested using repository
    environments_list = []
    if include_environment and environment_ids:
        for env_id in environment_ids:
            env = await EnvironmentRepository.get_by_id(env_id)
            if env:
                # Sanitize environment variables
                secret_refs = []
                sanitized_vars = sanitize_secrets_in_dict(
                    env.variables if env.variables else {},
                    secret_refs,
                    f"environments.{env_id}.variables"
                )
                # Convert to dict for export
                env_dict = env.model_dump(by_alias=True)
                env_dict["variables"] = sanitized_vars
                environments_list.append(env_dict)
    
    # Build export bundle
    secret_refs = []
    sanitized_workflows = []
    
    for wf in workflows_list:
        wf_secret_refs = []
        
        # Convert Beanie Document to dict for processing
        wf_dict = wf.model_dump(by_alias=True)
        
        # Sanitize workflow variables
        sanitized_vars = sanitize_secrets_in_dict(
            wf_dict.get("variables", {}),
            wf_secret_refs,
            f"workflows.variables"
        )
        
        # Sanitize node configs
        sanitized_nodes = []
        for node in wf_dict.get("nodes", []):
            node_copy = dict(node)
            if "config" in node_copy and isinstance(node_copy["config"], dict):
                node_secret_refs = []
                sanitized_config = sanitize_secrets_in_dict(
                    node_copy["config"],
                    node_secret_refs,
                    f"nodes.{node.get('nodeId', 'unknown')}.config"
                )
                for ref in node_secret_refs:
                    wf_secret_refs.append(f"workflows.nodes.{ref}")
                node_copy["config"] = sanitized_config
            sanitized_nodes.append(node_copy)
        
        sanitized_wf = {
            "workflowId": wf_dict.get("workflowId"),
            "name": wf_dict.get("name"),
            "description": wf_dict.get("description", ""),
            "nodes": sanitized_nodes,
            "edges": wf_dict.get("edges", []),
            "variables": sanitized_vars,
            "tags": wf_dict.get("tags", []),
            "environmentId": wf_dict.get("environmentId")
        }
        
        sanitized_workflows.append(sanitized_wf)
        secret_refs.extend(wf_secret_refs)
    
    # Convert collection to dict
    collection_dict = collection.model_dump(by_alias=True)
    
    export_bundle = {
        "type": "awecollection",
        "version": "1.0",
        "collection": {
            "name": collection_dict.get("name"),
            "description": collection_dict.get("description", ""),
            "color": collection_dict.get("color", "#3B82F6")
        },
        "workflows": sanitized_workflows,
        "environments": [{
            "environmentId": env.get("environmentId"),
            "name": env.get("name"),
            "variables": env.get("variables", {})
        } for env in environments_list],
        "secretReferences": secret_refs,
        "metadata": {
            "exportedAt": datetime.now(UTC).isoformat(),
            "apiweaveVersion": "0.1.0",
            "workflowCount": len(sanitized_workflows),
            "environmentCount": len(environments_list)
        }
    }
    
    return export_bundle


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

