from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class WorkflowOrderItem(BaseModel):
    """Defines execution order for workflows in a collection"""

    workflowId: str
    order: int  # 0, 1, 2, ...
    enabled: bool = True
    continueOnFail: bool = True  # Default: continue to show all results


class CollectionCreate(BaseModel):
    """Request model for creating a collection"""

    name: str
    description: str | None = None
    color: str | None = None  # Hex color for UI display


class CollectionUpdate(BaseModel):
    """Request model for updating a collection"""

    name: str | None = None
    description: str | None = None
    color: str | None = None


class Project(Document):
    """Project model - groups workflows together - Beanie Document

    Renamed from Collection in the public domain. DB collection name stays
    'collections' for migration compatibility. projectId is an alias for collectionId.
    """

    collectionId: str  # Legacy field, kept for backward compat
    projectId: str | None = None  # Public-domain alias for collectionId
    name: str
    description: str | None = None
    color: str | None = None  # e.g., #FF5733
    workflowCount: int = 0

    # Ordered execution configuration
    workflowOrder: list[WorkflowOrderItem] = Field(default_factory=list)
    continueOnFail: bool = True  # Default: show all results, don't stop at first failure

    # Scoped ownership
    workspaceId: str | None = None
    orgId: str | None = None
    ownerType: str | None = None  # "user" | "organization"

    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "collections"  # Keep old DB name for migration
        indexes = [
            IndexModel([("collectionId", ASCENDING)], unique=True),
            IndexModel(
                [("projectId", ASCENDING)],
                unique=True,
                partialFilterExpression={"projectId": {"$type": "string"}},
            ),
            IndexModel([("workspaceId", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class CollectionImportRequest(BaseModel):
    """Request model for importing a collection bundle"""

    bundle: dict[str, Any]
    createNewCollection: bool = True
    newCollectionName: str | None = None
    targetCollectionId: str | None = None
    environmentMapping: dict[str, str] | None = None


class CollectionImportDryRunRequest(BaseModel):
    """Request model for validating a collection bundle"""

    bundle: dict[str, Any]
    createNewCollection: bool = True
    targetCollectionId: str | None = None


class CollectionRun(Document):
    """Aggregate results from collection execution"""

    collectionRunId: str  # e.g., "col-run-abc123"
    collectionId: str
    collectionName: str

    # Execution status
    status: Literal["pending", "running", "completed", "completed_with_errors", "failed"]
    startTime: datetime
    endTime: datetime | None = None
    duration: int | None = None  # milliseconds

    # Environment
    environmentId: str | None = None

    # Results summary
    totalWorkflows: int
    executedWorkflows: int = 0
    passedWorkflows: int = 0
    failedWorkflows: int = 0

    # Individual workflow results (in execution order)
    workflowResults: list[dict[str, Any]] = Field(default_factory=list)
    # Format:
    # {
    #   "order": 1,
    #   "workflowId": "wf-123",
    #   "workflowName": "User Login",
    #   "runId": "run-456",
    #   "status": "completed",
    #   "passed": true,
    #   "duration": 1234,
    #   "error": null
    # }

    # Webhook tracking
    webhookId: str | None = None
    triggeredBy: str | None = None  # "webhook" or userId

    class Settings:
        name = "collection_runs"
        indexes = [
            IndexModel([("collectionRunId", ASCENDING)], unique=True),
            IndexModel([("collectionId", ASCENDING), ("startTime", DESCENDING)]),
            IndexModel([("webhookId", ASCENDING)]),
            IndexModel([("status", ASCENDING)]),
        ]
