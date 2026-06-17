"""
Environment Protection Service — approval and bypass logic for protected environments.

Handles:
- Run gating: check if a run needs approval before execution
- Reviewer approval: validate approver identity and self-approval policy
- Trusted-token bypass: validate token allowlist and audit the bypass
- Pending approval queries
"""
from __future__ import annotations

import logging
import uuid

from app.models import (
    PendingApprovalResponse,
    PendingRunApproval,
)
from app.repositories.pending_approval_repository import PendingApprovalRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.repositories.service_token_repository import ServiceTokenRepository
from app.services import audit_service
from app.services.exceptions import ConflictError, ResourceNotFoundError

logger = logging.getLogger(__name__)


class SelfApprovalDeniedError(ConflictError):
    """Raised when a user attempts to approve their own run but self-approval is disabled."""


class BypassNotAllowedError(ConflictError):
    """Raised when a bypass is attempted but the token is not in the allowlist."""


class ApprovalNotFoundError(ResourceNotFoundError):
    """Raised when a pending approval record does not exist."""


class ApprovalNotPendingError(ConflictError):
    """Raised when an approval has already been resolved."""


# ======================================================================
# Run Gating
# ======================================================================


async def check_protection_and_maybe_gate(
    run_id: str,
    environment_id: str,
    workspace_id: str,
    actor_type: str,
    actor_id: str,
    requested_by_user_id: str | None = None,
) -> tuple[str, PendingRunApproval | None]:
    """Check if a run needs environment protection approval.

    Returns:
        ("proceed", None) if the environment is unprotected or no gate applies.
        ("pending_approval", approval_record) if the run is gated.
    """
    protection = await ScopedEnvironmentRepository.get_protection(environment_id)
    if not protection:
        return ("proceed", None)

    if not protection.requiredReviewers and protection.bypassPolicy == "none":
        return ("proceed", None)

    approval_id = f"appr-{uuid.uuid4().hex[:12]}"
    record = await PendingApprovalRepository.create(
        approval_id=approval_id,
        run_id=run_id,
        environment_id=environment_id,
        workspace_id=workspace_id,
        actor_type=actor_type,
        actor_id=actor_id,
        requested_by_user_id=requested_by_user_id,
    )

    await audit_service.append_event(
        actor=actor_type,  # type: ignore[arg-type]
        actor_id=actor_id,
        action="run_approval_requested",
        scope="environment",
        scope_id=environment_id,
        resource_type="run",
        resource_id=run_id,
        context={
            "approvalId": approval_id,
            "workspaceId": workspace_id,
            "requiredReviewers": protection.requiredReviewers,
            "bypassPolicy": protection.bypassPolicy,
        },
    )

    return ("pending_approval", record)


# ======================================================================
# Reviewer Approval
# ======================================================================


async def approve_run(
    approval_id: str,
    approver_user_id: str,
) -> PendingRunApproval:
    """Approve a pending run as a qualified reviewer.

    Validates:
    - Approval exists and is pending
    - Approver is in the required reviewers list
    - Self-approval policy is respected
    """
    approval = await PendingApprovalRepository.get_by_id(approval_id)
    if not approval:
        raise ApprovalNotFoundError(f"Approval {approval_id} not found")

    if approval.status != "pending":
        raise ApprovalNotPendingError(
            f"Approval {approval_id} is already {approval.status}"
        )

    protection = await ScopedEnvironmentRepository.get_protection(
        approval.environmentId
    )
    if not protection:
        raise ApprovalNotFoundError(
            f"No protection config for environment {approval.environmentId}"
        )

    if approver_user_id not in protection.requiredReviewers:
        raise ConflictError(
            f"User {approver_user_id} is not a required reviewer for "
            f"environment {approval.environmentId}"
        )

    if not protection.allowSelfApproval:
        requester = approval.requestedByUserId or approval.requestedByActorId
        if approver_user_id == requester:
            raise SelfApprovalDeniedError(
                "Self-approval is disabled for this environment. "
                "A different reviewer must approve this run."
            )

    updated = await PendingApprovalRepository.approve(
        approval_id=approval_id,
        resolved_by=approver_user_id,
        resolved_by_actor_type="user",
    )
    if not updated:
        raise ResourceNotFoundError(f"Failed to update approval {approval_id}")

    await audit_service.append_event(
        actor="user",
        actor_id=approver_user_id,
        action="run_approved",
        scope="environment",
        scope_id=approval.environmentId,
        resource_type="run",
        resource_id=approval.runId,
        context={
            "approvalId": approval_id,
            "workspaceId": approval.workspaceId,
        },
    )

    logger.info(
        "Run %s approved by %s for environment %s",
        approval.runId,
        approver_user_id,
        approval.environmentId,
    )
    return updated


# ======================================================================
# Trusted-Token Bypass
# ======================================================================


async def bypass_protection(
    approval_id: str,
    token_id: str,
    reason: str,
) -> PendingRunApproval:
    """Bypass environment protection using a trusted service token.

    Validates:
    - Approval exists and is pending
    - Bypass policy is "trusted_token_only"
    - Token is in the bypass allowlist
    - Reason is non-empty
    - Audit event is created (fail-closed)
    """
    if not reason or not reason.strip():
        raise ConflictError("Bypass reason is required")

    approval = await PendingApprovalRepository.get_by_id(approval_id)
    if not approval:
        raise ApprovalNotFoundError(f"Approval {approval_id} not found")

    if approval.status != "pending":
        raise ApprovalNotPendingError(
            f"Approval {approval_id} is already {approval.status}"
        )

    protection = await ScopedEnvironmentRepository.get_protection(
        approval.environmentId
    )
    if not protection:
        raise ApprovalNotFoundError(
            f"No protection config for environment {approval.environmentId}"
        )

    if protection.bypassPolicy != "trusted_token_only":
        raise BypassNotAllowedError(
            f"Bypass policy for environment {approval.environmentId} is "
            f"'{protection.bypassPolicy}', not 'trusted_token_only'"
        )

    if token_id not in protection.bypassAllowlist:
        raise BypassNotAllowedError(
            f"Service token {token_id} is not in the bypass allowlist for "
            f"environment {approval.environmentId}"
        )

    token = await ServiceTokenRepository.get_by_id(token_id)
    if not token:
        raise ResourceNotFoundError(f"Service token {token_id} not found")
    if token.revokedAt is not None:
        raise BypassNotAllowedError(
            f"Service token {token_id} has been revoked"
        )

    updated = await PendingApprovalRepository.bypass(
        approval_id=approval_id,
        resolved_by=token_id,
        resolved_by_actor_type="service_token",
        reason=reason.strip(),
    )
    if not updated:
        raise ResourceNotFoundError(f"Failed to update approval {approval_id}")

    await audit_service.append_event(
        actor="service_token",
        actor_id=token_id,
        action="protection_bypassed",
        scope="environment",
        scope_id=approval.environmentId,
        resource_type="run",
        resource_id=approval.runId,
        context={
            "approvalId": approval_id,
            "workspaceId": approval.workspaceId,
            "reason": reason.strip(),
            "tokenName": token.name,
        },
    )

    logger.info(
        "Protection bypassed for run %s by token %s (env %s): %s",
        approval.runId,
        token_id,
        approval.environmentId,
        reason.strip(),
    )
    return updated


# ======================================================================
# Queries
# ======================================================================


async def get_pending_approval(approval_id: str) -> PendingRunApproval:
    """Get a pending approval by ID."""
    record = await PendingApprovalRepository.get_by_id(approval_id)
    if not record:
        raise ApprovalNotFoundError(f"Approval {approval_id} not found")
    return record


async def get_pending_approval_by_run(run_id: str) -> PendingRunApproval | None:
    """Get the pending approval for a run, if any."""
    return await PendingApprovalRepository.get_by_run_id(run_id)


async def list_pending_for_environment(
    environment_id: str,
) -> list[PendingApprovalResponse]:
    """List all pending approvals for an environment."""
    records = await PendingApprovalRepository.list_pending_by_environment(
        environment_id
    )
    return [PendingApprovalResponse.model_validate(r) for r in records]


async def list_pending_for_workspace(
    workspace_id: str,
) -> list[PendingApprovalResponse]:
    """List all pending approvals for a workspace."""
    records = await PendingApprovalRepository.list_pending_by_workspace(
        workspace_id
    )
    return [PendingApprovalResponse.model_validate(r) for r in records]
