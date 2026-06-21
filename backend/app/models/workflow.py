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
    collectionId: str | None = None  # Link to collection/project (legacy)
    selectedEnvironmentId: str | None = None  # Scoped environment selection
    environmentId: str | None = None  # Legacy field, kept for migration
    nodeTemplates: list[dict[str, Any]] = Field(default_factory=list)
    workspaceId: str | None = None
    orgId: str | None = None
    ownerType: str | None = None  # "user" | "organization"
    createdAt: datetime
    updatedAt: datetime
    version: int = 1

    class Settings:
        name = "workflows"  # MongoDB collection name
        indexes = [
            IndexModel([("workflowId", ASCENDING)], unique=True),
            IndexModel([("createdAt", DESCENDING)]),
            IndexModel([("collectionId", ASCENDING)]),
            IndexModel([("selectedEnvironmentId", ASCENDING)]),
            IndexModel([("workspaceId", ASCENDING)]),
            IndexModel([("orgId", ASCENDING)]),
            IndexModel([("tags", ASCENDING)]),
        ]


class PaginatedWorkflows(BaseModel):
    """Paginated workflows response"""

    workflows: list[Workflow]
    total: int
    skip: int
    limit: int
    hasMore: bool
