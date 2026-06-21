from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.permissions import (
    ALL_PERMISSIONS,
    COLLECTIONS_CREATE,
    PRESET_ADMIN,
    PRESET_EDITOR,
    PRESET_VIEWER,
    ROLE_PRESETS,
    USERS_INVITE,
    PermissionEvaluator,
    require_permission,
)


def _user(
    roles: list[str] | None = None,
    permissions: list[str] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(roles=roles or [], permissions=permissions or [])


def test_admin_has_all_permissions() -> None:
    effective = PermissionEvaluator.get_effective_permissions([PRESET_ADMIN], [])

    assert set(effective) == set(ALL_PERMISSIONS)
    for permission in ALL_PERMISSIONS:
        assert PermissionEvaluator.has_permission(effective, permission)


def test_editor_can_create_collection() -> None:
    effective = PermissionEvaluator.get_effective_permissions([PRESET_EDITOR], [])

    assert PermissionEvaluator.has_permission(effective, COLLECTIONS_CREATE)


def test_editor_cannot_invite_users() -> None:
    effective = PermissionEvaluator.get_effective_permissions([PRESET_EDITOR], [])

    assert not PermissionEvaluator.has_permission(effective, USERS_INVITE)


def test_viewer_is_read_only() -> None:
    effective = PermissionEvaluator.get_effective_permissions([PRESET_VIEWER], [])

    assert effective
    assert set(effective) == set(ROLE_PRESETS[PRESET_VIEWER])
    assert all(permission.endswith(":read") for permission in effective)


def test_viewer_cannot_invite_user() -> None:
    effective = PermissionEvaluator.get_effective_permissions([PRESET_VIEWER], [])

    assert not PermissionEvaluator.has_permission(effective, USERS_INVITE)


def test_custom_permissions_list_works() -> None:
    effective = PermissionEvaluator.get_effective_permissions([], [COLLECTIONS_CREATE])

    assert PermissionEvaluator.has_permission(effective, COLLECTIONS_CREATE)
    assert not PermissionEvaluator.has_permission(effective, USERS_INVITE)


def test_denial_returns_403_error() -> None:
    app = FastAPI()

    async def get_viewer() -> SimpleNamespace:
        return _user(roles=[PRESET_VIEWER])

    @app.post("/protected")
    async def protected(
        user: SimpleNamespace = Depends(require_permission(USERS_INVITE, get_user=get_viewer)),
    ) -> dict[str, bool]:
        return {"ok": bool(user)}

    response = TestClient(app).post("/protected")

    assert response.status_code == 403
    assert response.json()["detail"] == f"Missing required permission: {USERS_INVITE}"


def test_permission_evaluator_empty_permissions() -> None:
    assert not PermissionEvaluator.has_permission([], COLLECTIONS_CREATE)


@pytest.mark.anyio
async def test_dependency_allows_injected_user_with_permission() -> None:
    async def get_editor() -> SimpleNamespace:
        return _user(roles=[PRESET_EDITOR])

    dependency = require_permission(COLLECTIONS_CREATE, get_user=get_editor)

    user = await dependency(current_user=await get_editor())

    assert user.roles == [PRESET_EDITOR]
