"""
Pending Approval Repository — data access for PendingRunApproval documents.

Follows the repository pattern: all DB access for pending approvals goes here.
"""

from datetime import UTC, datetime

from app.models import PendingRunApproval


class PendingApprovalRepository:
    @staticmethod
    async def create(
        approval_id: str,
        run_id: str,
        environment_id: str,
        workspace_id: str,
        actor_type: str,
        actor_id: str,
        requested_by_user_id: str | None = None,
    ) -> PendingRunApproval:
        now = datetime.now(UTC)
        record = PendingRunApproval(
            approvalId=approval_id,
            runId=run_id,
            environmentId=environment_id,
            workspaceId=workspace_id,
            requestedByUserId=requested_by_user_id,
            requestedByActorType=actor_type,
            requestedByActorId=actor_id,
            status="pending",
            createdAt=now,
        )
        await record.insert()
        return record

    @staticmethod
    async def get_by_id(approval_id: str) -> PendingRunApproval | None:
        return await PendingRunApproval.find_one(PendingRunApproval.approvalId == approval_id)

    @staticmethod
    async def get_by_run_id(run_id: str) -> PendingRunApproval | None:
        return await PendingRunApproval.find_one(PendingRunApproval.runId == run_id)

    @staticmethod
    async def get_pending_by_env_and_run(
        environment_id: str, run_id: str
    ) -> PendingRunApproval | None:
        return await PendingRunApproval.find_one(
            PendingRunApproval.environmentId == environment_id,
            PendingRunApproval.runId == run_id,
            PendingRunApproval.status == "pending",
        )

    @staticmethod
    async def list_pending_by_environment(
        environment_id: str,
    ) -> list[PendingRunApproval]:
        return (
            await PendingRunApproval.find(
                PendingRunApproval.environmentId == environment_id,
                PendingRunApproval.status == "pending",
            )
            .sort(-PendingRunApproval.createdAt)
            .to_list()
        )

    @staticmethod
    async def list_pending_by_workspace(
        workspace_id: str,
    ) -> list[PendingRunApproval]:
        return (
            await PendingRunApproval.find(
                PendingRunApproval.workspaceId == workspace_id,
                PendingRunApproval.status == "pending",
            )
            .sort(-PendingRunApproval.createdAt)
            .to_list()
        )

    @staticmethod
    async def approve(
        approval_id: str,
        resolved_by: str,
        resolved_by_actor_type: str,
    ) -> PendingRunApproval | None:
        record = await PendingApprovalRepository.get_by_id(approval_id)
        if not record:
            return None
        now = datetime.now(UTC)
        record.status = "approved"
        record.resolvedBy = resolved_by
        record.resolvedByActorType = resolved_by_actor_type
        record.resolvedAt = now
        await record.save()
        return record

    @staticmethod
    async def bypass(
        approval_id: str,
        resolved_by: str,
        resolved_by_actor_type: str,
        reason: str,
    ) -> PendingRunApproval | None:
        record = await PendingApprovalRepository.get_by_id(approval_id)
        if not record:
            return None
        now = datetime.now(UTC)
        record.status = "bypassed"
        record.resolvedBy = resolved_by
        record.resolvedByActorType = resolved_by_actor_type
        record.bypassReason = reason
        record.resolvedAt = now
        await record.save()
        return record

    @staticmethod
    async def reject(
        approval_id: str,
        resolved_by: str,
        resolved_by_actor_type: str,
    ) -> PendingRunApproval | None:
        record = await PendingApprovalRepository.get_by_id(approval_id)
        if not record:
            return None
        now = datetime.now(UTC)
        record.status = "rejected"
        record.resolvedBy = resolved_by
        record.resolvedByActorType = resolved_by_actor_type
        record.resolvedAt = now
        await record.save()
        return record
