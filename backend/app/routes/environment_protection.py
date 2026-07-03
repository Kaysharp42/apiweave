"""
Environment Protection API routes.

Endpoints for reviewer approval and trusted-token bypass of protected environments.
"""

from __future__ import annotations

import hashlib
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.auth.dependencies import get_current_active_user
from app.models import (
    ApprovalActionRequest,
    BypassActionRequest,
    PendingApprovalResponse,
    User,
)
from app.repositories.service_token_repository import ServiceTokenRepository
from app.services import environment_protection_service as svc
from app.services import run_service
from app.services.environment_protection_service import (
    ApprovalNotFoundError,
    ApprovalNotPendingError,
    BypassNotAllowedError,
    SelfApprovalDeniedError,
)
from app.services.exceptions import ConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["environment-protection"])


def _handle_service_error(exc: Exception):
    if isinstance(exc, SelfApprovalDeniedError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
            headers={"X-Error-Code": "self_approval_denied"},
        )
    if isinstance(exc, BypassNotAllowedError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
            headers={"X-Error-Code": "bypass_not_allowed"},
        )
    if isinstance(exc, ApprovalNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    if isinstance(exc, ApprovalNotPendingError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
            headers={"X-Error-Code": "approval_not_pending"},
        )
    if isinstance(exc, ResourceNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    if isinstance(exc, ConflictError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    raise exc


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


async def _resolve_service_token(authorization: str | None) -> tuple[str, str]:
    """Resolve a Bearer token to (tokenId, tokenName). Raises 401/403."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required for bypass",
        )
    raw_token = authorization[len("Bearer ") :]
    token_hash = _hash_token(raw_token)
    token = await ServiceTokenRepository.get_by_hash(token_hash)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token",
        )
    if token.revokedAt is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Service token has been revoked",
        )
    return token.tokenId, token.name


# ======================================================================
# Reviewer Approval (user session)
# ======================================================================


@router.post(
    "/api/workspaces/{workspace_id}/environments/{environment_id}"
    "/approvals/{approval_id}/approve",
    response_model=PendingApprovalResponse,
)
async def approve_pending_run(
    workspace_id: str,
    environment_id: str,
    approval_id: str,
    _body: ApprovalActionRequest | None = None,
    user: User = Depends(get_current_active_user),
) -> PendingApprovalResponse:
    """Approve a pending run as a required reviewer.

    The authenticated user must be in the environment's requiredReviewers list.
    Self-approval is governed by the environment's allowSelfApproval setting.
    """
    try:
        approval = await svc.get_pending_approval(approval_id)
        if approval.workspaceId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found in workspace {workspace_id}",
            )
        if approval.environmentId != environment_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found for environment {environment_id}",
            )
        result = await svc.approve_run(approval_id, user.userId)
        # Resume-on-approval: start the held run now that the gate has cleared.
        await run_service.resume_approved_run(approval.runId)
        return PendingApprovalResponse.model_validate(result)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise  # unreachable


@router.post(
    "/api/workspaces/{workspace_id}/environments/{environment_id}"
    "/approvals/{approval_id}/reject",
    response_model=PendingApprovalResponse,
)
async def reject_pending_run(
    workspace_id: str,
    environment_id: str,
    approval_id: str,
    _body: ApprovalActionRequest | None = None,
    user: User = Depends(get_current_active_user),
) -> PendingApprovalResponse:
    """Reject a pending run as a required reviewer; the held run is cancelled."""
    try:
        approval = await svc.get_pending_approval(approval_id)
        if approval.workspaceId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found in workspace {workspace_id}",
            )
        if approval.environmentId != environment_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found for environment {environment_id}",
            )
        result = await svc.reject_run(approval_id, user.userId)
        # Cancel-on-reject: the held run never executes.
        await run_service.cancel_pending_run(approval.runId)
        return PendingApprovalResponse.model_validate(result)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise  # unreachable


# ======================================================================
# Trusted-Token Bypass (service token)
# ======================================================================


@router.post(
    "/api/workspaces/{workspace_id}/environments/{environment_id}"
    "/approvals/{approval_id}/bypass",
    response_model=PendingApprovalResponse,
)
async def bypass_protection(
    workspace_id: str,
    environment_id: str,
    approval_id: str,
    body: BypassActionRequest,
    authorization: str | None = Header(None),
) -> PendingApprovalResponse:
    """Bypass environment protection using a trusted service token.

    The service token must:
    - Be passed via Authorization: Bearer <token>
    - Be in the environment's bypassAllowlist
    - The environment's bypassPolicy must be "trusted_token_only"
    - A non-empty reason must be provided in the request body

    The bypass is audited with the token ID, reason, and run context.
    """
    try:
        token_id, _token_name = await _resolve_service_token(authorization)

        approval = await svc.get_pending_approval(approval_id)
        if approval.workspaceId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found in workspace {workspace_id}",
            )
        if approval.environmentId != environment_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found for environment {environment_id}",
            )

        result = await svc.bypass_protection(approval_id, token_id, body.reason)
        # Bypass clears the gate — start the held run.
        await run_service.resume_approved_run(approval.runId)
        return PendingApprovalResponse.model_validate(result)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise  # unreachable


# ======================================================================
# Pending Approval Queries
# ======================================================================


@router.get(
    "/api/workspaces/{workspace_id}/environments/{environment_id}/pending-approvals",
    response_model=list[PendingApprovalResponse],
)
async def list_pending_approvals_for_environment(
    workspace_id: str,
    environment_id: str,
    _user: User = Depends(get_current_active_user),
) -> list[PendingApprovalResponse]:
    """List all pending approvals for a workspace environment."""
    return await svc.list_pending_for_environment(environment_id)


@router.get(
    "/api/workspaces/{workspace_id}/pending-approvals",
    response_model=list[PendingApprovalResponse],
)
async def list_pending_approvals_for_workspace(
    workspace_id: str,
    _user: User = Depends(get_current_active_user),
) -> list[PendingApprovalResponse]:
    """List all pending approvals across a workspace."""
    return await svc.list_pending_for_workspace(workspace_id)


@router.get(
    "/api/workspaces/{workspace_id}/environments/{environment_id}" "/approvals/{approval_id}",
    response_model=PendingApprovalResponse,
)
async def get_pending_approval(
    workspace_id: str,
    environment_id: str,
    approval_id: str,
    _user: User = Depends(get_current_active_user),
) -> PendingApprovalResponse:
    """Get a specific pending approval record."""
    try:
        approval = await svc.get_pending_approval(approval_id)
        if approval.workspaceId != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found in workspace {workspace_id}",
            )
        if approval.environmentId != environment_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Approval {approval_id} not found for environment {environment_id}",
            )
        return PendingApprovalResponse.model_validate(approval)
    except HTTPException:
        raise
    except Exception as exc:
        _handle_service_error(exc)
        raise  # unreachable
