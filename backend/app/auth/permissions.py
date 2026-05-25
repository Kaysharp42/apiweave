from collections.abc import Awaitable, Callable
from typing import Any, Final

from fastapi import Depends, HTTPException, status

RESOURCE_WORKFLOWS: Final = "workflows"
RESOURCE_COLLECTIONS: Final = "collections"
RESOURCE_ENVIRONMENTS: Final = "environments"
RESOURCE_WEBHOOKS: Final = "webhooks"
RESOURCE_USERS: Final = "users"
RESOURCE_SETTINGS: Final = "settings"
RESOURCE_RUNS: Final = "runs"

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

PERMISSIONS_BY_RESOURCE: Final[dict[str, list[str]]] = {
    RESOURCE_WORKFLOWS: [
        WORKFLOWS_CREATE,
        WORKFLOWS_READ,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
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
    ],
    PRESET_EDITOR: [
        WORKFLOWS_CREATE,
        WORKFLOWS_READ,
        WORKFLOWS_UPDATE,
        WORKFLOWS_DELETE,
        WORKFLOWS_RUN,
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
    ],
    PRESET_VIEWER: [
        WORKFLOWS_READ,
        COLLECTIONS_READ,
        ENVIRONMENTS_READ,
        WEBHOOKS_READ,
        RUNS_READ,
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
    user_dependency = get_user or get_current_user

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


__all__ = [name for name in globals() if name.isupper()] + [
    "PermissionEvaluator",
    "get_current_user",
    "has_permission",
    "permission",
    "permission_denied_detail",
    "require_permission",
]
