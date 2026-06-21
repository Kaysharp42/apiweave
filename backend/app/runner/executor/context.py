"""RunContext dataclass — scoped execution context for Wave 3+ runs."""

from dataclasses import dataclass, field


@dataclass
class RunContext:
    """Scoped execution context for Wave 3+ runs.

    Every run has:
    - workspace_id: the workspace that owns this run
    - org_id: the organization (if workspace is org-owned)
    - actor_type: "user" | "service_token" | "webhook" | "system"
    - actor_id: the userId, tokenId, webhookId, etc.
    - environment_id: the selected environment for this run
    - environment_scope_type: "user" | "organization" | "workspace"
    - environment_scope_id: the scope ID of the environment
    - effective_permissions: set of permissions the actor has in this workspace
    """

    workspace_id: str
    org_id: str | None = None
    actor_type: str = "user"
    actor_id: str = ""
    environment_id: str | None = None
    environment_scope_type: str = "workspace"
    environment_scope_id: str = ""
    effective_permissions: set[str] = field(default_factory=set)
