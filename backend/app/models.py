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


class HTTPRequestNode(BaseModel):
    """HTTP Request node configuration"""
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    url: str
    headers: Dict[str, str] = Field(default_factory=dict)
    body: Optional[str] = None
    timeout: int = 30
    followRedirects: bool = True
    extractors: Dict[str, str] = Field(default_factory=dict)  # JSONPath extractors


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
    label: Optional[str] = None  # For conditional edges: "true", "false"


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
    variables: Dict[str, Any] = Field(default_factory=dict)
    secrets: Dict[str, str] = Field(default_factory=dict)  # NEW: Secrets


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
    variables: Optional[Dict[str, Any]] = None
    secrets: Optional[Dict[str, str]] = None  # NEW: Secrets
    isActive: Optional[bool] = None


class Environment(Document):
    """Environment model with variables and secrets - Beanie Document"""
    environmentId: str
    name: str
    description: Optional[str] = None
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

