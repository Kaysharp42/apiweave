"""
Data models for APIWeave
Pydantic models for workflows, nodes, edges, and runs
Now using Beanie ODM for type-safe MongoDB operations
"""
from beanie import Document
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Literal, Annotated
from datetime import datetime
from pymongo import IndexModel, ASCENDING, DESCENDING


class FileUpload(BaseModel):
    """File attachment for HTTP request node"""
    name: str  # Unique identifier in node
    type: Literal["path", "base64", "variable"]  # How file is referenced
    value: str  # File path, base64 string, or variable reference
    fieldName: str  # HTML form field name for multipart request
    mimeType: str = "application/octet-stream"  # Content-Type header
    description: Optional[str] = None  # Human-readable description


class HTTPRequestNode(BaseModel):
    """HTTP Request node configuration"""
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[str] = None
    timeout: int = 30
    followRedirects: bool = True
    extractors: Dict[str, str] = Field(default_factory=dict)  # JSONPath extractors
    fileUploads: List[FileUpload] = Field(default_factory=list)  # NEW: File attachments


class AssertionNode(BaseModel):
    """Assertion node configuration"""
    assertions: List[Dict[str, Any]] = Field(default_factory=list)
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
    conditions: List[Dict[str, Any]] = Field(default_factory=list)
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
    label: Optional[str] = None  # Optional: Display label for the node
    position: Dict[str, float] = Field(default_factory=dict)  # {x: float, y: float}
    config: Optional[Dict[str, Any]] = None  # Node-specific configuration


class Edge(BaseModel):
    """Workflow edge (connection between nodes)"""
    edgeId: str
    source: str  # source nodeId
    target: str  # target nodeId
    sourceHandle: Optional[str] = None  # Handle ID on source node (e.g., "pass", "fail" for assertion)
    targetHandle: Optional[str] = None  # Handle ID on target node
    label: Optional[str] = None  # For conditional edges: "Pass", "Fail", "Branch N"


class WorkflowCreate(BaseModel):
    """Request model for creating a workflow"""
    name: str
    description: Optional[str] = None
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
    variables: Dict[str, Any] = Field(default_factory=dict)  # Environment variables
    tags: List[str] = Field(default_factory=list)
    nodeTemplates: List[Dict[str, Any]] = Field(default_factory=list)  # Imported node templates for Add Nodes panel
    collectionId: Optional[str] = None  # Optional: Link to collection


class WorkflowUpdate(BaseModel):
    """Request model for updating a workflow"""
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Node]] = None
    edges: Optional[List[Edge]] = None
    variables: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    nodeTemplates: Optional[List[Dict[str, Any]]] = None  # Update node templates


class Workflow(Document):
    """Complete workflow model - Beanie Document"""
    workflowId: str  # Will be indexed via Settings
    name: str
    description: Optional[str] = None
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
    variables: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    collectionId: Optional[str] = None  # Link to collection
    environmentId: Optional[str] = None  # Link to environment (default environment for workflow)
    nodeTemplates: List[Dict[str, Any]] = Field(default_factory=list)
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
            IndexModel([("tags", ASCENDING)])
        ]


class RunCreate(BaseModel):
    """Request model for triggering a workflow run"""
    workflowId: str
    variables: Optional[Dict[str, Any]] = None  # Override workflow variables
    callbackUrl: Optional[str] = None  # For CI/CD integration


class RunResult(BaseModel):
    """Result of a single node execution"""
    nodeId: str
    status: Literal["passed", "failed", "skipped"]
    duration: int  # milliseconds
    request: Optional[Dict[str, Any]] = None
    response: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    assertions: Optional[List[Dict[str, Any]]] = None


class Run(Document):
    """Workflow run/execution - Beanie Document"""
    runId: str
    workflowId: str
    environmentId: Optional[str] = None  # Environment to use for this run
    status: Literal["pending", "running", "completed", "failed", "cancelled"]
    trigger: Literal["manual", "webhook", "schedule"]
    variables: Dict[str, Any] = Field(default_factory=dict)
    callbackUrl: Optional[str] = None
    results: List[RunResult] = Field(default_factory=list)
    createdAt: datetime
    startedAt: Optional[datetime] = None
    completedAt: Optional[datetime] = None
    duration: Optional[int] = None  # milliseconds
    error: Optional[str] = None
    failedNodes: Optional[List[str]] = None  # List of node IDs that failed
    failureMessage: Optional[str] = None  # Summary of failures
    nodeStatuses: Dict[str, Any] = Field(default_factory=dict)  # Node execution statuses
    
    class Settings:
        name = "runs"
        indexes = [
            IndexModel([("runId", ASCENDING)], unique=True),
            IndexModel([("status", ASCENDING), ("createdAt", ASCENDING)]),
            IndexModel([("workflowId", ASCENDING)]),
            IndexModel([("environmentId", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)])
        ]


class PaginatedWorkflows(BaseModel):
    """Paginated workflows response"""
    workflows: List[Workflow]
    total: int
    skip: int
    limit: int
    hasMore: bool


class EnvironmentCreate(BaseModel):
    """Request model for creating an environment"""
    name: str
    description: Optional[str] = None
    swaggerDocUrl: Optional[str] = None
    variables: Dict[str, Any] = Field(default_factory=dict)
    secrets: Dict[str, str] = Field(default_factory=dict)  # NEW: Secrets


class WorkflowOrderItem(BaseModel):
    """Defines execution order for workflows in a collection"""
    workflowId: str
    order: int  # 0, 1, 2, ...
    enabled: bool = True
    continueOnFail: bool = True  # Default: continue to show all results


class CollectionCreate(BaseModel):
    """Request model for creating a collection"""
    name: str
    description: Optional[str] = None
    color: Optional[str] = None  # Hex color for UI display


class CollectionUpdate(BaseModel):
    """Request model for updating a collection"""
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


class Collection(Document):
    """Collection model - groups workflows together - Beanie Document"""
    collectionId: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None  # e.g., #FF5733
    workflowCount: int = 0
    
    # NEW: Ordered execution configuration
    workflowOrder: List[WorkflowOrderItem] = Field(default_factory=list)
    continueOnFail: bool = True  # Default: show all results, don't stop at first failure
    
    createdAt: datetime
    updatedAt: datetime
    
    class Settings:
        name = "collections"
        indexes = [
            IndexModel([("collectionId", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)])
        ]


class EnvironmentUpdate(BaseModel):
    """Request model for updating an environment"""
    name: Optional[str] = None
    description: Optional[str] = None
    swaggerDocUrl: Optional[str] = None
    variables: Optional[Dict[str, Any]] = None
    secrets: Optional[Dict[str, str]] = None  # NEW: Secrets
    isActive: Optional[bool] = None


class Environment(Document):
    """Environment model with variables and secrets - Beanie Document"""
    environmentId: str
    name: str
    description: Optional[str] = None
    swaggerDocUrl: Optional[str] = None
    variables: Dict[str, Any] = Field(default_factory=dict)
    secrets: Dict[str, str] = Field(default_factory=dict)  # Secrets for this environment
    isActive: bool = False
    createdAt: datetime
    updatedAt: datetime
    
    class Settings:
        name = "environments"
        indexes = [
            IndexModel([("environmentId", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)])
        ]


class CollectionImportRequest(BaseModel):
    """Request model for importing a collection bundle"""
    bundle: Dict[str, Any]
    createNewCollection: bool = True
    newCollectionName: Optional[str] = None
    targetCollectionId: Optional[str] = None
    environmentMapping: Optional[Dict[str, str]] = None


class CollectionImportDryRunRequest(BaseModel):
    """Request model for validating a collection bundle"""
    bundle: Dict[str, Any]
    createNewCollection: bool = True
    targetCollectionId: Optional[str] = None


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
    description: Optional[str] = None
    
    # Metadata
    createdAt: datetime
    createdBy: Optional[str] = None  # userId
    updatedAt: datetime
    
    # Usage tracking
    lastUsed: Optional[datetime] = None
    usageCount: int = 0
    lastStatus: Optional[Literal["success", "failure", "validation_error"]] = None
    
    class Settings:
        name = "webhooks"
        indexes = [
            IndexModel([("webhookId", ASCENDING)], unique=True),
            IndexModel([("resourceType", ASCENDING), ("resourceId", ASCENDING)]),
            IndexModel([("environmentId", ASCENDING)]),
            IndexModel([("token", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)])
        ]


class CollectionRun(Document):
    """Aggregate results from collection execution"""
    collectionRunId: str  # e.g., "col-run-abc123"
    collectionId: str
    collectionName: str
    
    # Execution status
    status: Literal["pending", "running", "completed", "failed"]
    startTime: datetime
    endTime: Optional[datetime] = None
    duration: Optional[int] = None  # milliseconds
    
    # Environment
    environmentId: Optional[str] = None
    
    # Results summary
    totalWorkflows: int
    executedWorkflows: int = 0
    passedWorkflows: int = 0
    failedWorkflows: int = 0
    
    # Individual workflow results (in execution order)
    workflowResults: List[Dict[str, Any]] = Field(default_factory=list)
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
    webhookId: Optional[str] = None
    triggeredBy: Optional[str] = None  # "webhook" or userId
    
    class Settings:
        name = "collection_runs"
        indexes = [
            IndexModel([("collectionRunId", ASCENDING)], unique=True),
            IndexModel([("collectionId", ASCENDING), ("startTime", DESCENDING)]),
            IndexModel([("webhookId", ASCENDING)]),
            IndexModel([("status", ASCENDING)])
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
    requestHeaders: Dict[str, str] = Field(default_factory=dict)
    requestBody: Optional[str] = None
    ipAddress: Optional[str] = None
    
    # Response information
    responseStatus: int
    responseBody: Optional[str] = None
    errorMessage: Optional[str] = None
    
    # Run tracking
    runId: Optional[str] = None  # For workflow runs
    collectionRunId: Optional[str] = None  # For collection runs
    
    class Settings:
        name = "webhook_logs"
        indexes = [
            IndexModel([("webhookId", ASCENDING), ("timestamp", DESCENDING)]),
            IndexModel([("timestamp", ASCENDING)], expireAfterSeconds=2592000)  # 30 days TTL
        ]


# Request/Response models for Webhooks

class WebhookCreate(BaseModel):
    """Request model for creating a webhook"""
    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId
    environmentId: str
    description: Optional[str] = None


class WebhookUpdate(BaseModel):
    """Request model for updating a webhook"""
    environmentId: Optional[str] = None
    enabled: Optional[bool] = None
    description: Optional[str] = None

