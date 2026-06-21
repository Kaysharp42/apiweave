from enum import Enum


class OrgMemberRole(str, Enum):
    """Organization membership roles (GitHub-like)."""

    OWNER = "owner"
    MEMBER = "member"
    BILLING = "billing"
    SECURITY = "security"


class WorkspaceRole(str, Enum):
    """Workspace membership roles (GitHub repository roles)."""

    READ = "read"
    TRIAGE = "triage"
    WRITE = "write"
    MAINTAIN = "maintain"
    ADMIN = "admin"


class OwnerType(str, Enum):
    """Owner type for scoped resources."""

    USER = "user"
    ORGANIZATION = "organization"


class SecretScope(str, Enum):
    """Secret scope for GitHub-like override chain."""

    USER = "user"
    ORGANIZATION = "organization"
    WORKSPACE = "workspace"
    ENVIRONMENT = "environment"
