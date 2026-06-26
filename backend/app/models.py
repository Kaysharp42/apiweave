"""
Data models for APIWeave
Pydantic models for workflows, nodes, edges, and runs
Now using Beanie ODM for type-safe MongoDB operations
"""

import base64
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from beanie import Document
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo import ASCENDING, DESCENDING, IndexModel

# ============================================================================
# Enums for GitHub-style multi-tenant architecture
# ============================================================================


class OrgMemberRole(StrEnum):
    """Organization membership roles (GitHub-like)."""

    OWNER = "owner"
    MEMBER = "member"
    BILLING = "billing"
    SECURITY = "security"


class WorkspaceRole(StrEnum):
    """Workspace membership roles (GitHub repository roles)."""

    READ = "read"
    TRIAGE = "triage"
    WRITE = "write"
    MAINTAIN = "maintain"
    ADMIN = "admin"


class OwnerType(StrEnum):
    """Owner type for scoped resources."""

    USER = "user"
    ORGANIZATION = "organization"


class SecretScope(StrEnum):
    """Secret scope for GitHub-like override chain."""

    USER = "user"
    ORGANIZATION = "organization"
    WORKSPACE = "workspace"
    ENVIRONMENT = "environment"


# ============================================================================
# Pydantic helpers for scoped references
# ============================================================================


class ScopedEnvRef(BaseModel):
    """Reference to a scoped environment for run selection."""

    scopeType: Literal["user", "organization", "workspace"]
    scopeId: str
    environmentId: str


class EnvironmentProtectionPolicy(BaseModel):
    """Protection policy for a scoped environment."""

    requiredReviewers: list[str] = Field(default_factory=list)  # userIds
    allowSelfApproval: bool = False
    bypassPolicy: Literal["none", "trusted_token_only"] = "none"
    bypassAllowlist: list[str] = Field(default_factory=list)  # serviceTokenIds


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
    """Workflow run/execution - Beanie Document

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


class PaginatedWorkflows(BaseModel):
    """Paginated workflows response"""

    workflows: list[Workflow]
    total: int
    skip: int
    limit: int
    hasMore: bool


# ============================================================================
# Encryption Models (T1 — AES-256-GCM envelope encryption)
# ============================================================================


class EncryptedBlob(BaseModel):
    """
    Encrypted secret value stored in Environment.secrets.

    Serialized as a dict in MongoDB with base64-encoded binary fields.
    The ``kek_id`` routes decryption to the correct DEK, enabling
    multi-key rotation without data migration.
    """

    ciphertext: str  # base64-encoded AES-256-GCM ciphertext+tag
    kek_id: str  # ID of the KEK that wrapped the DEK used for encryption
    algorithm: str  # e.g. "aes-256-gcm"
    nonce: str  # base64-encoded 12-byte nonce

    @field_validator("ciphertext", "nonce", mode="before")
    @classmethod
    def _encode_bytes_to_base64(cls, v: Any) -> Any:
        """Accept raw bytes on construction and encode to base64 str."""
        if isinstance(v, (bytes, bytearray)):
            return base64.b64encode(v).decode("ascii")
        return v

    def get_ciphertext_bytes(self) -> bytes:
        """Decode the base64 ciphertext to raw bytes."""
        return base64.b64decode(self.ciphertext)

    def get_nonce_bytes(self) -> bytes:
        """Decode the base64 nonce to raw bytes."""
        return base64.b64decode(self.nonce)


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


# Backward compatibility alias — existing code imports Collection
Collection = Project


class EnvironmentUpdate(BaseModel):
    """Request model for updating an environment"""

    name: str | None = None
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] | None = None
    secrets: dict[str, Any] | None = None  # NEW: Secrets


class Environment(Document):
    """Environment model with variables and secrets - Beanie Document

    Scoped to user, organization, or workspace. No global isActive.
    Each workspace has exactly one default environment (isDefault=True).
    Organization environments can restrict access via allowedWorkspaceIds.
    """

    environmentId: str
    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any] = Field(default_factory=dict)  # str (legacy) or EncryptedBlob dict
    scopeType: Literal["user", "organization", "workspace"] = "user"
    scopeId: str | None = None  # userId, orgId, or workspaceId
    ownerType: str | None = None  # "user" | "organization"
    isDefault: bool = False  # True for the default workspace environment
    allowedWorkspaceIds: list[str] = Field(
        default_factory=list
    )  # Org env policy: which workspaces can use this env
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "environments"
        indexes = [
            IndexModel([("environmentId", ASCENDING)], unique=True),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("isDefault", ASCENDING)]
            ),
            IndexModel([("createdAt", DESCENDING)]),
        ]


class ScopedEnvironmentCreate(BaseModel):
    """Request model for creating a scoped environment."""

    name: str
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] = Field(default_factory=dict)
    allowedWorkspaceIds: list[str] = Field(default_factory=list)  # Org env policy


class ScopedEnvironmentUpdate(BaseModel):
    """Request model for updating a scoped environment."""

    name: str | None = None
    description: str | None = None
    swaggerDocUrl: str | None = None
    variables: dict[str, Any] | None = None
    allowedWorkspaceIds: list[str] | None = None  # Org env policy


class RunEnvironmentSelection(BaseModel):
    """Resolved environment selection for a run.

    Each run selects exactly one environment. If no explicit environment
    is provided, the workspace default is used.
    """

    environmentId: str
    scopeType: str  # "user" | "organization" | "workspace"
    scopeId: str
    name: str


class EnvironmentProtectionUpdate(BaseModel):
    """Request model for updating environment protection config."""

    requiredReviewers: list[str] | None = None
    allowSelfApproval: bool | None = None
    bypassPolicy: Literal["none", "trusted_token_only"] | None = None
    bypassAllowlist: list[str] | None = None


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

    Webhooks execute as scoped actors (WebhookTokenActor) — NOT as the
    webhook creator's current user permissions. The workspaceId/scopeType/
    scopeId fields bind the webhook to a specific workspace scope.
    """

    webhookId: str  # e.g., "wh-abc123xyz789"

    # Resource binding (workflow or collection)
    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId

    # Environment binding
    environmentId: str

    # Scoped ownership (webhook actor scope)
    workspaceId: str | None = None
    scopeType: str = "workspace"  # "workspace" | "organization"
    scopeId: str | None = None  # workspaceId or orgId

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
            IndexModel([("workspaceId", ASCENDING)]),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel([("createdAt", DESCENDING)]),
        ]


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


class WebhookLog(Document):
    """Track webhook execution history (auto-expires after 30 days)"""

    logId: str  # e.g., "log-abc123"
    webhookId: str

    # Execution details
    timestamp: datetime
    status: Literal["success", "failure", "validation_error"]
    duration: int  # milliseconds

    # Request information
    httpMethod: str | None = None
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


class RateLimitCounter(Document):
    """Fixed-window rate-limit counter shared across API instances.

    One document per (key, windowStart); the count is incremented atomically so
    a multi-instance deployment shares a single effective limit (roadmap §3.7,
    P1.8). A TTL index expires stale windows. Used only when
    RATE_LIMITER_BACKEND=mongodb; the default memory backend is process-local.
    """

    key: str  # e.g. "webhook:<webhookId>"
    windowStart: int  # unix epoch seconds at the start of the window
    hits: int = 0  # not "count" — that shadows Document.count
    expires_at: datetime

    class Settings:
        name = "rate_limit_counters"
        indexes = [
            IndexModel([("key", ASCENDING), ("windowStart", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
        ]


class IdempotencyKey(Document):
    webhookId: str
    idempotencyKey: str
    runId: str
    collectionRunId: str | None = None
    statusCode: int
    responseBody: dict[str, Any]
    expires_at: datetime

    class Settings:
        name = "idempotency_keys"
        indexes = [
            IndexModel([("webhookId", ASCENDING), ("idempotencyKey", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=86400),
        ]


# Request/Response models for Webhooks


class WebhookCreate(BaseModel):
    """Request model for creating a webhook"""

    resourceType: Literal["workflow", "collection"]
    resourceId: str  # workflowId or collectionId
    environmentId: str
    workspaceId: str | None = None  # Scoped workspace binding
    description: str | None = None


class WebhookUpdate(BaseModel):
    """Request model for updating a webhook"""

    environmentId: str | None = None
    enabled: bool | None = None
    description: str | None = None


# ============================================================================
# Auth Models
# ============================================================================


class OAuthAccount(BaseModel):
    """
    Embedded OAuth provider account linked to a User.

    Stored directly on the User document for fast access — no JOIN needed
    to check whether a user has linked accounts.
    """

    provider: str  # "github" | "gitlab" | "microsoft" | "google" | "local"
    providerSubject: str  # Provider-issued unique subject ID
    linkedAt: datetime  # When the account was linked
    emailVerified: bool = True  # Always True — unverified emails rejected at intake


class User(Document):
    """
    Authenticated human user.

    verified_email is the canonical linking key — only verified provider emails
    are stored here. Raw OAuth tokens are never persisted.
    """

    userId: str
    verified_email: str
    display_name: str | None = None
    avatar_url: str | None = None
    roles: list[str] = Field(default_factory=list)  # e.g. ["admin"]
    permissions: list[str] = Field(default_factory=list)  # e.g. ["collections:write"]
    oauth_accounts: list[OAuthAccount] = Field(default_factory=list)
    is_setup_complete: bool = False
    created_at: datetime
    updated_at: datetime

    class Settings:
        name = "users"
        indexes = [
            IndexModel([("userId", ASCENDING)], unique=True),
            IndexModel([("verified_email", ASCENDING)], unique=True),
            IndexModel([("created_at", DESCENDING)]),
            IndexModel(
                [
                    ("oauth_accounts.provider", ASCENDING),
                    ("oauth_accounts.providerSubject", ASCENDING),
                ],
                unique=True,
                partialFilterExpression={
                    "oauth_accounts.0": {"$exists": True},
                },
            ),
        ]


class DeletedUser(Document):
    """Blocklist for deleted users to prevent re-creation via OAuth."""

    userId: str
    verified_email: str
    deleted_at: datetime

    class Settings:
        name = "deleted_users"
        indexes = [
            IndexModel([("userId", ASCENDING)], unique=True),
            IndexModel([("verified_email", ASCENDING)], unique=True),
        ]


class ProviderIdentity(Document):
    """
    OAuth provider identity linked to a User.

    Compound unique index on (provider, subject) prevents duplicate logins
    from the same provider account. Only verified emails are stored.
    """

    identityId: str
    userId: str  # str reference to User.userId
    provider: str  # "github" | "gitlab" | "microsoft" | "google"
    subject: str  # Provider-issued unique subject ID
    email: str  # Verified email from provider
    verified: bool = True  # Always True — unverified emails are rejected at intake

    class Settings:
        name = "provider_identities"
        indexes = [
            IndexModel([("identityId", ASCENDING)], unique=True),
            IndexModel([("provider", ASCENDING), ("subject", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
            IndexModel([("email", ASCENDING)]),
        ]


class Session(Document):
    """
    Server-side session for an authenticated user.

    expires_at carries a TTL index so MongoDB auto-deletes expired sessions.
    last_seen_at is updated on each request for idle-timeout enforcement.
    """

    sessionId: str
    userId: str  # str reference to User.userId
    token_hash: str  # SHA-256 hash of the opaque session token — raw token never stored
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime  # Absolute expiry (7d); TTL index on this field
    revoked: bool = False

    class Settings:
        name = "sessions"
        indexes = [
            IndexModel([("sessionId", ASCENDING)], unique=True),
            IndexModel([("token_hash", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),  # TTL
        ]


class Invite(Document):
    """
    Email invitation to join APIWeave.

    token_hash stores a bcrypt/sha256 hash of the one-time invite token.
    The raw token is shown once and never persisted.
    expires_at carries a TTL index for automatic cleanup.
    """

    inviteId: str
    email: str
    token_hash: str  # Hash of one-time token — raw token never stored
    role_preset: str  # "viewer" | "editor" | "admin"
    created_by: str  # userId of inviting admin
    created_at: datetime
    expires_at: datetime  # TTL index on this field
    consumed_at: datetime | None = None
    consumed: bool = False
    invite_url: str | None = None

    class Settings:
        name = "invites"
        indexes = [
            IndexModel([("inviteId", ASCENDING)], unique=True),
            IndexModel([("email", ASCENDING)]),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),  # TTL
        ]


class ApprovedDomain(Document):
    """
    Email domain approved for self-signup SSO.

    Users whose verified provider email matches an approved domain can
    register without an explicit invite.
    """

    domainId: str
    domain: str  # e.g. "example.com"
    created_by: str  # userId of admin who approved the domain
    created_at: datetime

    class Settings:
        name = "approved_domains"
        indexes = [
            IndexModel([("domainId", ASCENDING)], unique=True),
            IndexModel([("domain", ASCENDING)], unique=True),
        ]


class OAuthState(Document):
    """
    Short-lived OAuth state for CSRF protection and PKCE.

    Stores the state parameter, PKCE code_verifier, and OIDC nonce for the
    duration of the OAuth redirect flow. expires_at TTL index auto-deletes
    stale states (typically after 10 minutes).
    """

    stateId: str
    state: str  # Random state parameter sent to provider
    code_verifier: str  # PKCE code_verifier (S256 challenge sent to provider)
    nonce: str  # OIDC nonce for ID token validation
    provider: str  # "github" | "gitlab" | "microsoft" | "google"
    redirect_uri: str | None = None
    invite_token: str | None = None
    expires_at: datetime  # TTL index — typically now + 10 minutes

    class Settings:
        name = "oauth_states"
        indexes = [
            IndexModel([("stateId", ASCENDING)], unique=True),
            IndexModel([("state", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),  # TTL
        ]


class EncryptionKey(Document):
    """
    Key encryption key record for envelope encryption.

    Stores a DEK (data encryption key) wrapped by the master KEK from
    ``SECRET_ENCRYPTION_KEY``.  Multiple records support key rotation:
    old blobs decrypt via their ``kek_id``; new writes use the active KEK.
    """

    kek_id: str
    wrapped_dek: str  # base64-encoded nonce(12) + AESGCM(master_kek, dek)
    algorithm: str = "aes-256-gcm"
    created_at: datetime
    is_active: bool = True

    class Settings:
        name = "encryption_keys"
        indexes = [
            IndexModel([("kek_id", ASCENDING)], unique=True),
            IndexModel([("is_active", ASCENDING)]),
        ]


# ============================================================================
# Scoped Keypair Models (GitHub-style per-scope Libsodium keypairs)
# ============================================================================


class ScopedKeypair(Document):
    """
    Per-scope Libsodium Curve25519 keypair for sealed-box secret encryption.

    Each scope (user, organization, workspace, environment) has an active
    keypair whose public key is served to clients for encrypting secret
    values before POST.  The private key is encrypted at rest using the
    master KEK derived from ``SECRET_ENCRYPTION_KEY``.

    On rotation the old keypair is marked inactive but retained so that
    previously encrypted ciphertexts can still be decrypted by the trusted
    runtime resolver.

    The compound unique index on (scopeType, scopeId, keyId) ensures that
    each key version for a scope is unique.
    """

    scopeType: Literal["user", "organization", "workspace", "environment"]
    scopeId: str
    publicKey: str  # base64-encoded Curve25519 public key
    privateKey: str  # base64-encoded encrypted private key (at rest)
    algorithm: str = "libsodium-sealed-box"
    keyId: str  # unique key version identifier, e.g. "kp-<timestamp>"
    isActive: bool = True
    createdAt: datetime
    rotatedAt: datetime | None = None

    class Settings:
        name = "scoped_keypairs"
        indexes = [
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("keyId", ASCENDING)],
                unique=True,
            ),
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("isActive", ASCENDING)],
            ),
        ]


class PublicKeyResponse(BaseModel):
    """Public key metadata returned by the GET public-key endpoint."""

    keyId: str
    publicKey: str
    algorithm: str


# ============================================================================
# Auth Response DTOs (redacted — no sensitive fields)
# ============================================================================


class UserResponse(BaseModel):
    """
    Public user representation.

    Does NOT include internal fields. Safe to return in API responses.
    """

    userId: str
    verified_email: str
    display_name: str | None = None
    avatar_url: str | None = None
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    oauth_accounts: list[OAuthAccount] = Field(default_factory=list)
    is_setup_complete: bool
    created_at: datetime


class SessionResponse(BaseModel):
    """
    Session metadata returned after login.

    Does NOT include any raw session token — the token is delivered via
    HttpOnly cookie only and never echoed in the response body.
    """

    sessionId: str
    userId: str
    created_at: datetime
    expires_at: datetime
    last_seen_at: datetime


class InviteResponse(BaseModel):
    """
    Invite metadata returned to admins.

    token_hash is intentionally excluded. The invite URL (containing the
    one-time token) is included only at creation time via a separate
    one-time response shape.
    """

    inviteId: str
    email: str
    role_preset: str
    created_by: str
    created_at: datetime
    expires_at: datetime
    consumed: bool
    consumed_at: datetime | None = None
    invite_url: str | None = None


# ============================================================================
# Audit Event Model (Append-Only)
# ============================================================================

# Actor types that can produce audit events
AuditActorType = Literal[
    "user",
    "org_app",
    "service_token",
    "mcp_client",
    "webhook_token",
    "system_migration",
]

# Scope types for audit events
AuditScopeType = Literal[
    "org",
    "workspace",
    "environment",
]


class AuditEvent(Document):
    """
    Append-only audit event.

    Records every significant action in the system with full context.
    NEVER stores secret values, ciphertext, or private keys.
    The repository layer exposes only append and query — no update or delete.
    """

    eventId: str
    actor: AuditActorType
    actorId: str
    action: str
    scope: AuditScopeType
    scopeId: str
    resourceType: str
    resourceId: str
    context: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime

    class Settings:
        name = "audit_events"
        indexes = [
            IndexModel(
                [("actor", ASCENDING), ("actorId", ASCENDING), ("eventId", ASCENDING)], unique=True
            ),
            IndexModel([("createdAt", DESCENDING)]),
            IndexModel([("action", ASCENDING)]),
            IndexModel([("scope", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel([("resourceType", ASCENDING), ("resourceId", ASCENDING)]),
        ]


class AuditEventCreate(BaseModel):
    """Request model for creating an audit event."""

    actor: AuditActorType
    actorId: str
    action: str
    scope: AuditScopeType
    scopeId: str
    resourceType: str
    resourceId: str
    context: dict[str, Any] = Field(default_factory=dict)


class AuditEventResponse(BaseModel):
    """
    Audit event returned in API responses.
    Safe to expose — contains no secret values.
    """

    model_config = ConfigDict(from_attributes=True)

    eventId: str
    actor: AuditActorType
    actorId: str
    action: str
    scope: AuditScopeType
    scopeId: str
    resourceType: str
    resourceId: str
    context: dict[str, Any] = Field(default_factory=dict)
    createdAt: datetime


# ============================================================================
# GitHub-Style Multi-Tenant Models
# ============================================================================


class Organization(Document):
    orgId: str
    slug: str
    name: str
    description: str | None = None
    avatarUrl: str | None = None
    ownerUserId: str
    createdAt: datetime
    updatedAt: datetime
    deletedAt: datetime | None = None

    class Settings:
        name = "organizations"
        indexes = [
            IndexModel([("orgId", ASCENDING)], unique=True),
            IndexModel([("slug", ASCENDING)], unique=True),
            IndexModel([("ownerUserId", ASCENDING)]),
        ]


class OrganizationMember(Document):
    memberId: str
    orgId: str
    userId: str
    role: str  # OrgMemberRole value
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "organization_members"
        indexes = [
            IndexModel([("memberId", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class Team(Document):
    teamId: str
    orgId: str
    slug: str
    name: str
    description: str | None = None
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "teams"
        indexes = [
            IndexModel([("teamId", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING), ("slug", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING)]),
        ]


class TeamMember(Document):
    memberId: str
    teamId: str
    userId: str
    role: str = "member"
    createdAt: datetime

    class Settings:
        name = "team_members"
        indexes = [
            IndexModel([("memberId", ASCENDING)], unique=True),
            IndexModel([("teamId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class Workspace(Document):
    workspaceId: str
    slug: str
    name: str
    description: str | None = None
    ownerType: str  # "user" | "organization"
    ownerUserId: str | None = None
    orgId: str | None = None
    isPersonal: bool = False
    createdAt: datetime
    updatedAt: datetime
    deletedAt: datetime | None = None

    class Settings:
        name = "workspaces"
        indexes = [
            IndexModel([("workspaceId", ASCENDING)], unique=True),
            IndexModel(
                [("ownerType", ASCENDING), ("ownerUserId", ASCENDING), ("slug", ASCENDING)],
                unique=True,
            ),
            # Partial: without this filter, all personal workspaces (orgId=null) collide on slug.
            IndexModel(
                [("orgId", ASCENDING), ("slug", ASCENDING)],
                unique=True,
                partialFilterExpression={"orgId": {"$type": "string"}},
            ),
        ]


class WorkspaceMember(Document):
    memberId: str
    workspaceId: str
    userId: str
    role: str  # WorkspaceRole value
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "workspace_members"
        indexes = [
            IndexModel([("memberId", ASCENDING)], unique=True),
            IndexModel([("workspaceId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class OutsideCollaborator(Document):
    collaboratorId: str
    workspaceId: str
    userId: str
    role: str = "read"
    grantedBy: str
    createdAt: datetime

    class Settings:
        name = "outside_collaborators"
        indexes = [
            IndexModel([("collaboratorId", ASCENDING)], unique=True),
            IndexModel([("workspaceId", ASCENDING), ("userId", ASCENDING)], unique=True),
            IndexModel([("userId", ASCENDING)]),
        ]


class Secret(Document):
    """
    GitHub-style scoped secret metadata + sealed-box ciphertext.

    The ciphertext is the base64-encoded libsodium sealed-box ciphertext
    encrypted by the client using the scope's public key.  The server
    NEVER holds plaintext outside the trusted runtime resolver.

    Metadata list/get responses strip the ciphertext field — only the
    trusted runtime resolver (scoped_secret_resolver) may decrypt.
    """

    secretId: str
    name: str
    scopeType: str  # SecretScope value
    scopeId: str
    ciphertext: str  # base64-encoded sealed-box ciphertext
    keyId: str  # ScopedKeypair keyId used for encryption
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "secrets"
        indexes = [
            IndexModel([("secretId", ASCENDING)], unique=True),
            IndexModel(
                [("scopeType", ASCENDING), ("scopeId", ASCENDING), ("name", ASCENDING)], unique=True
            ),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
        ]


class SecretBinding(Document):
    bindingId: str
    secretId: str
    userId: str
    targetScopeType: str  # "workspace" | "environment"
    targetScopeId: str
    createdAt: datetime

    class Settings:
        name = "secret_bindings"
        indexes = [
            IndexModel([("bindingId", ASCENDING)], unique=True),
            IndexModel(
                [
                    ("secretId", ASCENDING),
                    ("targetScopeType", ASCENDING),
                    ("targetScopeId", ASCENDING),
                ],
                unique=True,
            ),
            IndexModel([("userId", ASCENDING)]),
        ]


class SecretCreateRequest(BaseModel):
    """Request body for creating/updating a scoped secret."""

    name: str
    ciphertext: str  # base64-encoded sealed-box ciphertext
    keyId: str  # keyId of the public key used to encrypt


class SecretMetadataResponse(BaseModel):
    """
    Secret metadata returned by list/get endpoints.

    NEVER includes ciphertext or plaintext value.
    """

    model_config = ConfigDict(from_attributes=True)

    secretId: str
    name: str
    scopeType: str
    scopeId: str
    keyId: str
    createdAt: datetime
    updatedAt: datetime


class SecretBindingCreateRequest(BaseModel):
    """Request body for binding a user secret to a workspace/environment."""

    secretId: str
    targetScopeType: str  # "workspace" | "environment"
    targetScopeId: str


class SecretBindingResponse(BaseModel):
    """Secret binding metadata returned by list endpoints."""

    model_config = ConfigDict(from_attributes=True)

    bindingId: str
    secretId: str
    userId: str
    targetScopeType: str
    targetScopeId: str
    createdAt: datetime


class EnvironmentProtection(Document):
    protectionId: str
    environmentId: str
    requiredReviewers: list[str] = Field(default_factory=list)
    allowSelfApproval: bool = False
    bypassPolicy: str = "none"
    bypassAllowlist: list[str] = Field(default_factory=list)
    createdAt: datetime
    updatedAt: datetime

    class Settings:
        name = "environment_protections"
        indexes = [
            IndexModel([("protectionId", ASCENDING)], unique=True),
            IndexModel([("environmentId", ASCENDING)], unique=True),
        ]


class ServiceToken(Document):
    """
    Scoped service token for MCP/webhooks/workers.

    The raw token value is shown ONCE at creation/rotation time and never stored.
    Only the SHA-256 hash is persisted for validation. Tokens are scoped to a
    workspace or organization and carry explicit permissions.

    Revocation (revokedAt set) and scope narrowing immediately affect subsequent
    API/MCP/webhook calls — the token resolver checks scope and permissions on
    every request.
    """

    tokenId: str
    name: str
    tokenHash: str  # SHA-256 hash of the raw token value
    scopeType: str  # "workspace" | "organization"
    scopeId: str
    permissions: list[str] = Field(default_factory=list)
    createdBy: str  # userId of the creator
    createdAt: datetime
    expiresAt: datetime | None = None
    revokedAt: datetime | None = None
    lastUsedAt: datetime | None = None
    description: str | None = None

    class Settings:
        name = "service_tokens"
        indexes = [
            IndexModel([("tokenId", ASCENDING)], unique=True),
            IndexModel([("tokenHash", ASCENDING)], unique=True),
            IndexModel([("scopeType", ASCENDING), ("scopeId", ASCENDING)]),
            IndexModel([("createdBy", ASCENDING)]),
        ]


class ServiceTokenCreateRequest(BaseModel):
    """Request body for creating a scoped service token."""

    name: str
    description: str | None = None
    permissions: list[str] = Field(default_factory=list)
    expiresAt: datetime | None = None


class ServiceTokenCreateResponse(BaseModel):
    """
    Response at token creation time — includes the one-time raw token value.

    WARNING: The `token` field is shown ONLY once. Subsequent GET/metadata
    calls will NEVER return the token value.
    """

    tokenId: str
    name: str
    token: str  # One-time raw token value — shown only at creation
    scopeType: str
    scopeId: str
    permissions: list[str]
    createdAt: datetime
    expiresAt: datetime | None = None


class ServiceTokenMetadataResponse(BaseModel):
    """
    Service token metadata returned by list/get endpoints.

    NEVER includes the raw token value or hash.
    """

    model_config = ConfigDict(from_attributes=True)

    tokenId: str
    name: str
    description: str | None = None
    scopeType: str
    scopeId: str
    permissions: list[str]
    createdBy: str
    createdAt: datetime
    expiresAt: datetime | None = None
    revokedAt: datetime | None = None
    lastUsedAt: datetime | None = None


class ServiceTokenRotateResponse(BaseModel):
    """
    Response at token rotation time — includes the new one-time raw token value.

    The old token is immediately invalidated. The new token is shown ONLY once.
    """

    tokenId: str
    name: str
    token: str  # New one-time raw token value — shown only at rotation
    rotatedAt: datetime


class WebhookTokenActor(BaseModel):
    """
    Webhook execution actor context.

    Webhooks execute as scoped actors with explicit workspace permissions,
    NOT as the webhook creator's current user permissions. This model
    captures the token's scope and permissions for the executor.
    """

    actorType: Literal["webhook_token"] = "webhook_token"
    tokenId: str
    webhookId: str
    scopeType: str  # "workspace" | "organization"
    scopeId: str
    permissions: list[str] = Field(default_factory=list)


# ============================================================================
# Organization Invite Model (GitHub-like org-scoped invites)
# ============================================================================


class OrgInvite(Document):
    """
    Organization-scoped invitation.

    Distinct from the platform-level Invite model. Org invites grant membership
    in a specific organization with a specific role. 7-day expiry, rate-limited
    per org per email, token shown once.
    """

    inviteId: str
    orgId: str
    email: str
    token_hash: str
    role: str  # OrgMemberRole value
    invited_by: str  # userId of the inviter
    created_at: datetime
    expires_at: datetime
    consumed_at: datetime | None = None
    consumed: bool = False

    class Settings:
        name = "org_invites"
        indexes = [
            IndexModel([("inviteId", ASCENDING)], unique=True),
            IndexModel([("orgId", ASCENDING), ("email", ASCENDING)]),
            IndexModel([("token_hash", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=0),
        ]


# ============================================================================
# Team Permission Grant Model
# ============================================================================


class TeamPermissionGrant(Document):
    """
    Permission grant from a team to a specific resource.

    Teams can be granted permissions on workspaces, environments, or secrets.
    When a user is a member of a team, they inherit all of the team's grants
    through the ScopedPermissionEvaluator's highest-allow-wins logic.
    """

    grantId: str
    teamId: str
    orgId: str
    resourceType: str  # "workspace" | "environment" | "secret"
    resourceId: str
    permissions: list[str] = Field(default_factory=list)
    grantedBy: str  # userId
    createdAt: datetime

    class Settings:
        name = "team_permission_grants"
        indexes = [
            IndexModel([("grantId", ASCENDING)], unique=True),
            IndexModel(
                [("teamId", ASCENDING), ("resourceType", ASCENDING), ("resourceId", ASCENDING)],
                unique=True,
            ),
            IndexModel([("teamId", ASCENDING)]),
            IndexModel([("orgId", ASCENDING)]),
        ]


# ============================================================================
# Response DTOs for Organization APIs
# ============================================================================


class OrganizationResponse(BaseModel):
    """Public organization representation."""

    model_config = ConfigDict(from_attributes=True)

    orgId: str
    slug: str
    name: str
    description: str | None = None
    avatarUrl: str | None = None
    ownerUserId: str
    createdAt: datetime
    updatedAt: datetime


class OrganizationMemberResponse(BaseModel):
    """Organization member representation."""

    model_config = ConfigDict(from_attributes=True)

    memberId: str
    orgId: str
    userId: str
    role: str
    createdAt: datetime
    updatedAt: datetime


class TeamResponse(BaseModel):
    """Public team representation."""

    model_config = ConfigDict(from_attributes=True)

    teamId: str
    orgId: str
    slug: str
    name: str
    description: str | None = None
    createdAt: datetime
    updatedAt: datetime


class TeamMemberResponse(BaseModel):
    """Team member representation."""

    model_config = ConfigDict(from_attributes=True)

    memberId: str
    teamId: str
    userId: str
    role: str
    createdAt: datetime


class TeamPermissionGrantResponse(BaseModel):
    """Team permission grant representation."""

    model_config = ConfigDict(from_attributes=True)

    grantId: str
    teamId: str
    orgId: str
    resourceType: str
    resourceId: str
    permissions: list[str] = Field(default_factory=list)
    grantedBy: str
    createdAt: datetime


class OrgInviteResponse(BaseModel):
    """Organization invite representation (no token_hash)."""

    model_config = ConfigDict(from_attributes=True)

    inviteId: str
    orgId: str
    email: str
    role: str
    invited_by: str
    created_at: datetime
    expires_at: datetime
    consumed: bool
    consumed_at: datetime | None = None


class OrgInviteCreateResponse(BaseModel):
    """Response at invite creation time — includes the one-time token."""

    inviteId: str
    orgId: str
    email: str
    role: str
    token: str  # One-time raw token — shown only at creation
    expires_at: datetime


class OutsideCollaboratorResponse(BaseModel):
    """Outside collaborator representation."""

    model_config = ConfigDict(from_attributes=True)

    collaboratorId: str
    workspaceId: str
    userId: str
    role: str
    grantedBy: str
    createdAt: datetime


# ============================================================================
# Environment Protection — Pending Run Approval Model
# ============================================================================


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
