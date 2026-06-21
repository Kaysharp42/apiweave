"""
Tests for Wave 2 Task 11: Environment protection and approval APIs.

QA Scenarios:
1. Reviewer approval: Protected env requires reviewer, non-reviewer gets 403, reviewer approves.
2. Self-approval denied: Self-approval disabled, requester cannot approve own run.
3. Bypass audit: Trusted token bypass creates audit event with reason.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from app.models import (
    EnvironmentProtection,
    PendingRunApproval,
    ServiceToken,
)
from app.repositories.pending_approval_repository import PendingApprovalRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.repositories.service_token_repository import ServiceTokenRepository
from app.services import audit_service
from app.services.environment_protection_service import (
    ApprovalNotFoundError,
    ApprovalNotPendingError,
    BypassNotAllowedError,
    SelfApprovalDeniedError,
    approve_run,
    bypass_protection,
    check_protection_and_maybe_gate,
    get_pending_approval,
    list_pending_for_environment,
    list_pending_for_workspace,
)
from app.services.exceptions import ConflictError


def _make_protection(
    env_id: str = "env-protected",
    required_reviewers: list[str] | None = None,
    allow_self_approval: bool = False,
    bypass_policy: str = "none",
    bypass_allowlist: list[str] | None = None,
) -> EnvironmentProtection:
    now = datetime.now(UTC)
    return EnvironmentProtection.model_construct(
        protectionId="prot-test",
        environmentId=env_id,
        requiredReviewers=required_reviewers or [],
        allowSelfApproval=allow_self_approval,
        bypassPolicy=bypass_policy,
        bypassAllowlist=bypass_allowlist or [],
        createdAt=now,
        updatedAt=now,
    )


def _make_approval(
    approval_id: str = "appr-test123",
    run_id: str = "run-test",
    env_id: str = "env-protected",
    workspace_id: str = "ws-test",
    requester_user_id: str = "usr-requester",
    actor_type: str = "user",
    actor_id: str = "usr-requester",
    status: str = "pending",
) -> PendingRunApproval:
    now = datetime.now(UTC)
    return PendingRunApproval.model_construct(
        approvalId=approval_id,
        runId=run_id,
        environmentId=env_id,
        workspaceId=workspace_id,
        requestedByUserId=requester_user_id,
        requestedByActorType=actor_type,
        requestedByActorId=actor_id,
        status=status,
        resolvedBy=None,
        resolvedByActorType=None,
        bypassReason=None,
        createdAt=now,
        resolvedAt=None,
    )


def _make_service_token(
    token_id: str = "tok-bypass",
    name: str = "Emergency Bypass Token",
    scope_type: str = "workspace",
    scope_id: str = "ws-test",
) -> ServiceToken:
    now = datetime.now(UTC)
    return ServiceToken.model_construct(
        tokenId=token_id,
        name=name,
        tokenHash="sha256hash",
        scopeType=scope_type,
        scopeId=scope_id,
        createdBy="usr-admin",
        permissions=["runs:run"],
        createdAt=now,
        expiresAt=None,
        revokedAt=None,
    )


# ======================================================================
# Scenario 1: Protected env requires reviewer
# ======================================================================


class TestReviewerApproval:
    """Protected env requires reviewer. Non-reviewer gets 403. Reviewer approves."""

    async def test_unprotected_env_proceeds(self):
        """Run on unprotected environment proceeds without gating."""
        with patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
        ) as mock_get_prot:
            mock_get_prot.return_value = None

            result_status, result_approval = await check_protection_and_maybe_gate(
                run_id="run-1",
                environment_id="env-open",
                workspace_id="ws-test",
                actor_type="user",
                actor_id="usr-a",
                requested_by_user_id="usr-a",
            )

            assert result_status == "proceed"
            assert result_approval is None

    async def test_protected_env_creates_pending_approval(self):
        """Run on protected env creates a pending approval record."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer-b"],
            bypass_policy="none",
        )
        expected_approval = _make_approval(
            approval_id="appr-new",
            run_id="run-1",
            env_id="env-protected",
            requester_user_id="usr-a",
        )
        with (
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
            patch.object(
                PendingApprovalRepository, "create", new_callable=AsyncMock
            ) as mock_create,
            patch.object(audit_service, "append_event", new_callable=AsyncMock) as mock_audit,
        ):
            mock_get_prot.return_value = protection
            mock_create.return_value = expected_approval

            result_status, result_approval = await check_protection_and_maybe_gate(
                run_id="run-1",
                environment_id="env-protected",
                workspace_id="ws-test",
                actor_type="user",
                actor_id="usr-a",
                requested_by_user_id="usr-a",
            )

            assert result_status == "pending_approval"
            assert result_approval is not None
            assert result_approval.status == "pending"
            mock_create.assert_called_once()
            mock_audit.assert_called_once()
            audit_call = mock_audit.call_args
            assert (
                audit_call.kwargs["action"] == "run_approval_requested"
                or audit_call[1].get("action") == "run_approval_requested"
            )

    async def test_non_reviewer_cannot_approve(self):
        """A user not in requiredReviewers cannot approve a run."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer-b"],
            allow_self_approval=False,
        )
        approval = _make_approval(
            approval_id="appr-test",
            run_id="run-1",
            requester_user_id="usr-a",
        )
        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection

            with pytest.raises(ConflictError, match="not a required reviewer"):
                await approve_run("appr-test", "usr-random")

    async def test_reviewer_approves_run_successfully(self):
        """A qualified reviewer can approve a pending run."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer-b"],
            allow_self_approval=False,
        )
        approval = _make_approval(
            approval_id="appr-test",
            run_id="run-1",
            requester_user_id="usr-a",
        )
        approved_approval = _make_approval(
            approval_id="appr-test",
            run_id="run-1",
            requester_user_id="usr-a",
            status="approved",
        )
        approved_approval.resolvedBy = "usr-reviewer-b"
        approved_approval.resolvedByActorType = "user"
        approved_approval.resolvedAt = datetime.now(UTC)

        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
            patch.object(
                PendingApprovalRepository, "approve", new_callable=AsyncMock
            ) as mock_approve,
            patch.object(audit_service, "append_event", new_callable=AsyncMock) as mock_audit,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection
            mock_approve.return_value = approved_approval

            result = await approve_run("appr-test", "usr-reviewer-b")

            assert result.status == "approved"
            assert result.resolvedBy == "usr-reviewer-b"
            mock_approve.assert_called_once_with(
                approval_id="appr-test",
                resolved_by="usr-reviewer-b",
                resolved_by_actor_type="user",
            )
            mock_audit.assert_called_once()

    async def test_already_approved_cannot_approve_again(self):
        """An already approved run cannot be approved again."""
        approval = _make_approval(
            approval_id="appr-done",
            run_id="run-1",
            status="approved",
        )
        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = approval

            with pytest.raises(ApprovalNotPendingError, match="already approved"):
                await approve_run("appr-done", "usr-reviewer-b")


# ======================================================================
# Scenario 2: Self-approval denied
# ======================================================================


class TestSelfApprovalDenied:
    """Self-approval disabled: requester cannot approve their own run."""

    async def test_self_approval_disabled_blocks_requester(self):
        """When allowSelfApproval=False, the requester cannot approve their own run."""
        protection = _make_protection(
            required_reviewers=["usr-a"],
            allow_self_approval=False,
        )
        approval = _make_approval(
            approval_id="appr-self",
            run_id="run-1",
            requester_user_id="usr-a",
            actor_id="usr-a",
        )
        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection

            with pytest.raises(SelfApprovalDeniedError, match="Self-approval is disabled"):
                await approve_run("appr-self", "usr-a")

    async def test_self_approval_enabled_allows_requester(self):
        """When allowSelfApproval=True, the requester CAN approve their own run."""
        protection = _make_protection(
            required_reviewers=["usr-a"],
            allow_self_approval=True,
        )
        approval = _make_approval(
            approval_id="appr-self-ok",
            run_id="run-1",
            requester_user_id="usr-a",
            actor_id="usr-a",
        )
        approved = _make_approval(
            approval_id="appr-self-ok",
            run_id="run-1",
            requester_user_id="usr-a",
            status="approved",
        )
        approved.resolvedBy = "usr-a"
        approved.resolvedByActorType = "user"

        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
            patch.object(
                PendingApprovalRepository, "approve", new_callable=AsyncMock
            ) as mock_approve,
            patch.object(audit_service, "append_event", new_callable=AsyncMock),
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection
            mock_approve.return_value = approved

            result = await approve_run("appr-self-ok", "usr-a")

            assert result.status == "approved"
            assert result.resolvedBy == "usr-a"

    async def test_different_reviewer_can_approve_even_when_self_approval_disabled(self):
        """A different reviewer can approve even when self-approval is disabled."""
        protection = _make_protection(
            required_reviewers=["usr-a", "usr-b"],
            allow_self_approval=False,
        )
        approval = _make_approval(
            approval_id="appr-other",
            run_id="run-1",
            requester_user_id="usr-a",
            actor_id="usr-a",
        )
        approved = _make_approval(
            approval_id="appr-other",
            run_id="run-1",
            requester_user_id="usr-a",
            status="approved",
        )
        approved.resolvedBy = "usr-b"
        approved.resolvedByActorType = "user"

        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
            patch.object(
                PendingApprovalRepository, "approve", new_callable=AsyncMock
            ) as mock_approve,
            patch.object(audit_service, "append_event", new_callable=AsyncMock),
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection
            mock_approve.return_value = approved

            result = await approve_run("appr-other", "usr-b")

            assert result.status == "approved"
            assert result.resolvedBy == "usr-b"


# ======================================================================
# Scenario 3: Trusted token bypass audited
# ======================================================================


class TestBypassAudit:
    """Trusted token bypass creates audit event with reason."""

    async def test_bypass_with_allowed_token_succeeds_and_audits(self):
        """Bypass with an allowed token succeeds and creates an audit event."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer"],
            bypass_policy="trusted_token_only",
            bypass_allowlist=["tok-bypass"],
        )
        approval = _make_approval(
            approval_id="appr-bypass",
            run_id="run-1",
            requester_user_id="usr-a",
        )
        bypassed = _make_approval(
            approval_id="appr-bypass",
            run_id="run-1",
            requester_user_id="usr-a",
            status="bypassed",
        )
        bypassed.resolvedBy = "tok-bypass"
        bypassed.resolvedByActorType = "service_token"
        bypassed.bypassReason = "emergency deploy"
        bypassed.resolvedAt = datetime.now(UTC)

        token = _make_service_token(token_id="tok-bypass")

        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
            patch.object(
                ServiceTokenRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_token,
            patch.object(
                PendingApprovalRepository, "bypass", new_callable=AsyncMock
            ) as mock_bypass,
            patch.object(audit_service, "append_event", new_callable=AsyncMock) as mock_audit,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection
            mock_get_token.return_value = token
            mock_bypass.return_value = bypassed

            result = await bypass_protection("appr-bypass", "tok-bypass", "emergency deploy")

            assert result.status == "bypassed"
            assert result.bypassReason == "emergency deploy"
            assert result.resolvedBy == "tok-bypass"

            mock_audit.assert_called_once()
            call_kwargs = mock_audit.call_args
            action = call_kwargs.kwargs.get("action") or call_kwargs[1].get("action")
            assert action == "protection_bypassed"
            ctx = call_kwargs.kwargs.get("context") or call_kwargs[1].get("context")
            assert ctx["reason"] == "emergency deploy"
            assert ctx["approvalId"] == "appr-bypass"

    async def test_bypass_with_unlisted_token_fails(self):
        """Bypass with a token NOT in the allowlist raises BypassNotAllowedError."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer"],
            bypass_policy="trusted_token_only",
            bypass_allowlist=["tok-allowed"],
        )
        approval = _make_approval(
            approval_id="appr-bypass-fail",
            run_id="run-1",
            requester_user_id="usr-a",
        )
        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection

            with pytest.raises(BypassNotAllowedError, match="not in the bypass allowlist"):
                await bypass_protection("appr-bypass-fail", "tok-unlisted", "urgent")

    async def test_bypass_with_none_policy_fails(self):
        """Bypass when bypassPolicy is 'none' raises BypassNotAllowedError."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer"],
            bypass_policy="none",
            bypass_allowlist=["tok-bypass"],
        )
        approval = _make_approval(
            approval_id="appr-no-bypass",
            run_id="run-1",
            requester_user_id="usr-a",
        )
        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection

            with pytest.raises(BypassNotAllowedError, match="not 'trusted_token_only'"):
                await bypass_protection("appr-no-bypass", "tok-bypass", "urgent")

    async def test_bypass_with_empty_reason_fails(self):
        """Bypass with empty reason raises ConflictError."""
        with pytest.raises(ConflictError, match="Bypass reason is required"):
            await bypass_protection("appr-any", "tok-any", "")

    async def test_bypass_with_revoked_token_fails(self):
        """Bypass with a revoked token raises BypassNotAllowedError."""
        protection = _make_protection(
            required_reviewers=["usr-reviewer"],
            bypass_policy="trusted_token_only",
            bypass_allowlist=["tok-revoked"],
        )
        approval = _make_approval(
            approval_id="appr-revoked",
            run_id="run-1",
            requester_user_id="usr-a",
        )
        revoked_token = _make_service_token(token_id="tok-revoked")
        revoked_token.revokedAt = datetime.now(UTC)

        with (
            patch.object(
                PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_approval,
            patch.object(
                ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
            ) as mock_get_prot,
            patch.object(
                ServiceTokenRepository, "get_by_id", new_callable=AsyncMock
            ) as mock_get_token,
        ):
            mock_get_approval.return_value = approval
            mock_get_prot.return_value = protection
            mock_get_token.return_value = revoked_token

            with pytest.raises(BypassNotAllowedError, match="has been revoked"):
                await bypass_protection("appr-revoked", "tok-revoked", "urgent")


# ======================================================================
# Pending Approval Queries
# ======================================================================


class TestPendingApprovalQueries:
    """Query operations for pending approvals."""

    async def test_get_pending_approval_not_found(self):
        """Getting a non-existent approval raises ApprovalNotFoundError."""
        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None

            with pytest.raises(ApprovalNotFoundError):
                await get_pending_approval("appr-nonexistent")

    async def test_list_pending_for_environment(self):
        """List pending approvals for an environment."""
        approvals = [
            _make_approval(approval_id="appr-1", run_id="run-1"),
            _make_approval(approval_id="appr-2", run_id="run-2"),
        ]
        with patch.object(
            PendingApprovalRepository, "list_pending_by_environment", new_callable=AsyncMock
        ) as mock_list:
            mock_list.return_value = approvals

            result = await list_pending_for_environment("env-protected")
            assert len(result) == 2

    async def test_list_pending_for_workspace(self):
        """List pending approvals for a workspace."""
        approvals = [
            _make_approval(approval_id="appr-1", run_id="run-1"),
        ]
        with patch.object(
            PendingApprovalRepository, "list_pending_by_workspace", new_callable=AsyncMock
        ) as mock_list:
            mock_list.return_value = approvals

            result = await list_pending_for_workspace("ws-test")
            assert len(result) == 1


# ======================================================================
# Protection with no reviewers and no bypass proceeds
# ======================================================================


class TestProtectionEdgeCases:
    """Edge cases for protection configuration."""

    async def test_protection_with_no_reviewers_and_no_bypass_proceeds(self):
        """Protection with empty reviewers and bypassPolicy='none' proceeds."""
        protection = _make_protection(
            required_reviewers=[],
            bypass_policy="none",
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
        ) as mock_get_prot:
            mock_get_prot.return_value = protection

            result_status, result_approval = await check_protection_and_maybe_gate(
                run_id="run-1",
                environment_id="env-empty",
                workspace_id="ws-test",
                actor_type="user",
                actor_id="usr-a",
            )

            assert result_status == "proceed"
            assert result_approval is None

    async def test_nonexistent_approval_for_approve_raises(self):
        """Approving a non-existent approval raises ApprovalNotFoundError."""
        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None

            with pytest.raises(ApprovalNotFoundError):
                await approve_run("appr-ghost", "usr-reviewer")

    async def test_nonexistent_approval_for_bypass_raises(self):
        """Bypassing a non-existent approval raises ApprovalNotFoundError."""
        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None

            with pytest.raises(ApprovalNotFoundError):
                await bypass_protection("appr-ghost", "tok-any", "reason")
