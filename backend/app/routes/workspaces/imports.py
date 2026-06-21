"""Workflow import endpoints (JSON, HAR, OpenAPI, curl) scoped to workspaces."""

import json
import logging
from typing import Any

import httpx
from fastapi import Depends, File, HTTPException, Query, UploadFile, status

from app.auth.dependencies import get_current_active_user
from app.models import User
from app.services import scoped_workflow_service
from app.services.exceptions import ResourceNotFoundError
from app.services.safe_http import SafeUrlError, validate_url

from ._router import router

logger = logging.getLogger(__name__)


# ============================================================================
# Import (scoped)
# ============================================================================


@router.post(
    "/{workspace_id}/workflows/import",
    response_model=dict[str, Any],
)
async def import_workflow(
    workspace_id: str,
    bundle: dict[str, Any],
    environment_mapping: dict[str, str] | None = None,
    create_missing_environments: bool = True,
    sanitize: bool = False,
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        return await scoped_workflow_service.import_scoped_workflow(
            workspace_id,
            bundle,
            current_user.userId,
            environment_mapping=environment_mapping,
            create_missing_environments=create_missing_environments,
            sanitize=sanitize,
        )
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/{workspace_id}/workflows/import/dry-run",
    response_model=dict[str, Any],
)
async def import_workflow_dry_run(
    workspace_id: str,
    bundle: dict[str, Any],
) -> dict[str, Any]:
    return await scoped_workflow_service.import_scoped_workflow_dry_run(bundle)


@router.post(
    "/{workspace_id}/workflows/import/har",
    response_model=dict[str, Any],
)
async def import_har(
    workspace_id: str,
    file: UploadFile | None = File(None),
    import_mode: str = Query("linear"),
    environment_id: str | None = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="HAR file is required"
            )
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON in HAR file: {e!s}"
            )
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key",
            )
        return await scoped_workflow_service.import_scoped_har(
            workspace_id,
            har_data,
            current_user.userId,
            import_mode=import_mode,
            sanitize=sanitize,
            parse_only=parse_only,
            environment_id=environment_id,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("HAR import error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import HAR file: {e!s}",
        )


@router.post(
    "/{workspace_id}/workflows/import/har/dry-run",
    response_model=dict[str, Any],
)
async def import_har_dry_run(
    workspace_id: str,
    file: UploadFile | None = File(None),
    import_mode: str = Query("linear"),
    sanitize: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="HAR file is required"
            )
        contents = await file.read()
        try:
            har_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid JSON in HAR file: {e!s}"
            )
        if "log" not in har_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid HAR file: missing 'log' key",
            )
        return await scoped_workflow_service.import_scoped_har_dry_run(
            workspace_id,
            har_data,
            current_user.userId,
            import_mode=import_mode,
            sanitize=sanitize,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("HAR dry-run error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview HAR file: {e!s}",
        )


@router.post(
    "/{workspace_id}/workflows/import/openapi",
    response_model=dict[str, Any],
)
async def import_openapi(
    workspace_id: str,
    file: UploadFile | None = File(None),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    parse_only: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="OpenAPI file is required"
            )
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {e!s}",
            )
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key",
            )
        return await scoped_workflow_service.import_scoped_openapi(
            workspace_id,
            openapi_data,
            current_user.userId,
            base_url=base_url,
            tag_filter=tag_filter,
            sanitize=sanitize,
            parse_only=parse_only,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("OpenAPI import error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI file: {e!s}",
        )


@router.get(
    "/{workspace_id}/workflows/import/openapi/url",
    response_model=dict[str, Any],
)
async def import_openapi_from_url(
    workspace_id: str,
    swagger_url: str = Query(...),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    url = (swagger_url or "").strip()
    if not url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="swagger_url is required",
        )
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="swagger_url must start with http:// or https://",
        )
    try:
        validate_url(url)
    except SafeUrlError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"URL blocked by safety policy: {exc}",
        )

    try:
        from app.routes.workspaces import _get_verified_workspace

        await _get_verified_workspace(workspace_id, current_user.userId)
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    try:
        tags = tag_filter.split(",") if tag_filter else None
        from app.services.import_service import fetch_openapi_from_url

        result = await fetch_openapi_from_url(
            url=url,
            base_url=base_url,
            tag_filter=tags,
            sanitize=sanitize,
        )
        definitions = [
            {
                "name": item.get("name"),
                "specUrl": item.get("spec_url"),
                "status": item.get("status"),
                "endpointCount": item.get("endpoint_count"),
                "source": item.get("source"),
                **({"error": item["error"]} if item.get("error") else {}),
            }
            for item in result.get("definitions", [])
        ]
        return {
            "nodes": result.get("nodes", []),
            "definitions": definitions,
            "stats": {
                "totalEndpoints": result.get("total_endpoints", 0),
                "apiTitle": result.get("api_title", "API"),
                "sourceUrl": result.get("source_url", url),
                "definitionCount": len(definitions),
                "importedDefinitionCount": sum(
                    1 for item in definitions if item.get("status") == "imported"
                ),
                "failedDefinitionCount": sum(
                    1 for item in definitions if item.get("status") == "failed"
                ),
                "primaryName": None,
            },
            "warnings": result.get("warnings", []),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch Swagger URL ({e.response.status_code})",
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch Swagger URL: {e!s}",
        )
    except Exception as e:
        logger.exception("OpenAPI URL import error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import OpenAPI from URL: {e!s}",
        )


@router.post(
    "/{workspace_id}/workflows/import/openapi/dry-run",
    response_model=dict[str, Any],
)
async def import_openapi_dry_run(
    workspace_id: str,
    file: UploadFile | None = File(None),
    base_url: str = Query(""),
    tag_filter: str | None = Query(None),
    sanitize: bool = Query(True),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="OpenAPI file is required"
            )
        contents = await file.read()
        try:
            openapi_data = json.loads(contents.decode("utf-8"))
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON in OpenAPI file: {e!s}",
            )
        if "paths" not in openapi_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OpenAPI file: missing 'paths' key",
            )
        return await scoped_workflow_service.import_scoped_openapi_dry_run(
            workspace_id,
            openapi_data,
            current_user.userId,
            base_url=base_url,
            tag_filter=tag_filter,
            sanitize=sanitize,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("OpenAPI dry-run error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview OpenAPI file: {e!s}",
        )


@router.post(
    "/{workspace_id}/workflows/import/curl",
    response_model=dict[str, Any],
)
async def import_curl(
    workspace_id: str,
    sanitize: bool = Query(True),
    curl_command: str | None = Query(None),
    workflowId: str | None = Query(None),
    parse_only: bool = Query(False),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="curl command is required"
            )
        return await scoped_workflow_service.import_scoped_curl(
            workspace_id,
            curl_command,
            current_user.userId,
            sanitize=sanitize,
            workflow_id=workflowId,
            parse_only=parse_only,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Curl import error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to import curl command: {e!s}",
        )


@router.post(
    "/{workspace_id}/workflows/import/curl/dry-run",
    response_model=dict[str, Any],
)
async def import_curl_dry_run(
    workspace_id: str,
    sanitize: bool = Query(True),
    curl_command: str | None = Query(None),
    current_user: User = Depends(get_current_active_user),
) -> dict[str, Any]:
    try:
        if not curl_command:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="curl command is required"
            )
        return await scoped_workflow_service.import_scoped_curl_dry_run(
            workspace_id,
            curl_command,
            current_user.userId,
            sanitize=sanitize,
        )
    except HTTPException:
        raise
    except ResourceNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception("Curl dry-run error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview curl command: {e!s}",
        )
