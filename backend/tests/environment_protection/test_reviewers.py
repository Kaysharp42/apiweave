"""
Task 27 — Reviewer and self-approval tests.

Verifies that:
- Required reviewers are enforced (non-reviewers cannot approve).
- Self-approval is denied when disabled.
- Self-approval is allowed when enabled.
- A different reviewer can approve even when self-approval is disabled.
- Already-resolved approvals cannot be approved again.
"""
from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import EnvironmentProtection, PendingRunApproval
from app.repositories.pending_approval_repository import PendingApprovalRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.services import audit_service
from app.services.environment_protection_service import (
    ApprovalNotFoundError,
    ApprovalNotPendingError,
    SelfApprovalDeniedError,
    approve_run,
    check_protection_and_maybe_gate,
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
    approval_id: str = "appr-test",
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


# ---------------------------------------------------------------------------
# Required reviewers enforcement
# ---------------------------------------------------------------------------


class TestRequiredReviewers:
    """Non-reviewers cannot approve. Qualified reviewers can."""

    async def test_non_reviewer_cannot_approve(self):
        """A user not in requiredReviewers gets ConflictError."""
        protection = _make_protection(required_reviewers=["usr-reviewer-b"])
        approval = _make_approval(requester_user_id="usr-a")

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ):
            with pytest.raises(ConflictError, match="not a required reviewer"):
                await approve_run("appr-test", "usr-random")

    async def test_reviewer_approves_successfully(self):
        """A qualified reviewer can approve a pending run."""
        protection = _make_protection(required_reviewers=["usr-reviewer-b"])
        approval = _make_approval(requester_user_id="usr-a")
        approved = _make_approval(status="approved")
        approved.resolvedBy = "usr-reviewer-b"
        approved.resolvedByActorType = "user"
        approved.resolvedAt = datetime.now(UTC)

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ), patch.object(
            PendingApprovalRepository, "approve", new_callable=AsyncMock, return_value=approved,
        ), patch.object(
            audit_service, "append_event", new_callable=AsyncMock,
        ):
            result = await approve_run("appr-test", "usr-reviewer-b")
            assert result.status == "approved"
            assert result.resolvedBy == "usr-reviewer-b"

    async def test_approval_creates_audit_event(self):
        """Approving a run creates an audit event."""
        protection = _make_protection(required_reviewers=["usr-reviewer-b"])
        approval = _make_approval(requester_user_id="usr-a")
        approved = _make_approval(status="approved")
        approved.resolvedBy = "usr-reviewer-b"
        approved.resolvedByActorType = "user"

        captured: dict = {}

        async def mock_audit(**kwargs):
            captured.update(kwargs)
            return MagicMock()

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ), patch.object(
            PendingApprovalRepository, "approve", new_callable=AsyncMock, return_value=approved,
        ), patch.object(
            audit_service, "append_event", side_effect=mock_audit,
        ):
            await approve_run("appr-test", "usr-reviewer-b")

        assert captured.get("action") == "run_approved"
        ctx = captured.get("context", {})
        assert "approvalId" in ctx
        assert "workspaceId" in ctx

    async def test_already_approved_cannot_approve_again(self):
        """An already approved run cannot be approved again."""
        approval = _make_approval(status="approved")

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ):
            with pytest.raises(ApprovalNotPendingError, match="already approved"):
                await approve_run("appr-done", "usr-reviewer-b")

    async def test_nonexistent_approval_raises(self):
        """Approving a non-existent approval raises ApprovalNotFoundError."""
        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=None,
        ):
            with pytest.raises(ApprovalNotFoundError):
                await approve_run("appr-ghost", "usr-reviewer")

    async def test_multiple_reviewers_any_can_approve(self):
        """When multiple reviewers are configured, any one can approve."""
        protection = _make_protection(required_reviewers=["usr-a", "usr-b", "usr-c"])
        approval = _make_approval(requester_user_id="usr-requester")
        approved = _make_approval(status="approved")
        approved.resolvedBy = "usr-b"
        approved.resolvedByActorType = "user"

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ), patch.object(
            PendingApprovalRepository, "approve", new_callable=AsyncMock, return_value=approved,
        ), patch.object(
            audit_service, "append_event", new_callable=AsyncMock,
        ):
            result = await approve_run("appr-test", "usr-b")
            assert result.status == "approved"
            assert result.resolvedBy == "usr-b"


# ---------------------------------------------------------------------------
# Self-approval
# ---------------------------------------------------------------------------


class TestSelfApproval:
    """Self-approval policy enforcement."""

    async def test_self_approval_disabled_blocks_requester(self):
        """When allowSelfApproval=False, requester cannot approve own run."""
        protection = _make_protection(
            required_reviewers=["usr-a"],
            allow_self_approval=False,
        )
        approval = _make_approval(
            approval_id="appr-self",
            requester_user_id="usr-a",
            actor_id="usr-a",
        )

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ):
            with pytest.raises(SelfApprovalDeniedError, match="Self-approval is disabled"):
                await approve_run("appr-self", "usr-a")

    async def test_self_approval_enabled_allows_requester(self):
        """When allowSelfApproval=True, requester CAN approve own run."""
        protection = _make_protection(
            required_reviewers=["usr-a"],
            allow_self_approval=True,
        )
        approval = _make_approval(
            approval_id="appr-self-ok",
            requester_user_id="usr-a",
            actor_id="usr-a",
        )
        approved = _make_approval(
            approval_id="appr-self-ok",
            status="approved",
        )
        approved.resolvedBy = "usr-a"
        approved.resolvedByActorType = "user"

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ), patch.object(
            PendingApprovalRepository, "approve", new_callable=AsyncMock, return_value=approved,
        ), patch.object(
            audit_service, "append_event", new_callable=AsyncMock,
        ):
            result = await approve_run("appr-self-ok", "usr-a")
            assert result.status == "approved"
            assert result.resolvedBy == "usr-a"

    async def test_different_reviewer_can_approve_when_self_approval_disabled(self):
        """A different reviewer can approve even when self-approval is disabled."""
        protection = _make_protection(
            required_reviewers=["usr-a", "usr-b"],
            allow_self_approval=False,
        )
        approval = _make_approval(
            approval_id="appr-other",
            requester_user_id="usr-a",
            actor_id="usr-a",
        )
        approved = _make_approval(
            approval_id="appr-other",
            status="approved",
        )
        approved.resolvedBy = "usr-b"
        approved.resolvedByActorType = "user"

        with patch.object(
            PendingApprovalRepository, "get_by_id", new_callable=AsyncMock, return_value=approval,
        ), patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ), patch.object(
            PendingApprovalRepository, "approve", new_callable=AsyncMock, return_value=approved,
        ), patch.object(
            audit_service, "append_event", new_callable=AsyncMock,
        ):
            result = await approve_run("appr-other", "usr-b")
            assert result.status == "approved"
            assert result.resolvedBy == "usr-b"


# ---------------------------------------------------------------------------
# Gate check
# ---------------------------------------------------------------------------


class TestGateCheck:
    """check_protection_and_maybe_gate behavior."""

    async def test_unprotected_env_proceeds(self):
        """Unprotected environment proceeds without gating."""
        with patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=None,
        ):
            status, approval = await check_protection_and_maybe_gate(
                run_id="run-1",
                environment_id="env-open",
                workspace_id="ws-test",
                actor_type="user",
                actor_id="usr-a",
            )
            assert status == "proceed"
            assert approval is None

    async def test_empty_reviewers_and_no_bypass_proceeds(self):
        """Protection with no reviewers and bypassPolicy='none' proceeds."""
        protection = _make_protection(required_reviewers=[], bypass_policy="none")
        with patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ):
            status, approval = await check_protection_and_maybe_gate(
                run_id="run-1",
                environment_id="env-empty",
                workspace_id="ws-test",
                actor_type="user",
                actor_id="usr-a",
            )
            assert status == "proceed"
            assert approval is None

    async def test_protected_env_creates_pending(self):
        """Protected env with reviewers creates a pending approval."""
        protection = _make_protection(required_reviewers=["usr-reviewer"])
        expected_approval = _make_approval()

        with patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock, return_value=protection,
        ), patch.object(
            PendingApprovalRepository, "create", new_callable=AsyncMock, return_value=expected_approval,
        ), patch.object(
            audit_service, "append_event", new_callable=AsyncMock,
        ):
            status, approval = await check_protection_and_maybe_gate(
                run_id="run-1",
                environment_id="env-protected",
                workspace_id="ws-test",
                actor_type="user",
                actor_id="usr-a",
                requested_by_user_id="usr-a",
            )
            assert status == "pending_approval"
            assert approval is not None
