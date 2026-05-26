from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.permissions import PRESET_ADMIN, PRESET_EDITOR, PRESET_VIEWER
from app.models import ApprovedDomain, Invite, Session, User
from app.repositories.auth_repositories import (
    ApprovedDomainRepository,
    InviteRepository,
    SessionRepository,
    UserRepository,
)
from app.routes import auth_admin


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
    permissions: list[str] | None = None,
) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=f"{user_id}@example.com",
        display_name="Test",
        avatar_url=None,
        roles=roles or [],
        permissions=permissions or [],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _make_invite(invite_id: str = "inv-1") -> Invite:
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId=invite_id,
        email="new@example.com",
        token_hash="hash",
        role_preset=PRESET_VIEWER,
        created_by="u1",
        created_at=now,
        expires_at=now + timedelta(days=7),
        consumed=False,
        consumed_at=None,
    )


def _make_domain(domain_id: str = "dom-1") -> ApprovedDomain:
    now = datetime.now(UTC)
    return ApprovedDomain.model_construct(
        domainId=domain_id,
        domain="example.com",
        created_by="u1",
        created_at=now,
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


def test_settings_users_requires_auth() -> None:
    response = _client().get("/api/settings/users")
    assert response.status_code == 401


def test_settings_users_viewer_forbidden() -> None:
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.get("/api/settings/users")
    assert response.status_code == 403


def test_settings_users_editor_forbidden() -> None:
    user = _make_user(roles=[PRESET_EDITOR])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.get("/api/settings/users")
    assert response.status_code == 403


def test_settings_users_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        UserRepository, "get_all", new=AsyncMock(return_value=[admin])
    ):
        response = client.get("/api/settings/users")
    assert response.status_code == 200
    assert response.json()[0]["userId"] == "u1"


def test_settings_update_permissions_admin_ok() -> None:
    admin = _make_user(user_id="admin", roles=[PRESET_ADMIN])
    target = _make_user(user_id="target", roles=[PRESET_VIEWER])
    updated = _make_user(user_id="target", roles=[PRESET_EDITOR])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        UserRepository, "update", new=AsyncMock(return_value=updated)
    ):
        response = client.patch(
            f"/api/settings/users/{target.userId}/permissions",
            json={"roles": [PRESET_EDITOR], "permissions": []},
        )
    assert response.status_code == 200
    assert PRESET_EDITOR in response.json()["roles"]


def test_settings_update_permissions_viewer_forbidden() -> None:
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.patch(
            "/api/settings/users/other/permissions",
            json={"roles": [PRESET_ADMIN], "permissions": []},
        )
    assert response.status_code == 403


def test_settings_update_permissions_user_not_found() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        UserRepository, "update", new=AsyncMock(return_value=None)
    ):
        response = client.patch(
            "/api/settings/users/ghost/permissions",
            json={"roles": [PRESET_VIEWER], "permissions": []},
        )
    assert response.status_code == 404


def test_settings_invites_list_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    invite = _make_invite()
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        InviteRepository, "get_all", new=AsyncMock(return_value=[invite])
    ):
        response = client.get("/api/settings/invites")
    assert response.status_code == 200
    assert response.json()[0]["inviteId"] == "inv-1"


def test_settings_invites_list_viewer_forbidden() -> None:
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.get("/api/settings/invites")
    assert response.status_code == 403


def test_settings_create_invite_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    invite = _make_invite()
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        InviteRepository, "create", new=AsyncMock(return_value=invite)
    ):
        response = client.post(
            "/api/settings/invites",
            json={"email": "new@example.com", "role_preset": "viewer"},
        )
    assert response.status_code == 201
    assert response.json()["email"] == "new@example.com"
    assert "invite_url" in response.json()


def test_settings_create_invite_editor_forbidden() -> None:
    user = _make_user(roles=[PRESET_EDITOR])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.post(
            "/api/settings/invites",
            json={"email": "new@example.com", "role_preset": "viewer"},
        )
    assert response.status_code == 403


def test_settings_domains_list_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    domain = _make_domain()
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        ApprovedDomainRepository, "list_all", new=AsyncMock(return_value=[domain])
    ):
        response = client.get("/api/settings/domains")
    assert response.status_code == 200
    assert response.json()[0]["domain"] == "example.com"


def test_settings_domains_list_viewer_forbidden() -> None:
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.get("/api/settings/domains")
    assert response.status_code == 403


def test_settings_add_domain_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    domain = _make_domain()
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        ApprovedDomainRepository, "get_by_domain", new=AsyncMock(return_value=None)
    ), patch.object(
        ApprovedDomainRepository, "create", new=AsyncMock(return_value=domain)
    ):
        response = client.post("/api/settings/domains", json={"domain": "example.com"})
    assert response.status_code == 201
    assert response.json()["domain"] == "example.com"


def test_settings_add_domain_conflict() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    domain = _make_domain()
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        ApprovedDomainRepository, "get_by_domain", new=AsyncMock(return_value=domain)
    ):
        response = client.post("/api/settings/domains", json={"domain": "example.com"})
    assert response.status_code == 409


def test_settings_remove_domain_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        ApprovedDomainRepository, "delete", new=AsyncMock(return_value=True)
    ):
        response = client.delete("/api/settings/domains/dom-1")
    assert response.status_code == 204


def test_settings_remove_domain_not_found() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    client.headers.update({"X-CSRF-Token": "x"})
    client.cookies.set("csrftoken", "x")
    s, t, u = _auth_patches(admin)
    with s, t, u, patch.object(
        ApprovedDomainRepository, "delete", new=AsyncMock(return_value=False)
    ):
        response = client.delete("/api/settings/domains/ghost")
    assert response.status_code == 404


def test_settings_providers_admin_ok() -> None:
    admin = _make_user(roles=[PRESET_ADMIN])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(admin)
    with s, t, u:
        response = client.get("/api/settings/providers")
    assert response.status_code == 200
    ids = {p["id"] for p in response.json()}
    assert ids == {"github", "gitlab", "google", "microsoft"}


def test_settings_providers_viewer_forbidden() -> None:
    user = _make_user(roles=[PRESET_VIEWER])
    client = _client()
    client.cookies.set("session", "tok")
    s, t, u = _auth_patches(user)
    with s, t, u:
        response = client.get("/api/settings/providers")
    assert response.status_code == 403
