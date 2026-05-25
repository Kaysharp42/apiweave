"""
Workflow API routes
CRUD operations for workflows
Now using Beanie ODM with repository pattern for enhanced security
"""
import logging
from fastapi import APIRouter, HTTPException, status, Query, UploadFile, File
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
import asyncio
import uuid
import json
import re
import httpx
from bson import ObjectId

from app.models import Workflow, WorkflowCreate, WorkflowUpdate, PaginatedWorkflows
from app.auth.dependencies import require_permission
from app.auth.permissions import WORKFLOWS_CREATE, WORKFLOWS_DELETE, WORKFLOWS_EXPORT, WORKFLOWS_IMPORT, WORKFLOWS_READ, WORKFLOWS_RUN, WORKFLOWS_UPDATE
from app.database import get_database
from app.config import settings
from app.repositories import WorkflowRepository, CollectionRepository, RunRepository, EnvironmentRepository
from app.services import (
    list_workflows as svc_list_workflows,
    list_unattached_workflows as svc_list_unattached,
    get_workflow as svc_get_workflow,
    create_workflow as svc_create_workflow,
    update_workflow as svc_update_workflow,
    delete_workflow as svc_delete_workflow,
    export_workflow as svc_export_workflow,
    import_workflow as svc_import_workflow,
    import_workflow_dry_run as svc_import_dry_run,
    attach_to_collection as svc_attach_to_collection,
    list_by_collection as svc_list_by_collection,
    trigger_workflow_run as svc_trigger_workflow_run,
)
from app.services.secret_utils import (
    detect_secrets_in_value,
    sanitize_secrets_in_dict,
    serialize_document_for_export,
)
from app.services.import_service import (
    parse_curl_to_workflow,
    parse_har_to_workflow,
    parse_openapi_to_workflow,
)
from app.utils.swagger_discovery import (
    parse_swagger_ui_query_hints,
    extract_swagger_ui_hints_from_html,
    build_swagger_config_candidates,
    extract_definitions_from_swagger_config,
    resolve_url,
    make_definition_scope,
)
from app.utils.openapi_examples import (
    resolve_openapi_schema_ref as resolve_openapi_schema_ref_helper,
    generate_example_from_schema as generate_example_from_schema_helper,
)
from app.utils.openapi_import_limits import (
    DEFAULT_FETCH_TIMEOUT_SECONDS,
    DEFAULT_FETCH_CONCURRENCY,
    validate_definition_limit,
    validate_endpoint_limit,
)
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

router = APIRouter(prefix="/api/workflows", tags=["workflows"])


def _node_id(node: Any) -> Optional[str]:
    if isinstance(node, dict):
        return node.get("nodeId")
    return getattr(node, "nodeId", None)


def _node_label(node: Any, fallback: str) -> str:
    if isinstance(node, dict):
        return node.get("label", fallback)
    return getattr(node, "label", fallback)


def _node_type(node: Any) -> Optional[str]:
    if isinstance(node, dict):
        return node.get("type")
    return getattr(node, "type", None)


def _derive_failed_node_ids(run: Any) -> List[str]:
    """Resolve failed node IDs from failedNodes, or fallback to nodeStatuses error states."""
    explicit_failed = list((getattr(run, "failedNodes", None) or []))
    explicit_failed = [node_id for node_id in explicit_failed if isinstance(node_id, str) and node_id]
    if explicit_failed:
        return explicit_failed

    node_statuses = getattr(run, "nodeStatuses", None) or {}
    if not isinstance(node_statuses, dict):
        return []

    error_like = {"error", "failed", "client_error", "server_error"}
    ordered = sorted(
        node_statuses.items(),
        key=lambda item: (item[1] or {}).get("timestamp") or "",
    )

    return [
        node_id
        for node_id, status_meta in ordered
        if isinstance(node_id, str) and ((status_meta or {}).get("status") in error_like)
    ]


# Helper functions for export/import — now in app.services.secret_utils
# and app.services.import_service. Kept here only for backward compatibility
# with endpoints that still use local parse_* calls.


@router.post("", response_model=Workflow, status_code=status.HTTP_201_CREATED, dependencies=[require_permission(WORKFLOWS_CREATE)])
async def create_workflow(workflow: WorkflowCreate):
    """Create a new workflow using shared service layer"""
    return await svc_create_workflow(workflow)


@router.get("", response_model=PaginatedWorkflows, dependencies=[require_permission(WORKFLOWS_READ)])
async def list_workflows(skip: int = 0, limit: int = 20, tag: Optional[str] = None):
    """List workflows with pagination using shared service layer"""
    return await svc_list_workflows(skip, limit, tag)


@router.get("/unattached", response_model=PaginatedWorkflows, dependencies=[require_permission(WORKFLOWS_READ)])
async def list_unattached_workflows(skip: int = 0, limit: int = 20):
    """Get all workflows not attached to any collection"""
    return await svc_list_unattached(skip, limit)


@router.get("/{workflow_id}", response_model=Workflow, dependencies=[require_permission(WORKFLOWS_READ)])
async def get_workflow(workflow_id: str):
    """Get a workflow by ID"""
    try:
        return await svc_get_workflow(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.put("/{workflow_id}", response_model=Workflow, dependencies=[require_permission(WORKFLOWS_UPDATE)])
async def update_workflow(workflow_id: str, update: WorkflowUpdate):
    """Update a workflow"""
    try:
        return await svc_update_workflow(workflow_id, update)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[require_permission(WORKFLOWS_DELETE)])
async def delete_workflow(workflow_id: str):
    """Delete a workflow"""
    try:
        await svc_delete_workflow(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return None


@router.post("/{workflow_id}/run", status_code=status.HTTP_202_ACCEPTED, dependencies=[require_permission(WORKFLOWS_RUN)])
async def run_workflow(
    workflow_id: str,
    environmentId: Optional[str] = Query(None),
    body: Optional[Dict[str, Any]] = None,
):
    """Trigger a workflow run with optional environment and runtime secrets.
    
    Body (optional JSON):
        { "secrets": { "API_KEY": "actual-value", ... } }
    
    Runtime secrets override the placeholder descriptions stored in the
    environment document so that real values are substituted at execution
    time without ever being persisted to the database.
    """
    runtime_secrets = (body or {}).get('secrets', {}) if body else {}
    resume_payload = (body or {}).get('resume', {}) if body else {}
    try:
        return await svc_trigger_workflow_run(
            workflow_id,
            environment_id=environmentId,
            runtime_secrets=runtime_secrets,
            resume=resume_payload,
        )
    except ValueError as e:
        message = str(e)
        if "not found" in message:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=message)
        if message.startswith("No failed"):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


@router.get("/{workflow_id}/runs", dependencies=[require_permission(WORKFLOWS_READ)])
async def get_workflow_runs(workflow_id: str, page: int = 1, limit: int = 10):
    """Get runs for a workflow with pagination (SQL injection safe)"""
    # Verify workflow exists using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Calculate skip value for pagination
    skip = (page - 1) * limit
    
    # Get runs using repository with pagination
    runs_list, total_count = await RunRepository.list_by_workflow(workflow_id, skip, limit)
    
    # Convert Beanie Documents to dicts for response (excluding heavy nodeStatuses)
    runs = []
    for run in runs_list:
        run_dict = {
            "runId": run.runId,
            "workflowId": run.workflowId,
            "status": run.status,
            "trigger": run.trigger,
            "createdAt": run.createdAt,
            "startedAt": run.startedAt,
            "completedAt": run.completedAt,
            "duration": run.duration,
            "error": run.error
        }
        runs.append(run_dict)
    
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


@router.get("/{workflow_id}/runs/latest-failed", dependencies=[require_permission(WORKFLOWS_READ)])
async def get_latest_failed_run_metadata(workflow_id: str):
    """Get latest failed run and failed node metadata for resume actions."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )

    latest_run = await RunRepository.get_latest_run(workflow_id)
    if not latest_run or latest_run.status != "failed":
        return {
            "hasFailedRun": False,
            "workflowId": workflow_id,
            "runId": None,
            "failedNodes": [],
        }

    failed_node_ids = _derive_failed_node_ids(latest_run)
    node_map = {_node_id(node): node for node in workflow.nodes}
    node_map.pop(None, None)

    failed_nodes = []
    for node_id in failed_node_ids:
        node = node_map.get(node_id, {})
        node_status = latest_run.nodeStatuses.get(node_id, {}) if latest_run.nodeStatuses else {}
        node_label = _node_label(node, node_id)
        node_type = _node_type(node)
        failed_nodes.append({
            "nodeId": node_id,
            "label": node_label,
            "type": node_type,
            "status": node_status.get("status"),
            "timestamp": node_status.get("timestamp"),
        })

    return {
        "hasFailedRun": True,
        "workflowId": workflow_id,
        "runId": latest_run.runId,
        "failedNodes": failed_nodes,
        "failedNodeIds": failed_node_ids,
        "failedCount": len(failed_nodes),
        "createdAt": latest_run.createdAt,
    }


@router.get("/{workflow_id}/runs/{run_id}", dependencies=[require_permission(WORKFLOWS_READ)])
async def get_run_status(workflow_id: str, run_id: str):
    """Get the status of a workflow run with full node results (SQL injection safe)"""
    # Get run using repository
    run_doc = await RunRepository.get_by_id(run_id)
    if not run_doc or run_doc.workflowId != workflow_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    # Convert to dict for processing
    run = run_doc.model_dump(by_alias=True)
    run.pop('_id', None)  # Remove MongoDB _id if present
    
    # Fetch full node results from separate collection (still uses direct DB for GridFS)
    if run.get('nodeStatuses'):
        db = get_database()
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


@router.get("/{workflow_id}/runs/{run_id}/nodes/{node_id}/result", dependencies=[require_permission(WORKFLOWS_READ)])
async def get_node_result(workflow_id: str, run_id: str, node_id: str):
    """
    Get the full result for a specific node in a run (SQL injection safe).
    Handles both regular results and GridFS-stored large results.
    """
    # Verify run exists using repository
    run = await RunRepository.get_by_id(run_id)
    if not run or run.workflowId != workflow_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run {run_id} not found"
        )
    
    # Fetch node result from direct DB (GridFS collection not in Beanie yet)
    db = get_database()
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


@router.get("/{workflow_id}/export", dependencies=[require_permission(WORKFLOWS_EXPORT)])
async def export_workflow(workflow_id: str, include_environment: bool = Query(True)):
    """Export a complete workflow bundle as JSON"""
    try:
        return await svc_export_workflow(
            workflow_id,
            include_environment=include_environment,
            app_version=settings.VERSION,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.exception("Export error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Export failed: {str(e)}",
        )


@router.post("/import", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_workflow(
    bundle: Dict[str, Any],
    environment_mapping: Optional[Dict[str, str]] = None,
    create_missing_environments: bool = True,
    sanitize: bool = False,
):
    """Import a workflow bundle"""
    try:
        return await svc_import_workflow(
            bundle,
            environment_mapping=environment_mapping,
            create_missing_environments=create_missing_environments,
            sanitize=sanitize,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/import/dry-run", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_workflow_dry_run(bundle: Dict[str, Any]):
    """Validate a workflow bundle without persisting"""
    return await svc_import_dry_run(bundle)


@router.post("/import/har", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_har_file(
    file: Optional[UploadFile] = File(None),
    import_mode: str = Query("linear"),
    environment_id: Optional[str] = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False)  # NEW: Just return nodes without creating workflow
):
    """
    Import a HAR file and convert to workflow
    Accepts file upload via multipart/form-data
    
    If parse_only=true, returns just the parsed nodes array without creating a workflow
    """
    try:
        # Parse HAR data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="HAR file is required"
            )
        
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in HAR file: {str(e)}"
            )
        
        # Validate HAR structure
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key"
            )
        
        # Convert HAR to workflow
        try:
            workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalRequests": len(http_nodes),
                    "importMode": import_mode
                }
            }
        
        # Otherwise, create full workflow in database using repository
        workflow_create = WorkflowCreate(
            name=workflow_data["name"],
            description=workflow_data["description"],
            nodes=workflow_data["nodes"],
            edges=workflow_data["edges"],
            variables=workflow_data.get("variables", {}),
            tags=workflow_data.get("tags", []),
            collectionId=None,
            nodeTemplates=[]
        )

        created_workflow = await WorkflowRepository.create(workflow_create)
        if environment_id:
            created_workflow.environmentId = environment_id
            created_workflow.updatedAt = datetime.now(UTC)
            await created_workflow.save()
        
        return {
            "message": "HAR file imported successfully",
            "workflowId": created_workflow.workflowId,
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importMode": import_mode
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"HAR import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import HAR file: {str(e)}"
        )


@router.post("/import/har/dry-run", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_har_dry_run(
    file: Optional[UploadFile] = File(None),
    import_mode: str = Query("linear"),
    sanitize: bool = Query(True)
):
    """
    Preview HAR import without persisting
    Returns proposed workflow structure
    """
    try:
        # Parse HAR data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="HAR file is required"
            )
        
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in HAR file: {str(e)}"
            )
        
        # Validate HAR structure
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key"
            )
        
        # Convert HAR to workflow (preview only)
        try:
            workflow_data = parse_har_to_workflow(har_data, import_mode, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Return preview
        return {
            "message": "HAR preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"])
            },
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importMode": import_mode,
                "entries": len(har_data.get("log", {}).get("entries", []))
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"HAR dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview HAR file: {str(e)}"
        )
    
    # Return preview
    entries = har_data.get("log", {}).get("entries", [])
    preview_entries = []
    
    for entry in entries[:10]:  # Show first 10 for preview
        request = entry.get("request", {})
        preview_entries.append({
            "method": request.get("method", ""),
            "url": request.get("url", ""),
            "time": entry.get("time", 0)
        })
    
    return {
        "valid": True,
        "workflow": workflow_data,
        "preview": preview_entries,
        "stats": {
            "totalEntries": len(entries),
            "nodes": len(workflow_data["nodes"]),
            "edges": len(workflow_data["edges"]),
            "importMode": import_mode
        }
    }


@router.post("/import/openapi", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_openapi_file(
    file: Optional[UploadFile] = File(None),
    base_url: str = Query(""),
    tag_filter: Optional[str] = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False)  # NEW: Just return nodes without creating workflow
):
    """
    Import an OpenAPI/Swagger file and convert to workflow
    Accepts file upload via multipart/form-data
    
    If parse_only=true, returns just the parsed nodes array without creating a workflow
    """
    try:
        # Parse OpenAPI data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OpenAPI file is required"
            )
        
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {str(e)}"
            )
        
        # Validate OpenAPI structure
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key"
            )
        
        # Parse tag filter
        tags = tag_filter.split(",") if tag_filter else None
        
        # Convert OpenAPI to workflow
        try:
            workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalEndpoints": len(http_nodes),
                    "apiTitle": openapi_data.get("info", {}).get("title", "API")
                }
            }
        
        # Otherwise, create full workflow in database using repository
        workflow_create = WorkflowCreate(
            name=workflow_data["name"],
            description=workflow_data["description"],
            nodes=workflow_data["nodes"],
            edges=workflow_data["edges"],
            variables=workflow_data.get("variables", {}),
            tags=workflow_data.get("tags", []),
            collectionId=None,
            nodeTemplates=[]
        )

        created_workflow = await WorkflowRepository.create(workflow_create)
        
        return {
            "message": "OpenAPI file imported successfully",
            "workflowId": created_workflow.workflowId,
            "stats": {
                "totalEndpoints": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "apiTitle": openapi_data.get("info", {}).get("title", "API")
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"OpenAPI import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI file: {str(e)}"
        )


def _extract_openapi_document(response: httpx.Response) -> Optional[Dict[str, Any]]:
    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError):
        data = None

    if isinstance(data, dict) and "paths" in data:
        return data

    content_type = (response.headers.get("content-type") or "").lower()
    body_text = response.text or ""
    should_try_yaml = (
        "yaml" in content_type
        or body_text.lstrip().startswith("openapi:")
        or body_text.lstrip().startswith("swagger:")
    )

    if not should_try_yaml:
        return None

    try:
        import yaml  # type: ignore
    except Exception:
        return None

    try:
        yaml_data = yaml.safe_load(body_text)
    except Exception:
        return None

    if isinstance(yaml_data, dict) and "paths" in yaml_data:
        return yaml_data

    return None


def _dedupe_definitions(definitions: List[Dict[str, str]]) -> List[Dict[str, str]]:
    deduped: List[Dict[str, str]] = []
    seen = set()

    for item in definitions:
        spec_url = (item.get("specUrl") or "").strip()
        if not spec_url or spec_url in seen:
            continue
        seen.add(spec_url)
        deduped.append(
            {
                "name": (item.get("name") or "").strip() or spec_url,
                "specUrl": spec_url,
                "source": (item.get("source") or "discovered").strip() or "discovered",
            }
        )

    return deduped


async def _discover_definitions_from_swagger_ui(
    client: httpx.AsyncClient,
    swagger_ui_url: str,
    html_text: str,
) -> Dict[str, Any]:
    query_hints = parse_swagger_ui_query_hints(swagger_ui_url)
    html_hints = extract_swagger_ui_hints_from_html(html_text)

    definitions: List[Dict[str, str]] = []

    # Explicit query-provided doc URL
    if query_hints.get("url"):
        definitions.append(
            {
                "name": query_hints.get("primaryName") or "Default",
                "specUrl": resolve_url(swagger_ui_url, query_hints["url"]),
                "source": "swagger-ui.query.url",
            }
        )

    # Inline HTML hints
    for entry in html_hints.get("urls") or []:
        definitions.append(
            {
                "name": (entry.get("name") or "").strip() or (entry.get("url") or "").strip(),
                "specUrl": resolve_url(swagger_ui_url, entry.get("url") or ""),
                "source": "swagger-ui.html.urls",
            }
        )

    if html_hints.get("url"):
        definitions.append(
            {
                "name": query_hints.get("primaryName") or "Default",
                "specUrl": resolve_url(swagger_ui_url, html_hints["url"]),
                "source": "swagger-ui.html.url",
            }
        )

    primary_name = query_hints.get("primaryName")
    config_candidates = build_swagger_config_candidates(swagger_ui_url, query_hints, html_hints)

    for candidate in config_candidates:
        try:
            response = await client.get(
                candidate,
                headers={
                    "Accept": "application/json, application/vnd.oai.openapi+json",
                },
            )
            response.raise_for_status()
            config_data = response.json()
            if not isinstance(config_data, dict):
                continue
            extracted = extract_definitions_from_swagger_config(config_data, str(response.url))
            if extracted.get("primaryName") and not primary_name:
                primary_name = extracted["primaryName"]
            definitions.extend(extracted.get("definitions") or [])
            if extracted.get("definitions"):
                break
        except Exception:
            continue

    deduped = _dedupe_definitions(definitions)
    return {
        "definitions": deduped,
        "primaryName": primary_name,
    }


@router.get("/import/openapi/url", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_openapi_from_url(
    swagger_url: str = Query(...),
    base_url: str = Query(""),
    tag_filter: Optional[str] = Query(None),
    sanitize: bool = Query(True)
):
    """
    Parse OpenAPI/Swagger JSON from a URL and return HTTP request nodes.
    """
    url = (swagger_url or "").strip()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="swagger_url is required"
        )

    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="swagger_url must start with http:// or https://"
        )

    try:
        tags = tag_filter.split(",") if tag_filter else None

        async with httpx.AsyncClient(timeout=DEFAULT_FETCH_TIMEOUT_SECONDS, follow_redirects=True) as client:
            initial_response = await client.get(
                url,
                headers={
                    "Accept": "application/json, application/vnd.oai.openapi+json, text/html",
                },
            )
            initial_response.raise_for_status()

            direct_spec = _extract_openapi_document(initial_response)

            discovered_definitions: List[Dict[str, str]] = []
            primary_name: Optional[str] = None

            if direct_spec:
                discovered_definitions = [
                    {
                        "name": direct_spec.get("info", {}).get("title") or "Default",
                        "specUrl": url,
                        "source": "direct-url",
                    }
                ]
            else:
                discovery = await _discover_definitions_from_swagger_ui(
                    client,
                    swagger_ui_url=url,
                    html_text=initial_response.text,
                )
                discovered_definitions = discovery.get("definitions") or []
                primary_name = discovery.get("primaryName")

                if not discovered_definitions:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            "Could not discover OpenAPI definitions from Swagger UI URL. "
                            "Use a direct OpenAPI spec URL or verify Swagger UI config exposure."
                        ),
                    )

            definition_limit_error = validate_definition_limit(len(discovered_definitions))
            if definition_limit_error:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=definition_limit_error,
                )

            successful_specs: List[Dict[str, Any]] = []
            failed_definitions: List[Dict[str, str]] = []

            async def fetch_definition(definition: Dict[str, str]) -> Dict[str, Any]:
                definition_name = definition.get("name") or "Definition"
                spec_url = definition.get("specUrl") or ""
                if not spec_url:
                    return {
                        "status": "failed",
                        "name": definition_name,
                        "specUrl": spec_url,
                        "error": "Missing spec URL",
                    }

                if direct_spec and spec_url == url:
                    return {
                        "status": "imported",
                        "definition": definition,
                        "openapi_data": direct_spec,
                    }

                try:
                    spec_response = await client.get(
                        spec_url,
                        headers={
                            "Accept": "application/json, application/vnd.oai.openapi+json",
                        },
                    )
                    spec_response.raise_for_status()
                    openapi_data = _extract_openapi_document(spec_response)
                    if not openapi_data:
                        raise ValueError("Definition URL did not return a valid OpenAPI JSON document")

                    return {
                        "status": "imported",
                        "definition": definition,
                        "openapi_data": openapi_data,
                    }
                except Exception as exc:
                    return {
                        "status": "failed",
                        "name": definition_name,
                        "specUrl": spec_url,
                        "error": str(exc),
                    }

            semaphore = asyncio.Semaphore(DEFAULT_FETCH_CONCURRENCY)

            async def fetch_with_limit(definition: Dict[str, str]) -> Dict[str, Any]:
                async with semaphore:
                    return await fetch_definition(definition)

            fetch_results = await asyncio.gather(
                *(fetch_with_limit(definition) for definition in discovered_definitions)
            )

            for result in fetch_results:
                if result.get("status") == "imported":
                    successful_specs.append(
                        {
                            "definition": result["definition"],
                            "openapi_data": result["openapi_data"],
                        }
                    )
                else:
                    failed_definitions.append(
                        {
                            "name": result["name"],
                            "specUrl": result["specUrl"],
                            "error": result["error"],
                        }
                    )

        if not successful_specs:
            first_error = failed_definitions[0]["error"] if failed_definitions else "Unknown fetch error"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to fetch any OpenAPI definitions: {first_error}",
            )

        total_discovered = len(discovered_definitions)
        total_imported = len(successful_specs)
        is_multi_definition = total_discovered > 1

        all_http_nodes: List[Dict[str, Any]] = []
        definition_summaries: List[Dict[str, Any]] = []

        for bundle in successful_specs:
            definition = bundle["definition"]
            definition_name = definition.get("name") or "Definition"
            definition_spec_url = definition.get("specUrl") or ""
            definition_scope = make_definition_scope(definition_name, definition_spec_url)

            workflow_data = parse_openapi_to_workflow(
                bundle["openapi_data"],
                base_url,
                tags,
                sanitize,
                source_context={
                    "definitionName": definition_name,
                    "definitionSpecUrl": definition_spec_url,
                    "definitionScope": definition_scope,
                    "sourceUiUrl": url,
                },
            )
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]

            if is_multi_definition:
                for node in http_nodes:
                    label = node.get("label") or node.get("config", {}).get("url") or "Request"
                    node["label"] = f"[{definition_name}] {label}"

            all_http_nodes.extend(http_nodes)

            endpoint_limit_error = validate_endpoint_limit(len(all_http_nodes))
            if endpoint_limit_error:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=endpoint_limit_error,
                )

            definition_summaries.append(
                {
                    "name": definition_name,
                    "specUrl": definition_spec_url,
                    "status": "imported",
                    "endpointCount": len(http_nodes),
                    "source": definition.get("source") or "discovered",
                }
            )

        for failed in failed_definitions:
            definition_summaries.append(
                {
                    "name": failed["name"],
                    "specUrl": failed["specUrl"],
                    "status": "failed",
                    "endpointCount": 0,
                    "error": failed["error"],
                }
            )

        api_title = "Multiple APIs" if total_imported > 1 else (
            successful_specs[0]["openapi_data"].get("info", {}).get("title", "API")
        )

        return {
            "nodes": all_http_nodes,
            "definitions": definition_summaries,
            "stats": {
                "totalEndpoints": len(all_http_nodes),
                "apiTitle": api_title,
                "sourceUrl": url,
                "definitionCount": total_discovered,
                "importedDefinitionCount": total_imported,
                "failedDefinitionCount": len(failed_definitions),
                "primaryName": primary_name,
            },
            "warnings": [
                {
                    "type": "definition-fetch-failed",
                    "name": item["name"],
                    "specUrl": item["specUrl"],
                    "message": item["error"],
                }
                for item in failed_definitions
            ],
        }

    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch Swagger URL ({e.response.status_code})"
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch Swagger URL: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI from URL: {str(e)}"
        )


@router.post("/import/openapi/dry-run", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_openapi_dry_run(
    file: Optional[UploadFile] = File(None),
    base_url: str = Query(""),
    tag_filter: Optional[str] = Query(None),
    sanitize: bool = Query(True)
):
    """
    Preview OpenAPI import without persisting
    Returns proposed workflow structure
    """
    try:
        # Parse OpenAPI data
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="OpenAPI file is required"
            )
        
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode('utf-8'))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {str(e)}"
            )
        
        # Validate OpenAPI structure
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key"
            )
        
        # Parse tag filter
        tags = tag_filter.split(",") if tag_filter else None
        
        # Get available tags from spec
        available_tags = []
        spec_tags = openapi_data.get("tags", [])
        for tag in spec_tags:
            available_tags.append({
                "name": tag.get("name", ""),
                "description": tag.get("description", "")
            })
        
        # Get available servers
        available_servers = []
        for server in openapi_data.get("servers", []):
            available_servers.append({
                "url": server.get("url", ""),
                "description": server.get("description", "")
            })
        
        # Convert OpenAPI to workflow (preview only)
        try:
            workflow_data = parse_openapi_to_workflow(openapi_data, base_url, tags, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Return preview
        return {
            "message": "OpenAPI preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"])
            },
            "stats": {
                "totalEndpoints": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "apiTitle": openapi_data.get("info", {}).get("title", "API"),
                "apiVersion": openapi_data.get("info", {}).get("version", "")
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"],
            "availableTags": available_tags,
            "availableServers": available_servers
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"OpenAPI dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview OpenAPI file: {str(e)}"
        )


@router.post("/import/curl/dry-run", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_curl_dry_run(
    sanitize: bool = Query(True),
    curl_command: Optional[str] = Query(None)
):
    """
    Preview curl command(s) import without persisting
    Returns proposed workflow structure
    Accepts curl command via query parameter or request body
    """
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="curl command is required"
            )
        
        # Convert curl to workflow (preview only)
        try:
            workflow_data = parse_curl_to_workflow(curl_command, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        
        # Return preview
        return {
            "message": "Curl preview generated successfully",
            "workflow": {
                "name": workflow_data["name"],
                "description": workflow_data["description"],
                "nodeCount": len(workflow_data["nodes"]),
                "edgeCount": len(workflow_data["edges"])
            },
            "stats": {
                "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                "importType": "curl"
            },
            "nodes": workflow_data["nodes"],
            "edges": workflow_data["edges"]
        }
    
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Curl dry-run error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview curl command: {str(e)}"
        )



@router.put("/{workflow_id}/collection", dependencies=[require_permission(WORKFLOWS_UPDATE)])
async def attach_workflow_to_collection(workflow_id: str, collection_id: Optional[str] = Query(None)):
    """Attach or detach a workflow to/from a collection"""
    try:
        return await svc_attach_to_collection(workflow_id, collection_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/by-collection/{collection_id}", dependencies=[require_permission(WORKFLOWS_READ)])
async def list_workflows_by_collection(collection_id: str):
    """Get all workflows attached to a collection"""
    try:
        return await svc_list_by_collection(collection_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))



@router.post("/bulk-attach-collection", dependencies=[require_permission(WORKFLOWS_UPDATE)])
async def bulk_attach_workflows(
    workflow_ids: List[str] = Query(...),
    collection_id: Optional[str] = Query(None)
):
    """Attach multiple workflows to a collection (SQL injection safe)."""
    # Verify all workflows exist using repository
    for wid in workflow_ids:
        workflow = await WorkflowRepository.get_by_id(wid)
        if not workflow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Workflow {wid} not found"
            )
    
    # If attaching, verify collection exists using repository
    if collection_id:
        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Collection {collection_id} not found"
            )
    
    # Update all workflows using repository
    for wid in workflow_ids:
        await WorkflowRepository.update_collection_assignment(wid, collection_id)
    
    return {
        "message": f"Updated {len(workflow_ids)} workflows",
        "count": len(workflow_ids),
        "collectionId": collection_id
    }


# Node Templates Management Endpoints

@router.get("/{workflow_id}/templates", dependencies=[require_permission(WORKFLOWS_READ)])
async def get_workflow_templates(workflow_id: str):
    """Get all node templates for a workflow (SQL injection safe)"""
    # Use repository for type-safe query
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    return {
        "workflowId": workflow_id,
        "templates": workflow.nodeTemplates
    }


@router.post("/{workflow_id}/templates", dependencies=[require_permission(WORKFLOWS_UPDATE)])
async def add_workflow_templates(
    workflow_id: str,
    templates: List[Dict[str, Any]]
):
    """Add node templates to a workflow (appends to existing templates - SQL injection safe)"""
    # Get workflow using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Get existing templates
    existing_templates = workflow.nodeTemplates if workflow.nodeTemplates else []
    
    # Append new templates
    updated_templates = existing_templates + templates
    
    # Update workflow using Beanie
    workflow.nodeTemplates = updated_templates
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    
    return {
        "message": f"Added {len(templates)} template(s) to workflow",
        "workflowId": workflow_id,
        "totalTemplates": len(updated_templates)
    }


@router.put("/{workflow_id}/templates", dependencies=[require_permission(WORKFLOWS_UPDATE)])
async def replace_workflow_templates(
    workflow_id: str,
    templates: List[Dict[str, Any]]
):
    """Replace all node templates for a workflow (SQL injection safe)"""
    # Get workflow using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Replace templates using Beanie
    workflow.nodeTemplates = templates
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    
    return {
        "message": "Templates replaced successfully",
        "workflowId": workflow_id,
        "totalTemplates": len(templates)
    }


@router.delete("/{workflow_id}/templates", dependencies=[require_permission(WORKFLOWS_UPDATE)])
async def clear_workflow_templates(workflow_id: str):
    """Clear all node templates for a workflow (SQL injection safe)"""
    # Get workflow using repository
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Workflow {workflow_id} not found"
        )
    
    # Clear templates using Beanie
    workflow.nodeTemplates = []
    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    
    return {
        "message": "Templates cleared successfully",
        "workflowId": workflow_id
    }


@router.post("/import/curl", dependencies=[require_permission(WORKFLOWS_IMPORT)])
async def import_curl_file(
    sanitize: bool = Query(True),
    curl_command: Optional[str] = Query(None),
    workflowId: Optional[str] = Query(None),
    parse_only: bool = Query(False)  # NEW: Just return nodes without creating workflow
):
    """
    Import curl command(s) and convert to workflow.
    
    If parse_only=true, returns just the parsed nodes array without creating/updating a workflow.
    If workflowId is provided, append to that workflow. Otherwise, create new workflow.
    """
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="curl command is required"
            )
        # Convert curl to workflow nodes/edges
        try:
            workflow_data = parse_curl_to_workflow(curl_command, sanitize)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

        # If parse_only mode, return just the HTTP request nodes (exclude start/end)
        if parse_only:
            http_nodes = [n for n in workflow_data["nodes"] if n["type"] == "http-request"]
            return {
                "nodes": http_nodes,
                "stats": {
                    "totalRequests": len(http_nodes),
                    "importType": "curl"
                }
            }

        if workflowId:
            # Append to existing workflow using repository
            existing = await WorkflowRepository.get_by_id(workflowId)
            if not existing:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Workflow {workflowId} not found"
                )
            # Remove start/end nodes from imported data
            imported_nodes = [n for n in workflow_data["nodes"] if n["type"] != "start" and n["type"] != "end"]
            imported_edges = [e for e in workflow_data["edges"]]
            # Re-ID nodes/edges to avoid collisions
            node_id_map = {}
            for node in imported_nodes:
                old_id = node["nodeId"]
                new_id = str(uuid.uuid4())
                node_id_map[old_id] = new_id
                node["nodeId"] = new_id
            for edge in imported_edges:
                if edge["source"] in node_id_map:
                    edge["source"] = node_id_map[edge["source"]]
                if edge["target"] in node_id_map:
                    edge["target"] = node_id_map[edge["target"]]
                edge["edgeId"] = str(uuid.uuid4())

            # --- Offset imported nodes to avoid overlap ---
            # Find max X and Y of existing nodes
            existing_positions = [n.position for n in existing.nodes if n.position and len(n.position) > 0]
            if existing_positions:
                max_x = max(pos.get("x", 0) for pos in existing_positions)
                max_y = max(pos.get("y", 0) for pos in existing_positions)
            else:
                max_x = 0
                max_y = 0
            # Offset imported nodes: position them to the right of the rightmost node
            # Add some padding (e.g., 100px) to avoid overlap
            x_offset = max_x + 100 if existing_positions else 600
            # Keep them roughly at the same Y level
            y_offset = 0
            for node in imported_nodes:
                if "position" in node and isinstance(node["position"], dict):
                    node["position"]["x"] = node["position"].get("x", 0) + x_offset
                    node["position"]["y"] = node["position"].get("y", 0) + y_offset

            # Append nodes/edges - convert to model format first
            # Convert Beanie Document nodes to dicts for manipulation
            existing_nodes_dicts = [n.model_dump() if hasattr(n, 'model_dump') else n for n in existing.nodes]
            existing_edges_dicts = [e.model_dump() if hasattr(e, 'model_dump') else e for e in existing.edges]
            
            updated_nodes_dicts = existing_nodes_dicts + imported_nodes
            updated_edges_dicts = existing_edges_dicts + imported_edges
            
            # Update workflow using repository update method
            await WorkflowRepository.update(
                workflowId,
                WorkflowUpdate(nodes=updated_nodes_dicts, edges=updated_edges_dicts)
            )
            
            return {
                "message": f"Curl commands imported and appended to workflow {workflowId}",
                "workflowId": workflowId,
                "stats": {
                    "totalRequests": len(imported_nodes),
                    "importType": "curl"
                }
            }
        else:
            # Create new workflow as before using repository
            workflow_create = WorkflowCreate(
                name=workflow_data["name"],
                description=workflow_data["description"],
                nodes=workflow_data["nodes"],
                edges=workflow_data["edges"],
                variables=workflow_data.get("variables", {}),
                tags=workflow_data.get("tags", []),
                collectionId=None,
                nodeTemplates=[]
            )
            created_workflow = await WorkflowRepository.create(workflow_create)
            return {
                "message": "Curl commands imported successfully",
                "workflowId": created_workflow.workflowId,
                "stats": {
                    "totalRequests": len(workflow_data["nodes"]) - 2,  # Exclude start/end nodes
                    "importType": "curl"
                }
            }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Curl import error: {str(e)}")
        print(traceback.format_exc())
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import curl command: {str(e)}"
        )

