"""Environment-protection gate on the manual/scoped run path (roadmap §3.3 / P2.1-2.2).

Previously trigger_workflow_run created the run and immediately executed it,
never consulting environment protection (only webhooks did). Now a protected
environment holds the run as pending_approval and does NOT execute.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.models import (
    Environment,
    EnvironmentProtection,
    RunActorContext,
    Workflow,
)
from app.repositories.pending_approval_repository import PendingApprovalRepository
from app.repositories.run_repository import RunRepository
from app.services import run_service

_T = datetime(2026, 6, 26, tzinfo=UTC)


async def _seed_workflow_and_env(*, protected: bool) -> None:
    await Workflow(
        workflowId="wf-1",
        name="WF",
        workspaceId="ws-alice",
        ownerType="user",
        createdAt=_T,
        updatedAt=_T,
    ).insert()
    await Environment(
        environmentId="env-1",
        name="prod",
        scopeType="workspace",
        scopeId="ws-alice",
        createdAt=_T,
        updatedAt=_T,
    ).insert()
    if protected:
        await EnvironmentProtection(
            protectionId="prot-1",
            environmentId="env-1",
            requiredReviewers=["reviewer-1"],
            createdAt=_T,
            updatedAt=_T,
        ).insert()


async def test_protected_env_holds_run_for_approval(seeded) -> None:
    await _seed_workflow_and_env(protected=True)

    result = await run_service.trigger_workflow_run(
        workflow_id="wf-1",
        environment_id="env-1",
        workspace_id="ws-alice",
        actor=RunActorContext(actorType="user", actorId="alice"),
    )

    assert result["status"] == "pending_approval"
    assert result["approvalId"]

    run = await RunRepository.get_by_id(result["runId"])
    assert run.status == "pending_approval"
    assert run.startedAt is None  # never executed

    approval = await PendingApprovalRepository.get_by_run_id(result["runId"])
    assert approval is not None
    assert approval.status == "pending"


async def test_unprotected_env_does_not_gate(seeded) -> None:
    # No EnvironmentProtection record => the gate must not create an approval.
    await _seed_workflow_and_env(protected=False)

    result = await run_service.trigger_workflow_run(
        workflow_id="wf-1",
        environment_id="env-1",
        workspace_id="ws-alice",
        actor=RunActorContext(actorType="user", actorId="alice"),
    )

    assert result["status"] == "pending"  # proceeds (executes in background)
    approval = await PendingApprovalRepository.get_by_run_id(result["runId"])
    assert approval is None


async def _trigger_gated(actor_id: str = "alice") -> dict:
    return await run_service.trigger_workflow_run(
        workflow_id="wf-1",
        environment_id="env-1",
        workspace_id="ws-alice",
        actor=RunActorContext(actorType="user", actorId=actor_id),
    )


async def test_resume_approved_run_starts_held_run(seeded) -> None:
    await _seed_workflow_and_env(protected=True)
    gated = await _trigger_gated()
    assert gated["status"] == "pending_approval"

    resumed = await run_service.resume_approved_run(gated["runId"])
    assert resumed["status"] == "pending"

    run = await RunRepository.get_by_id(gated["runId"])
    assert run.status != "pending_approval"  # released for execution


async def test_cancel_pending_run_on_reject(seeded) -> None:
    await _seed_workflow_and_env(protected=True)
    gated = await _trigger_gated()

    cancelled = await run_service.cancel_pending_run(gated["runId"])
    assert cancelled["status"] == "cancelled"

    run = await RunRepository.get_by_id(gated["runId"])
    assert run.status == "cancelled"


async def test_reject_run_requires_reviewer(seeded) -> None:
    from app.services import environment_protection_service as svc
    from app.services.exceptions import ConflictError

    await _seed_workflow_and_env(protected=True)
    gated = await _trigger_gated()
    approval = await PendingApprovalRepository.get_by_run_id(gated["runId"])

    # Non-reviewer cannot reject.
    try:
        await svc.reject_run(approval.approvalId, "not-a-reviewer")
        raise AssertionError("expected ConflictError for non-reviewer")
    except ConflictError:
        pass

    # Required reviewer can reject -> approval rejected.
    rejected = await svc.reject_run(approval.approvalId, "reviewer-1")
    assert rejected.status == "rejected"
