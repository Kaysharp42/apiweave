from collections.abc import Awaitable, Callable
from enum import StrEnum
from typing import Any, Final

from fastapi import Depends, HTTPException, status

RESOURCE_WORKFLOWS: Final = "workflows"
RESOURCE_COLLECTIONS: Final = "collections"
RESOURCE_ENVIRONMENTS: Final = "environments"
RESOURCE_WEBHOOKS: Final = "webhooks"
RESOURCE_USERS: Final = "users"
RESOURCE_SETTINGS: Final = "settings"
RESOURCE_RUNS: Final = "runs"
RESOURCE_SECRETS: Final = "secrets"

ACTION_CREATE: Final = "create"
ACTION_READ: Final = "read"
ACTION_UPDATE: Final = "update"
ACTION_DELETE: Final = "delete"
ACTION_RUN: Final = "run"
ACTION_EXPORT: Final = "export"
ACTION_IMPORT: Final = "import"
ACTION_SET_SECRET: Final = "set_secret"
ACTION_ROTATE: Final = "rotate"
ACTION_EXECUTE: Final = "execute"
ACTION_INVITE: Final = "invite"
ACTION_UPDATE_ROLE: Final = "update_role"
ACTION_CANCEL: Final = "cancel"


def permission(resource: str, action: str) -> str:
    return f"{resource}:{action}"


WORKFLOWS_CREATE: Final = permission(RESOURCE_WORKFLOWS, ACTION_CREATE)
WORKFLOWS_READ: Final = permission(RESOURCE_WORKFLOWS, ACTION_READ)
WORKFLOWS_UPDATE: Final = permission(RESOURCE_WORKFLOWS, ACTION_UPDATE)
WORKFLOWS_DELETE: Final = permission(RESOURCE_WORKFLOWS, ACTION_DELETE)
WORKFLOWS_RUN: Final = permission(RESOURCE_WORKFLOWS, ACTION_RUN)
WORKFLOWS_EXPORT: Final = permission(RESOURCE_WORKFLOWS, ACTION_EXPORT)
WORKFLOWS_IMPORT: Final = permission(RESOURCE_WORKFLOWS, ACTION_IMPORT)

COLLECTIONS_CREATE: Final = permission(RESOURCE_COLLECTIONS, ACTION_CREATE)
COLLECTIONS_READ: Final = permission(RESOURCE_COLLECTIONS, ACTION_READ)
COLLECTIONS_UPDATE: Final = permission(RESOURCE_COLLECTIONS, ACTION_UPDATE)
COLLECTIONS_DELETE: Final = permission(RESOURCE_COLLECTIONS, ACTION_DELETE)
COLLECTIONS_RUN: Final = permission(RESOURCE_COLLECTIONS, ACTION_RUN)
COLLECTIONS_EXPORT: Final = permission(RESOURCE_COLLECTIONS, ACTION_EXPORT)
COLLECTIONS_IMPORT: Final = permission(RESOURCE_COLLECTIONS, ACTION_IMPORT)

ENVIRONMENTS_CREATE: Final = permission(RESOURCE_ENVIRONMENTS, ACTION_CREATE)
ENVIRONMENTS_READ: Final = permission(RESOURCE_ENVIRONMENTS, ACTION_READ)
ENVIRONMENTS_UPDATE: Final = permission(RESOURCE_ENVIRONMENTS, ACTION_UPDATE)
ENVIRONMENTS_DELETE: Final = permission(RESOURCE_ENVIRONMENTS, ACTION_DELETE)
ENVIRONMENTS_SET_SECRET: Final = permission(RESOURCE_ENVIRONMENTS, ACTION_SET_SECRET)

WEBHOOKS_CREATE: Final = permission(RESOURCE_WEBHOOKS, ACTION_CREATE)
WEBHOOKS_READ: Final = permission(RESOURCE_WEBHOOKS, ACTION_READ)
WEBHOOKS_UPDATE: Final = permission(RESOURCE_WEBHOOKS, ACTION_UPDATE)
WEBHOOKS_DELETE: Final = permission(RESOURCE_WEBHOOKS, ACTION_DELETE)
WEBHOOKS_ROTATE: Final = permission(RESOURCE_WEBHOOKS, ACTION_ROTATE)
WEBHOOKS_EXECUTE: Final = permission(RESOURCE_WEBHOOKS, ACTION_EXECUTE)

USERS_READ: Final = permission(RESOURCE_USERS, ACTION_READ)
USERS_INVITE: Final = permission(RESOURCE_USERS, ACTION_INVITE)
USERS_UPDATE_ROLE: Final = permission(RESOURCE_USERS, ACTION_UPDATE_ROLE)
USERS_DELETE: Final = permission(RESOURCE_USERS, ACTION_DELETE)

SETTINGS_READ: Final = permission(RESOURCE_SETTINGS, ACTION_READ)
SETTINGS_UPDATE: Final = permission(RESOURCE_SETTINGS, ACTION_UPDATE)

RUNS_READ: Final = permission(RESOURCE_RUNS, ACTION_READ)
RUNS_CANCEL: Final = permission(RESOURCE_RUNS, ACTION_CANCEL)

SECRETS_READ: Final = permission(RESOURCE_SECRETS, ACTION_READ)
SECRETS_CREATE: Final = permission(RESOURCE_SECRETS, ACTION_CREATE)
SECRETS_UPDATE: Final = permission(RESOURCE_SECRETS, ACTION_UPDATE)
SECRETS_DELETE: Final = permission(RESOURCE_SECRETS, ACTION_DELETE)

PERMISSIONS_BY_RESOURCE: Final[dict[str, list[str]]] = {
    RESOURCE_WORKFLOWS: [
        WORKFLOWS_CREATE,
        WORKFLOWS_READ,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
        WORKFLOWS_EXPORT,
        WORKFLOWS_IMPORT,
    ],
    RESOURCE_COLLECTIONS: [
        COLLECTIONS_CREATE,
        COLLECTIONS_READ,
        COLLECTIONS_UPDATE,
        COLLECTIONS_DELETE,
        COLLECTIONS_RUN,
        COLLECTIONS_EXPORT,
        COLLECTIONS_IMPORT,
    ],
    RESOURCE_ENVIRONMENTS: [
        ENVIRONMENTS_CREATE,
        ENVIRONMENTS_READ,
        ENVIRONMENTS_UPDATE,
        ENVIRONMENTS_DELETE,
        ENVIRONMENTS_SET_SECRET,
    ],
    RESOURCE_WEBHOOKS: [
        WEBHOOKS_CREATE,
        WEBHOOKS_READ,
        WEBHOOKS_UPDATE,
        WEBHOOKS_DELETE,
        WEBHOOKS_ROTATE,
        WEBHOOKS_EXECUTE,
    ],
    RESOURCE_USERS: [USERS_READ, USERS_INVITE, USERS_UPDATE_ROLE, USERS_DELETE],
    RESOURCE_SETTINGS: [SETTINGS_READ, SETTINGS_UPDATE],
    RESOURCE_RUNS: [RUNS_READ, RUNS_CANCEL],
    RESOURCE_SECRETS: [SECRETS_READ, SECRETS_CREATE, SECRETS_UPDATE, SECRETS_DELETE],
}

ALL_PERMISSIONS: Final[list[str]] = [
    permission_string
    for resource_permissions in PERMISSIONS_BY_RESOURCE.values()
    for permission_string in resource_permissions
]

PRESET_ADMIN: Final = "admin"
PRESET_EDITOR: Final = "editor"
PRESET_VIEWER: Final = "viewer"

ROLE_PRESETS: Final[dict[str, list[str]]] = {
    PRESET_ADMIN: [
        WORKFLOWS_CREATE,
        WORKFLOWS_READ,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
        WORKFLOWS_EXPORT,
        WORKFLOWS_IMPORT,
        COLLECTIONS_CREATE,
        COLLECTIONS_READ,
        COLLECTIONS_UPDATE,
        COLLECTIONS_DELETE,
        COLLECTIONS_RUN,
        COLLECTIONS_EXPORT,
        COLLECTIONS_IMPORT,
        ENVIRONMENTS_CREATE,
        ENVIRONMENTS_READ,
        ENVIRONMENTS_UPDATE,
        ENVIRONMENTS_DELETE,
        ENVIRONMENTS_SET_SECRET,
        WEBHOOKS_CREATE,
        WEBHOOKS_READ,
        WEBHOOKS_UPDATE,
        WEBHOOKS_DELETE,
        WEBHOOKS_ROTATE,
        WEBHOOKS_EXECUTE,
        USERS_READ,
        USERS_INVITE,
        USERS_UPDATE_ROLE,
        USERS_DELETE,
        SETTINGS_READ,
        SETTINGS_UPDATE,
        RUNS_READ,
        RUNS_CANCEL,
        SECRETS_READ,
        SECRETS_CREATE,
        SECRETS_UPDATE,
        SECRETS_DELETE,
    ],
    PRESET_EDITOR: [
        WORKFLOWS_CREATE,
        WORKFLOWS_READ,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
        WORKFLOWS_EXPORT,
        WORKFLOWS_IMPORT,
        COLLECTIONS_CREATE,
        COLLECTIONS_READ,
        COLLECTIONS_UPDATE,
        COLLECTIONS_DELETE,
        COLLECTIONS_RUN,
        COLLECTIONS_EXPORT,
        COLLECTIONS_IMPORT,
        ENVIRONMENTS_CREATE,
        ENVIRONMENTS_READ,
        ENVIRONMENTS_UPDATE,
        ENVIRONMENTS_DELETE,
        ENVIRONMENTS_SET_SECRET,
        WEBHOOKS_CREATE,
        WEBHOOKS_READ,
        WEBHOOKS_UPDATE,
        WEBHOOKS_DELETE,
        WEBHOOKS_ROTATE,
        WEBHOOKS_EXECUTE,
        RUNS_READ,
        RUNS_CANCEL,
        SECRETS_READ,
        SECRETS_CREATE,
        SECRETS_UPDATE,
    ],
    PRESET_VIEWER: [
        WORKFLOWS_READ,
        COLLECTIONS_READ,
        ENVIRONMENTS_READ,
        WEBHOOKS_READ,
        RUNS_READ,
        SECRETS_READ,
    ],
}


class PermissionEvaluator:
    @staticmethod
    def has_permission(user_permissions: list[str], required_permission: str) -> bool:
        return required_permission in user_permissions

    @staticmethod
    def get_effective_permissions(
        roles: list[str],
        explicit_permissions: list[str],
    ) -> list[str]:
        permissions = set(explicit_permissions)
        for role in roles:
            if role in ROLE_PRESETS:
                permissions.update(ROLE_PRESETS[role])
        return list(permissions)


async def get_current_user() -> Any:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication is required",
    )


UserDependency = Callable[[], Awaitable[Any] | Any]


def require_permission(
    permission: str,
    get_user: UserDependency | None = None,
) -> Callable[..., Awaitable[Any]]:
    if get_user is None:
        from app.auth.dependencies import get_current_active_user

        user_dependency = get_current_active_user
    else:
        user_dependency = get_user

    async def _check_permission(
        current_user: Any = Depends(user_dependency),
    ) -> Any:
        effective = PermissionEvaluator.get_effective_permissions(
            getattr(current_user, "roles", []),
            getattr(current_user, "permissions", []),
        )
        if not PermissionEvaluator.has_permission(effective, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required permission: {permission}",
            )
        return current_user

    return _check_permission


ADMIN_ROLE: Final = PRESET_ADMIN
EDITOR_ROLE: Final = PRESET_EDITOR
VIEWER_ROLE: Final = PRESET_VIEWER
PERMISSION_PRESETS: Final = ROLE_PRESETS
ACTIONS_BY_RESOURCE: Final[dict[str, list[str]]] = {
    resource: [permission_string.split(":", maxsplit=1)[1] for permission_string in permissions]
    for resource, permissions in PERMISSIONS_BY_RESOURCE.items()
}


def permission_denied_detail(required_permission: str) -> str:
    return f"Missing required permission: {required_permission}"


def has_permission(user: Any, required_permission: str) -> bool:
    roles = getattr(user, "roles", None)
    if roles is None:
        role = getattr(user, "role", None)
        roles = [role] if isinstance(role, str) else []
    effective = PermissionEvaluator.get_effective_permissions(
        list(roles),
        list(getattr(user, "permissions", [])),
    )
    return PermissionEvaluator.has_permission(effective, required_permission)


class OrgRole(StrEnum):
    OWNER = "owner"
    MEMBER = "member"
    BILLING = "billing"
    SECURITY = "security"


class WorkspaceRole(StrEnum):
    READ = "read"
    TRIAGE = "triage"
    WRITE = "write"
    MAINTAIN = "maintain"
    ADMIN = "admin"


class PermissionScope(StrEnum):
    GLOBAL_ROLE = "global_role"
    ORG_ROLE = "org_role"
    TEAM_GRANT = "team_grant"
    WORKSPACE_ROLE = "workspace_role"
    OUTSIDE_COLLABORATOR = "outside_collaborator"
    SERVICE_TOKEN = "service_token"


WORKSPACE_ROLE_PERMISSIONS: Final[dict[str, set[str]]] = {
    WorkspaceRole.READ: {
        WORKFLOWS_READ,
        COLLECTIONS_READ,
        ENVIRONMENTS_READ,
        WEBHOOKS_READ,
        RUNS_READ,
        SECRETS_READ,
    },
    WorkspaceRole.TRIAGE: {
        WORKFLOWS_READ,
        COLLECTIONS_READ,
        ENVIRONMENTS_READ,
        WEBHOOKS_READ,
        RUNS_READ,
        WORKFLOWS_RUN,
        COLLECTIONS_RUN,
        SECRETS_READ,
    },
    WorkspaceRole.WRITE: {
        WORKFLOWS_READ,
        WORKFLOWS_CREATE,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
        COLLECTIONS_READ,
        COLLECTIONS_CREATE,
        COLLECTIONS_UPDATE,
        COLLECTIONS_DELETE,
        COLLECTIONS_RUN,
        ENVIRONMENTS_READ,
        ENVIRONMENTS_CREATE,
        ENVIRONMENTS_UPDATE,
        WEBHOOKS_READ,
        RUNS_READ,
        SECRETS_READ,
    },
    WorkspaceRole.MAINTAIN: {
        WORKFLOWS_READ,
        WORKFLOWS_CREATE,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
        WORKFLOWS_EXPORT,
        WORKFLOWS_IMPORT,
        COLLECTIONS_READ,
        COLLECTIONS_CREATE,
        COLLECTIONS_UPDATE,
        COLLECTIONS_DELETE,
        COLLECTIONS_RUN,
        COLLECTIONS_EXPORT,
        COLLECTIONS_IMPORT,
        ENVIRONMENTS_READ,
        ENVIRONMENTS_CREATE,
        ENVIRONMENTS_UPDATE,
        WEBHOOKS_READ,
        WEBHOOKS_CREATE,
        WEBHOOKS_UPDATE,
        WEBHOOKS_DELETE,
        RUNS_READ,
        SECRETS_READ,
    },
    WorkspaceRole.ADMIN: {
        WORKFLOWS_READ,
        WORKFLOWS_CREATE,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
        WORKFLOWS_EXPORT,
        WORKFLOWS_IMPORT,
        COLLECTIONS_READ,
        COLLECTIONS_CREATE,
        COLLECTIONS_UPDATE,
        COLLECTIONS_DELETE,
        COLLECTIONS_RUN,
        COLLECTIONS_EXPORT,
        COLLECTIONS_IMPORT,
        ENVIRONMENTS_READ,
        ENVIRONMENTS_CREATE,
        ENVIRONMENTS_UPDATE,
        ENVIRONMENTS_DELETE,
        ENVIRONMENTS_SET_SECRET,
        WEBHOOKS_READ,
        WEBHOOKS_CREATE,
        WEBHOOKS_UPDATE,
        WEBHOOKS_DELETE,
        WEBHOOKS_ROTATE,
        WEBHOOKS_EXECUTE,
        RUNS_READ,
        RUNS_CANCEL,
        USERS_INVITE,
        USERS_UPDATE_ROLE,
        SECRETS_READ,
        SECRETS_CREATE,
        SECRETS_UPDATE,
        SECRETS_DELETE,
    },
}

ORG_ROLE_PERMISSIONS: Final[dict[str, set[str]]] = {
    OrgRole.OWNER: {
        USERS_READ,
        USERS_INVITE,
        USERS_UPDATE_ROLE,
        USERS_DELETE,
        SETTINGS_READ,
        SETTINGS_UPDATE,
    },
    OrgRole.MEMBER: set(),
    OrgRole.BILLING: {
        SETTINGS_READ,
        SETTINGS_UPDATE,
    },
    OrgRole.SECURITY: {
        SETTINGS_READ,
    },
}

WORKSPACE_ROLE_HIERARCHY: Final[list[str]] = [
    WorkspaceRole.READ,
    WorkspaceRole.TRIAGE,
    WorkspaceRole.WRITE,
    WorkspaceRole.MAINTAIN,
    WorkspaceRole.ADMIN,
]


class LastOwnerError(HTTPException):
    def __init__(self, detail: str = "Cannot remove or demote the last organization owner") -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail,
            headers={"X-Error-Code": "last_owner"},
        )


class ScopedPermissionEvaluator:
    @staticmethod
    def permissions_for_workspace_role(role: str) -> set[str]:
        return WORKSPACE_ROLE_PERMISSIONS.get(role, set())

    @staticmethod
    def permissions_for_org_role(role: str) -> set[str]:
        return ORG_ROLE_PERMISSIONS.get(role, set())

    @staticmethod
    def _higher_workspace_role(role_a: str, role_b: str) -> str:
        try:
            idx_a = WORKSPACE_ROLE_HIERARCHY.index(role_a)
        except ValueError:
            idx_a = -1
        try:
            idx_b = WORKSPACE_ROLE_HIERARCHY.index(role_b)
        except ValueError:
            idx_b = -1
        if idx_a >= idx_b:
            return role_a
        return role_b

    @staticmethod
    def evaluate(
        *,
        org_role: str | None = None,
        workspace_role: str | None = None,
        team_grants: list[set[str]] | None = None,
        outside_collaborator_permissions: set[str] | None = None,
        service_token_permissions: set[str] | None = None,
        global_roles: list[str] | None = None,
        global_permissions: list[str] | None = None,
    ) -> set[str]:
        effective: set[str] = set()

        if global_roles or global_permissions:
            legacy = PermissionEvaluator.get_effective_permissions(
                list(global_roles or []),
                list(global_permissions or []),
            )
            effective.update(legacy)

        if org_role:
            effective.update(ScopedPermissionEvaluator.permissions_for_org_role(org_role))

        if workspace_role:
            effective.update(
                ScopedPermissionEvaluator.permissions_for_workspace_role(workspace_role)
            )

        if team_grants:
            for grant_set in team_grants:
                effective.update(grant_set)

        if outside_collaborator_permissions:
            effective.update(outside_collaborator_permissions)

        if service_token_permissions:
            effective.update(service_token_permissions)

        return effective

    @staticmethod
    def has_permission(
        effective_permissions: set[str],
        required_permission: str,
    ) -> bool:
        return required_permission in effective_permissions

    @staticmethod
    def effective_workspace_role(
        direct_role: str | None,
        team_roles: list[str] | None = None,
        outside_collab_role: str | None = None,
    ) -> str | None:
        candidates: list[str] = []
        if direct_role:
            candidates.append(direct_role)
        if team_roles:
            candidates.extend(team_roles)
        if outside_collab_role:
            candidates.append(outside_collab_role)

        if not candidates:
            return None

        best = candidates[0]
        for role in candidates[1:]:
            best = ScopedPermissionEvaluator._higher_workspace_role(best, role)
        return best


def check_last_owner(owner_count: int) -> None:
    if owner_count <= 1:
        raise LastOwnerError()


__all__ = [name for name in globals() if name.isupper()] + [
    "PermissionEvaluator",
    "ScopedPermissionEvaluator",
    "OrgRole",
    "WorkspaceRole",
    "PermissionScope",
    "LastOwnerError",
    "check_last_owner",
    "get_current_user",
    "has_permission",
    "permission",
    "permission_denied_detail",
    "require_permission",
]
