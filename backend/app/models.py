"""
Data models for APIWeave
Pydantic models for workflows, nodes, edges, and runs
Now using Beanie ODM for type-safe MongoDB operations
"""

from datetime import datetime
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


class FileUpload(BaseModel):
    """File attachment for HTTP request node"""

    name: str  # Unique identifier in node
    type: Literal["path", "base64", "variable"]  # How file is referenced
    value: str  # File path, base64 string, or variable reference
    fieldName: str  # HTML form field name for multipart request
    mimeType: str = "application/octet-stream"  # Content-Type header
    description: str | None = None  # Human-readable description


class HTTPRequestNode(BaseModel):
    """HTTP Request node configuration"""

    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    url: str
    headers: dict[str, str] = Field(default_factory=dict)
    body: str | None = None
    timeout: int = 30
    followRedirects: bool = True
    extractors: dict[str, str] = Field(default_factory=dict)  # JSONPath extractors
    fileUploads: list[FileUpload] = Field(default_factory=list)  # NEW: File attachments


class AssertionNode(BaseModel):
    """Assertion node configuration"""

    assertions: list[dict[str, Any]] = Field(default_factory=list)
    # Each assertion: {"field": "jsonpath", "operator": "equals|contains|gt|lt", "expected": value}


class DelayNode(BaseModel):
    """Delay node configuration"""

    duration: int  # milliseconds


class MergeNode(BaseModel):
    """Merge node configuration - combines parallel branches"""

    mergeStrategy: Literal["all", "any", "first", "conditional"] = "all"
    # all: Wait for all branches (AND)
    # any: Continue when any branch completes (OR)
    # first: Use first completed branch only
    # conditional: Merge only branches matching conditions
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    # Each condition: {"branchIndex": 0, "field": "statusCode", "operator": "equals", "value": "200"}


class ConditionNode(BaseModel):
    """Conditional branching node"""

    condition: str  # JSONPath or expression
    operator: Literal["equals", "notEquals", "contains", "gt", "lt", "gte", "lte", "exists"]
    value: Any


class Node(BaseModel):
    """Workflow node"""

    nodeId: str
    type: Literal["http-request", "assertion", "delay", "merge", "condition", "start", "end"]
    label: str | None = None  # Optional: Display label for the node
    position: dict[str, float] = Field(default_factory=dict)  # {x: float, y: float}
    config: dict[str, Any] | None = None  # Node-specific configuration


class Edge(BaseModel):
    """Workflow edge (connection between nodes)"""

    edgeId: str
    source: str  # source nodeId
    target: str  # target nodeId
    sourceHandle: str | None = None  # Handle ID on source node (e.g., "pass", "fail" for assertion)
    targetHandle: str | None = None  # Handle ID on target node
    label: str | None = None  # For conditional edges: "Pass", "Fail", "Branch N"


class WorkflowCreate(BaseModel):
    """Request model for creating a workflow"""

    name: str
    description: str | None = None
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    variables: dict[str, Any] = Field(default_factory=dict)  # Environment variables
    tags: list[str] = Field(default_factory=list)
    nodeTemplates: list[dict[str, Any]] = Field(
        default_factory=list
    )  # Imported node templates for Add Nodes panel
    collectionId: str | None = None  # Optional: Link to collection


class WorkflowUpdate(BaseModel):
    """Request model for updating a workflow"""

    name: str | None = None
    description: str | None = None
    nodes: list[Node] | None = None
    edges: list[Edge] | None = None
    variables: dict[str, Any] | None = None
    tags: list[str] | None = None
    nodeTemplates: list[dict[str, Any]] | None = None  # Update node templates


class Workflow(Document):
    """Complete workflow model - Beanie Document"""

    workflowId: str  # Will be indexed via Settings
    name: str
    description: str | None = None
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    variables: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    collectionId: str | None = None  # Link to collection
    environmentId: str | None = None  # Link to environment (default environment for workflow)
    nodeTemplates: list[dict[str, Any]] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime
    version: int = 1

    class Settings:
        name = "workflows"  # MongoDB collection name
        indexes = [
            IndexModel([("workflowId", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)]),
            IndexModel([("collectionId", ASCENDING)]),
            IndexModel([("environmentId", ASCENDING)]),
            IndexModel([("tags", ASCENDING)]),
        ]


class RunCreate(BaseModel):
    """Request model for triggering a workflow run"""

    workflowId: str
    variables: dict[str, Any] | None = None  # Override workflow variables
    callbackUrl: str | None = None  # For CI/CD integration


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
    """Workflow run/execution - Beanie Document"""

    runId: str
    workflowId: str
    environmentId: str | None = None  # Environment to use for this run
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
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

    class Settings:
        name = "runs"
        indexes = [
            IndexModel([("runId", ASCENDING)], unique=True),
            IndexModel([("status", ASCENDING), ("createdAt", ASCENDING)]),
            IndexModel([("workflowId", ASCENDING)]),
            IndexModel([("environmentId", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class PaginatedWorkflows(BaseModel):
    """Paginated workflows response"""

    workflows: list[Workflow]
    total: int
    skip: int
    limit: int
    hasMore: bool


class EnvironmentCreate(BaseModel):
    """Request model for creating an environment"""

    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)  # NEW: Secrets


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


class Collection(Document):
    """Collection model - groups workflows together - Beanie Document"""

    collectionId: str
    name: str
    description: str | None = None
    color: str | None = None  # e.g., #FF5733
    workflowCount: int = 0

    # NEW: Ordered execution configuration
    workflowOrder: list[WorkflowOrderItem] = Field(default_factory=list)
    continueOnFail: bool = True  # Default: show all results, don't stop at first failure

    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "collections"
        indexes = [
            IndexModel([("collectionId", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class EnvironmentUpdate(BaseModel):
    """Request model for updating an environment"""

    name: str | None = None
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] | None = None
    secrets: dict[str, str] | None = None  # NEW: Secrets
    isActive: bool | None = None


class Environment(Document):
    """Environment model with variables and secrets - Beanie Document"""

    environmentId: str
    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str] = Field(default_factory=dict)  # Secrets for this environment
    isActive: bool = False
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "environments"
        indexes = [
            IndexModel([("environmentId", ASCENDING)], unique=True),
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


# ============================================================================
# CI/CD Webhook Models
# ============================================================================


class Webhook(Document):
    """
    Webhook for CI/CD integration

    Provides stable URL for workflow/collection execution
    that remains valid even when resource is edited.
    """

    webhookId: str  # e.g., "wh-abc123xyz789"

    # Resource binding (workflow or collection)
    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId

    # Environment binding
    environmentId: str

    # Authentication (shown only once!)
    token: str  # Webhook token for X-Webhook-Token header
    hmacSecret: str  # HMAC secret for signature validation

    # Configuration
    enabled: bool = True
    description: str | None = None

    # Metadata
    createdAt: datetime
    createdBy: str | None = None  # userId
    updatedAt: datetime

    # Usage tracking
    lastUsed: datetime | None = None
    usageCount: int = 0
    lastStatus: Literal["success", "failure", "validation_error"] | None = None

    class Settings:
        name = "webhooks"
        indexes = [
            IndexModel([("webhookId", ASCENDING)], unique=True),
            IndexModel([("resourceType", ASCENDING), ("resourceId", ASCENDING)]),
            IndexModel([("environmentId", ASCENDING)]),
            IndexModel([("token", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class CollectionRun(Document):
    """Aggregate results from collection execution"""

    collectionRunId: str  # e.g., "col-run-abc123"
    collectionId: str
    collectionName: str

    # Execution status
    status: Literal["pending", "running", "completed", "failed"]
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


class WebhookLog(Document):
    """Track webhook execution history (auto-expires after 30 days)"""

    logId: str  # e.g., "log-abc123"
    webhookId: str

    # Execution details
    timestamp: datetime
    status: Literal["success", "failure", "validation_error"]
    duration: int  # milliseconds

    # Request information
    requestHeaders: dict[str, str] = Field(default_factory=dict)
    requestBody: str | None = None
    ipAddress: str | None = None

    # Response information
    responseStatus: int
    responseBody: str | None = None
    errorMessage: str | None = None

    # Run tracking
    runId: str | None = None  # For workflow runs
    collectionRunId: str | None = None  # For collection runs

    class Settings:
        name = "webhook_logs"
        indexes = [
            IndexModel([("webhookId", ASCENDING), ("timestamp", DESCENDING)]),
            IndexModel([("timestamp", ASCENDING)], expireAfterSeconds=2592000),  # 30 days TTL
        ]


# Request/Response models for Webhooks


class WebhookCreate(BaseModel):
    """Request model for creating a webhook"""

    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId
    environmentId: str
    description: str | None = None


class WebhookUpdate(BaseModel):
    """Request model for updating a webhook"""

    environmentId: str | None = None
    enabled: bool | None = None
    description: str | None = None
