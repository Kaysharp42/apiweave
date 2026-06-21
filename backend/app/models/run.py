from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class ScopedEnvRef(BaseModel):
    """Reference to a scoped environment for run selection."""

    scopeType: Literal["user", "organization", "workspace"]
    scopeId: str
    environmentId: str


class RunCreate(BaseModel):
    """Request model for triggering a workflow run"""

    workflowId: str
    variables: dict[str, Any] | None = None  # Override workflow variables
    callbackUrl: str | None = None  # For CI/CD integration


class RunActorContext(BaseModel):
    """Typed actor context for run creation.

    Separates who triggered the run (actor) from who owns the run (workspace).
    The actor can be a user, service token, webhook token, or system.
    """

    actorType: Literal["user", "service_token", "webhook_token", "system"]
    actorId: str


class RunResult(BaseModel):
    """Result of a single node execution"""

    nodeId: str
    status: Literal["passed", "failed", "skipped"]
    duration: int  # milliseconds
    request: dict[str, Any] | None = None
    response: dict[str, Any] | None = None
    error: str | None = None
    assertions: list[dict[str, Any]] | None = None


class Run(Document):
    """Workflow run/Execution - Beanie Document

    Runs are workspace-owned. The actor (user/service_token/webhook/system)
    is recorded separately from workspace ownership. Audit event IDs are
    linked for full traceability. Edge cases:
    - Soft-deleted env while queued: run fails with audit.
    - User removed mid-run: run continues (secrets resolved at start), audit records removal.
    """

    runId: str
    workflowId: str
    selectedEnvironmentId: str | None = None  # Scoped environment for this run
    environmentId: str | None = None  # Legacy field, kept for migration
    status: Literal["pending", "pending_approval", "running", "completed", "failed", "cancelled"]
    trigger: Literal["manual", "webhook", "schedule"]
    variables: dict[str, Any] = Field(default_factory=dict)
    callbackUrl: str | None = None
    results: list[RunResult] = Field(default_factory=list)
    createdAt: datetime
    startedAt: datetime | None = None
    completedAt: datetime | None = None
    duration: int | None = None  # milliseconds
    error: str | None = None
    failedNodes: list[str] | None = None  # List of node IDs that failed
    failureMessage: str | None = None  # Summary of failures
    nodeStatuses: dict[str, Any] = Field(default_factory=dict)  # Node execution statuses
    resumeFromRunId: str | None = None  # Source run used to resume context
    resumeFromNodeIds: list[str] | None = None  # Entry nodes used for resumed run
    resumeMode: Literal["single", "all-failed"] | None = None
    # Workspace ownership (resource ownership — NOT actor ownership)
    workspaceId: str | None = None
    orgId: str | None = None
    ownerType: str | None = None  # "user" | "organization"
    # Actor — who triggered this run (separate from workspace ownership)
    actorType: Literal["user", "service_token", "webhook_token", "system"] | None = None
    actorId: str | None = None
    # Audit trail linking
    auditEventIds: list[str] = Field(default_factory=list)
    pendingApprovalId: str | None = None  # Links to PendingRunApproval if gated
    # Edge-case tracking
    actorRemovedDuringRun: bool = False  # True if actor was removed mid-run

    class Settings:
        name = "runs"
        indexes = [
            IndexModel([("runId", ASCENDING)], unique=True),
            IndexModel([("status", ASCENDING), ("createdAt", ASCENDING)]),
            IndexModel([("workflowId", ASCENDING)]),
            IndexModel([("selectedEnvironmentId", ASCENDING)]),
            IndexModel([("workspaceId", ASCENDING)]),
            IndexModel([("actorType", ASCENDING), ("actorId", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class RunEnvironmentSelection(BaseModel):
    """Resolved environment selection for a run.

    Each run selects exactly one environment. If no explicit environment
    is provided, the workspace default is used.
    """

    environmentId: str
    scopeType: str  # "user" | "organization" | "workspace"
    scopeId: str
    name: str


class PendingRunApproval(Document):
    """
    Tracks a run that is waiting for environment protection approval.

    Created when a run targets a protected environment and no bypass applies.
    The run stays in 'pending_approval' status until a qualified reviewer
    approves it or a trusted token bypasses protection with an audited reason.

    Fields:
    - approvalId: unique identifier for this approval record
    - runId: the run awaiting approval
    - environmentId: the protected environment
    - workspaceId: the workspace that owns the run
    - requestedByUserId: the user who triggered the run (if human actor)
    - requestedByActorType: "user" | "service_token" | "webhook" | "system"
    - requestedByActorId: the actor ID (userId or tokenId)
    - status: "pending" | "approved" | "bypassed" | "rejected"
    - resolvedBy: the userId or tokenId that approved/bypassed
    - resolvedByActorType: actor type of the resolver
    - bypassReason: required when status is "bypassed"
    - resolvedAt: when the approval was resolved
    """

    approvalId: str
    runId: str
    environmentId: str
    workspaceId: str
    requestedByUserId: str | None = None
    requestedByActorType: str  # "user" | "service_token" | "webhook" | "system"
    requestedByActorId: str
    status: Literal["pending", "approved", "bypassed", "rejected"] = "pending"
    resolvedBy: str | None = None
    resolvedByActorType: str | None = None
    bypassReason: str | None = None
    createdAt: datetime
    resolvedAt: datetime | None = None

    class Settings:
        name = "pending_run_approvals"
        indexes = [
            IndexModel([("approvalId", ASCENDING)], unique=True),
            IndexModel([("runId", ASCENDING)], unique=True),
            IndexModel([("environmentId", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("workspaceId", ASCENDING), ("status", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class ApprovalActionRequest(BaseModel):
    """Request body for approving a pending run."""

    # No body fields required — the actor is derived from the session/token.


class BypassActionRequest(BaseModel):
    """Request body for bypassing environment protection with a trusted token."""

    reason: str  # Required: human-readable reason for the bypass


class PendingApprovalResponse(BaseModel):
    """Pending approval record returned by list/get endpoints."""

    model_config = ConfigDict(from_attributes=True)

    approvalId: str
    runId: str
    environmentId: str
    workspaceId: str
    requestedByUserId: str | None = None
    requestedByActorType: str
    requestedByActorId: str
    status: Literal["pending", "approved", "bypassed", "rejected"]
    resolvedBy: str | None = None
    resolvedByActorType: str | None = None
    bypassReason: str | None = None
    createdAt: datetime
    resolvedAt: datetime | None = None
