"""Tests for invite management, user deletion guards, and orphan invite reconciliation.

Covers:
1. Duplicate invite prevention (409 for duplicate email, 409 for existing user)
2. Orphan invite auto-consumption on OAuth login
3. Invite role update (PATCH /invites/{id}/role)
4. Invite deletion (DELETE /settings/invites/{id})
5. Self-delete guard (admin cannot delete self)
6. Last-admin guard (admin cannot delete last admin)
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import app.auth.router as auth_router
import pytest
from app.auth.permissions import PRESET_ADMIN, PRESET_EDITOR, PRESET_VIEWER
from app.models import Invite, Session, User
from app.repositories.auth_repositories import (
    DeletedUserRepository,
    InviteRepository,
    SessionRepository,
    UserRepository,
)
from app.routes import auth_admin
from fastapi import FastAPI
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_session(token: str = "tok", user_id: str = "u1") -> Session:
    now = datetime.now(UTC)
    return Session.model_construct(
        sessionId=f"ses-{user_id}",
        userId=user_id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=7),
        revoked=False,
    )


def _make_user(
    user_id: str = "u1",
    roles: list[str] | None = None,
    email: str | None = None,
) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=email or f"{user_id}@example.com",
        display_name="Test",
        avatar_url=None,
        roles=roles or [],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _make_invite(
    invite_id: str = "inv-1",
    email: str = "new@example.com",
    consumed: bool = False,
    role_preset: str = PRESET_VIEWER,
    token: str = "tok123",
) -> Invite:
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId=invite_id,
        email=email,
        token_hash=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        role_preset=role_preset,
        created_by="u1",
        created_at=now,
        expires_at=now + timedelta(days=7),
        consumed=consumed,
        consumed_at=now if consumed else None,
        invite_url=f"http://localhost:3000/invite/{token}",
    )


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_admin.router)
    return TestClient(app)


def _auth_patches(user: User, token: str = "tok"):
    session = _make_session(token=token, user_id=user.userId)
    return (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    )


# ---------------------------------------------------------------------------
# 1. Duplicate invite prevention
# ---------------------------------------------------------------------------


def test_settings_create_invite_duplicate_email_returns_409() -> None:
    """Creating an invite for an email that already has an active invite → 409."""
    admin = _make_user(roles=[PRESET_ADMIN])
    existing_invite = _make_invite()
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(
            InviteRepository, "find_active_by_email", new=AsyncMock(return_value=existing_invite)
        ),
    ):
        response = client.post(
            "/api/settings/invites",
            json={"email": "new@example.com", "role_preset": "viewer"},
        )
    assert response.status_code == 409
    assert "invite" in response.json()["detail"].lower()


def test_settings_create_invite_existing_user_returns_409() -> None:
    """Creating an invite for an email that belongs to an existing user → 409."""
    admin = _make_user(roles=[PRESET_ADMIN])
    existing_user = _make_user(user_id="u2", email="existing@example.com")
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(InviteRepository, "find_active_by_email", new=AsyncMock(return_value=None)),
        patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=existing_user)),
    ):
        response = client.post(
            "/api/settings/invites",
            json={"email": "existing@example.com", "role_preset": "viewer"},
        )
    assert response.status_code == 409
    assert "user" in response.json()["detail"].lower()


def test_settings_create_invite_case_insensitive_email() -> None:
    """Email is lowercased before checking for duplicates."""
    admin = _make_user(roles=[PRESET_ADMIN])
    existing_invite = _make_invite(email="new@example.com")
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    find_active = AsyncMock(return_value=existing_invite)
    with s, t, u, patch.object(InviteRepository, "find_active_by_email", new=find_active):
        response = client.post(
            "/api/settings/invites",
            json={"email": "NEW@EXAMPLE.COM", "role_preset": "viewer"},
        )
    assert response.status_code == 409
    # Verify the email was lowercased when passed to the repository
    find_active.assert_awaited_once_with("new@example.com")


def test_auth_create_invite_duplicate_email_returns_409(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/auth/invites: duplicate active invite → 409."""
    from app.main import app as main_app

    client = TestClient(main_app)
    admin = _make_user(roles=[PRESET_ADMIN])
    existing_invite = _make_invite()
    session = _make_session(user_id=admin.userId)

    monkeypatch.setattr(SessionRepository, "get_by_token_hash", AsyncMock(return_value=session))
    monkeypatch.setattr(SessionRepository, "touch", AsyncMock(return_value=True))
    monkeypatch.setattr(UserRepository, "get_by_id", AsyncMock(return_value=admin))
    monkeypatch.setattr(
        InviteRepository, "find_active_by_email", AsyncMock(return_value=existing_invite)
    )

    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    response = client.post(
        "/api/auth/invites",
        json={"email": "new@example.com", "roles": ["viewer"]},
    )
    assert response.status_code == 409


def test_auth_create_invite_existing_user_returns_409(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/auth/invites: existing user with same email → 409."""
    from app.main import app as main_app

    client = TestClient(main_app)
    admin = _make_user(roles=[PRESET_ADMIN])
    existing_user = _make_user(user_id="u2", email="taken@example.com")
    session = _make_session(user_id=admin.userId)

    monkeypatch.setattr(SessionRepository, "get_by_token_hash", AsyncMock(return_value=session))
    monkeypatch.setattr(SessionRepository, "touch", AsyncMock(return_value=True))
    monkeypatch.setattr(UserRepository, "get_by_id", AsyncMock(return_value=admin))
    monkeypatch.setattr(InviteRepository, "find_active_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(UserRepository, "get_by_email", AsyncMock(return_value=existing_user))

    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    response = client.post(
        "/api/auth/invites",
        json={"email": "taken@example.com", "roles": ["viewer"]},
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# 2. Orphan invite auto-consumption on OAuth login
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reconcile_orphan_invite_consumes_and_applies_role(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_reconcile_orphan_invite: when no invite_token and active invite exists,
    it consumes the invite and applies the role to the user."""
    email = "orphan@example.com"
    user = _make_user(user_id="usr-orphan", roles=[], email=email)
    invite = _make_invite(invite_id="inv-orphan", email=email, role_preset=PRESET_EDITOR)
    updated_user = _make_user(user_id="usr-orphan", roles=[PRESET_EDITOR], email=email)

    monkeypatch.setattr(
        auth_router.InviteRepository, "find_active_by_email", AsyncMock(return_value=invite)
    )
    consume = AsyncMock(return_value=True)
    monkeypatch.setattr(auth_router.InviteRepository, "consume", consume)
    monkeypatch.setattr(auth_router.UserRepository, "update", AsyncMock(return_value=updated_user))

    result = await auth_router._reconcile_orphan_invite(user, invite_token=None)

    consume.assert_awaited_once_with("inv-orphan")
    assert PRESET_EDITOR in result.roles


@pytest.mark.asyncio
async def test_reconcile_orphan_invite_skips_when_invite_token_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_reconcile_orphan_invite: when invite_token is provided, skip reconciliation."""
    email = "orphan@example.com"
    user = _make_user(user_id="usr-orphan", roles=[], email=email)

    find_active = AsyncMock()
    monkeypatch.setattr(auth_router.InviteRepository, "find_active_by_email", find_active)

    result = await auth_router._reconcile_orphan_invite(user, invite_token="some-token")

    find_active.assert_not_awaited()
    assert result is user


@pytest.mark.asyncio
async def test_reconcile_orphan_invite_skips_when_no_active_invite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_reconcile_orphan_invite: when no active invite found, return user unchanged."""
    email = "orphan@example.com"
    user = _make_user(user_id="usr-orphan", roles=[], email=email)

    monkeypatch.setattr(
        auth_router.InviteRepository, "find_active_by_email", AsyncMock(return_value=None)
    )
    consume = AsyncMock()
    monkeypatch.setattr(auth_router.InviteRepository, "consume", consume)

    result = await auth_router._reconcile_orphan_invite(user, invite_token=None)

    consume.assert_not_awaited()
    assert result is user


@pytest.mark.asyncio
async def test_reconcile_orphan_invite_skips_role_update_when_user_already_has_roles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Consume the orphan invite without replacing existing roles."""
    email = "orphan@example.com"
    user = _make_user(user_id="usr-orphan", roles=[PRESET_ADMIN], email=email)
    invite = _make_invite(invite_id="inv-orphan", email=email, role_preset=PRESET_VIEWER)

    monkeypatch.setattr(
        auth_router.InviteRepository, "find_active_by_email", AsyncMock(return_value=invite)
    )
    consume = AsyncMock(return_value=True)
    monkeypatch.setattr(auth_router.InviteRepository, "consume", consume)
    update = AsyncMock()
    monkeypatch.setattr(auth_router.UserRepository, "update", update)

    result = await auth_router._reconcile_orphan_invite(user, invite_token=None)

    consume.assert_awaited_once_with("inv-orphan")
    update.assert_not_awaited()
    assert result is user


# ---------------------------------------------------------------------------
# 3. Invite role update (PATCH /invites/{id}/role)
# ---------------------------------------------------------------------------


def test_update_invite_role_admin_ok() -> None:
    """PATCH /api/invites/{id}/role: admin can update role on unconsumed invite."""
    admin = _make_user(roles=[PRESET_ADMIN])
    invite = _make_invite(role_preset=PRESET_VIEWER)
    updated_invite = _make_invite(role_preset=PRESET_EDITOR)
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=invite)),
        patch.object(InviteRepository, "update_role", new=AsyncMock(return_value=updated_invite)),
    ):
        response = client.patch(
            "/api/invites/inv-1/role",
            json={"role_preset": PRESET_EDITOR},
        )
    assert response.status_code == 200
    assert response.json()["role_preset"] == PRESET_EDITOR


def test_update_invite_role_consumed_invite_returns_400() -> None:
    """PATCH /api/invites/{id}/role: consumed invite → 400."""
    admin = _make_user(roles=[PRESET_ADMIN])
    consumed_invite = _make_invite(consumed=True)
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=consumed_invite)),
    ):
        response = client.patch(
            "/api/invites/inv-1/role",
            json={"role_preset": PRESET_EDITOR},
        )
    assert response.status_code == 400
    assert "consumed" in response.json()["detail"].lower()


def test_update_invite_role_not_found_returns_404() -> None:
    """PATCH /api/invites/{id}/role: invite not found → 404."""
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=None)):
        response = client.patch(
            "/api/invites/ghost/role",
            json={"role_preset": PRESET_EDITOR},
        )
    assert response.status_code == 404


def test_update_invite_role_viewer_forbidden() -> None:
    """PATCH /api/invites/{id}/role: viewer → 403."""
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.patch(
            "/api/invites/inv-1/role",
            json={"role_preset": PRESET_EDITOR},
        )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 4. Invite deletion (DELETE /settings/invites/{id})
# ---------------------------------------------------------------------------


def test_delete_invite_admin_ok() -> None:
    """DELETE /api/settings/invites/{id}: admin can delete unconsumed invite → 200."""
    admin = _make_user(roles=[PRESET_ADMIN])
    invite = _make_invite()
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=invite)),
        patch.object(InviteRepository, "delete_invite", new=AsyncMock(return_value=True)),
    ):
        response = client.delete("/api/settings/invites/inv-1")
    assert response.status_code == 200
    assert response.json()["message"] == "Invite deleted"


def test_delete_invite_not_found_returns_404() -> None:
    """DELETE /api/settings/invites/{id}: invite not found → 404."""
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=None)):
        response = client.delete("/api/settings/invites/ghost")
    assert response.status_code == 404


def test_delete_invite_consumed_returns_404() -> None:
    """DELETE /api/settings/invites/{id}: consumed invite → 404 (treated as not found)."""
    admin = _make_user(roles=[PRESET_ADMIN])
    consumed_invite = _make_invite(consumed=True)
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(InviteRepository, "get_by_id", new=AsyncMock(return_value=consumed_invite)),
    ):
        response = client.delete("/api/settings/invites/inv-1")
    assert response.status_code == 404


def test_delete_invite_viewer_forbidden() -> None:
    """DELETE /api/settings/invites/{id}: viewer → 403."""
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.delete("/api/settings/invites/inv-1")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 5. Self-delete guard
# ---------------------------------------------------------------------------


def test_delete_user_self_returns_403() -> None:
    """DELETE /api/users/{id}: admin cannot delete their own account → 403."""
    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u:
        response = client.delete("/api/users/admin-1")
    assert response.status_code == 403
    assert "own" in response.json()["detail"].lower() or "self" in response.json()["detail"].lower()


def test_delete_user_other_admin_ok() -> None:
    """DELETE /api/users/{id}: admin can delete another user when multiple admins exist."""
    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    other_admin = _make_user(user_id="admin-2", roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(UserRepository, "get_all", new=AsyncMock(return_value=[admin, other_admin])),
        patch.object(UserRepository, "delete", new=AsyncMock(return_value=True)),
    ):
        response = client.delete("/api/users/admin-2")
    assert response.status_code == 204


def test_delete_non_admin_user_with_single_admin_ok() -> None:
    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    viewer = _make_user(user_id="viewer-1", roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(UserRepository, "get_all", new=AsyncMock(return_value=[admin, viewer])),
        patch.object(UserRepository, "delete", new=AsyncMock(return_value=True)),
    ):
        response = client.delete("/api/users/viewer-1")
    assert response.status_code == 204


def test_delete_user_not_found_returns_404() -> None:
    """DELETE /api/users/{id}: user not found → 404."""
    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    viewer = _make_user(user_id="viewer-1", roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with (
        s,
        t,
        u,
        patch.object(UserRepository, "get_all", new=AsyncMock(return_value=[admin, viewer])),
        patch.object(UserRepository, "delete", new=AsyncMock(return_value=False)),
    ):
        response = client.delete("/api/users/ghost")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 6. Last-admin guard
# ---------------------------------------------------------------------------


def test_delete_last_admin_returns_400() -> None:
    """DELETE /api/users/{id}: cannot delete the last admin → 400.

    Requester has admin role (for USERS_DELETE permission).
    get_all returns only the target (sole admin), so admin_count == 1.
    """
    requester = _make_user(user_id="req-2", roles=[PRESET_ADMIN])
    sole_admin = _make_user(user_id="sole-2", roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(requester)
    with s, t, u, patch.object(UserRepository, "get_all", new=AsyncMock(return_value=[sole_admin])):
        response = client.delete("/api/users/sole-2")
    assert response.status_code == 400
    assert "admin" in response.json()["detail"].lower()


def test_delete_last_admin_guard_with_single_admin_in_system() -> None:
    """DELETE /api/users/{id}: system has exactly one admin, deleting them → 400."""
    requester = _make_user(user_id="req-1", roles=[PRESET_ADMIN])
    sole_admin = _make_user(user_id="sole-admin", roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(requester)
    # get_all returns only the sole admin (requester is not in the list, simulating
    # that the guard sees only 1 admin)
    with s, t, u, patch.object(UserRepository, "get_all", new=AsyncMock(return_value=[sole_admin])):
        response = client.delete("/api/users/sole-admin")
    assert response.status_code == 400
    detail = response.json()["detail"].lower()
    assert "admin" in detail


def test_settings_update_permissions_blocks_last_admin_demotion() -> None:
    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(UserRepository, "get_all", new=AsyncMock(return_value=[admin])):
        response = client.patch(
            "/api/settings/users/admin-1/permissions",
            json={"roles": [PRESET_VIEWER], "permissions": []},
        )
    assert response.status_code == 400
    assert "admin" in response.json()["detail"].lower()


def test_delete_user_viewer_forbidden() -> None:
    """DELETE /api/users/{id}: viewer cannot delete users → 403."""
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.delete("/api/users/some-user")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# 7. Re-inviting a deleted user clears the DeletedUser block
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_by_email_removes_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DeletedUserRepository.delete_by_email: existing record → removed, returns True."""
    doc = AsyncMock()
    doc.delete = AsyncMock()
    monkeypatch.setattr(
        "app.repositories.auth_repositories.DeletedUser.find_one",
        AsyncMock(return_value=doc),
    )

    result = await DeletedUserRepository.delete_by_email("removed@example.com")
    assert result is True
    doc.delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_by_email_no_record_returns_false() -> None:
    """DeletedUserRepository.delete_by_email: no matching record → returns False."""
    result = await DeletedUserRepository.delete_by_email("never-deleted@example.com")
    assert result is False


def test_settings_create_invite_clears_deleted_user(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/settings/invites: re-inviting a deleted user clears the DeletedUser record."""
    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)

    clear_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(DeletedUserRepository, "delete_by_email", clear_mock)

    with (
        s,
        t,
        u,
        patch.object(InviteRepository, "find_active_by_email", new=AsyncMock(return_value=None)),
        patch.object(UserRepository, "get_by_email", new=AsyncMock(return_value=None)),
        patch.object(
            InviteRepository,
            "create",
            new=AsyncMock(
                return_value=_make_invite(invite_id="inv-reinvite", email="reinvite@example.com")
            ),
        ),
    ):
        response = client.post(
            "/api/settings/invites",
            json={"email": "reinvite@example.com", "role_preset": "viewer"},
        )

    assert response.status_code == 201
    clear_mock.assert_awaited_once_with("reinvite@example.com")


def test_auth_create_invite_clears_deleted_user(monkeypatch: pytest.MonkeyPatch) -> None:
    """POST /api/auth/invites: re-inviting a deleted user clears the DeletedUser record."""
    from app.main import app as main_app

    admin = _make_user(user_id="admin-1", roles=[PRESET_ADMIN])
    client = TestClient(main_app)
    session = _make_session(user_id=admin.userId)

    monkeypatch.setattr(SessionRepository, "get_by_token_hash", AsyncMock(return_value=session))
    monkeypatch.setattr(SessionRepository, "touch", AsyncMock(return_value=True))
    monkeypatch.setattr(UserRepository, "get_by_id", AsyncMock(return_value=admin))
    monkeypatch.setattr(InviteRepository, "find_active_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(UserRepository, "get_by_email", AsyncMock(return_value=None))
    monkeypatch.setattr(
        InviteRepository,
        "create",
        AsyncMock(
            return_value=_make_invite(invite_id="inv-reinvite2", email="reinvite2@example.com")
        ),
    )
    clear_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(DeletedUserRepository, "delete_by_email", clear_mock)

    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    response = client.post(
        "/api/auth/invites",
        json={"email": "reinvite2@example.com", "roles": ["viewer"]},
    )

    assert response.status_code == 200
    clear_mock.assert_awaited_once_with("reinvite2@example.com")
