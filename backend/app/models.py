"""
Data models for APIWeave
Pydantic models for workflows, nodes, edges, and runs
"""
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Literal
from datetime import datetime


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
    label: str
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


class WorkflowUpdate(BaseModel):
    """Request model for updating a workflow"""
    name: Optional[str] = None
    description: Optional[str] = None
    nodes: Optional[List[Node]] = None
    edges: Optional[List[Edge]] = None
    variables: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None


class Workflow(BaseModel):
    """Complete workflow model"""
    workflowId: str
    name: str
    description: Optional[str] = None
    nodes: List[Node]
    edges: List[Edge]
    variables: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    collectionId: Optional[str] = None  # NEW: Link to collection (replaces environmentId)
    createdAt: datetime
    updatedAt: datetime
    version: int = 1


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


class Run(BaseModel):
    """Workflow run/execution"""
    runId: str
    workflowId: str
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


class Collection(BaseModel):
    """Collection model - groups workflows together"""
    collectionId: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = None  # e.g., #FF5733
    workflowCount: int = 0
    createdAt: datetime
    updatedAt: datetime


class EnvironmentUpdate(BaseModel):
    """Request model for updating an environment"""
    name: Optional[str] = None
    description: Optional[str] = None
    variables: Optional[Dict[str, Any]] = None
    secrets: Optional[Dict[str, str]] = None  # NEW: Secrets
    isActive: Optional[bool] = None


class Environment(BaseModel):
    """Environment model with variables and secrets"""
    environmentId: str
    name: str
    description: Optional[str] = None
    variables: Dict[str, Any] = Field(default_factory=dict)
    secrets: Dict[str, str] = Field(default_factory=dict)  # NEW: Secrets for this environment
    isActive: bool = False
    createdAt: datetime
    updatedAt: datetime
