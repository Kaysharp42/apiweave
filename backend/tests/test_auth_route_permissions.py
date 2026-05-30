import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.permissions import (
    COLLECTIONS_CREATE,
    ENVIRONMENTS_READ,
    PRESET_ADMIN,
    PRESET_VIEWER,
    WEBHOOKS_UPDATE,
)
from app.models import Collection, Session, User, Webhook
from app.repositories import WebhookRepository
from app.repositories.auth_repositories import SessionRepository, UserRepository
from app.routes import collections, environments, webhooks, workflows


def make_session(token: str = "test-session-token", user_id: str = "user-1") -> tuple[Session, str]:
    now = datetime.now(UTC)
    return (
        Session.model_construct(
            sessionId=f"ses-{user_id}",
            userId=user_id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=7),
            revoked=False,
        ),
        token,
    )


def make_user(
    user_id: str = "user-1",
    roles: list[str] | None = None,
    permissions: list[str] | None = None,
) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=f"{user_id}@example.com",
        display_name="Test User",
        avatar_url=None,
        roles=roles or [],
        permissions=permissions or [],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def make_collection(collection_id: str = "col-1") -> Collection:
    now = datetime.now(UTC)
    return Collection.model_construct(
        collectionId=collection_id,
        name="Collection",
        description=None,
        color=None,
        workflowCount=0,
        workflowOrder=[],
        continueOnFail=True,
        createdAt=now,
        updatedAt=now,
    )


def make_webhook(created_by: str = "user-a") -> Webhook:
    now = datetime.now(UTC)
    return Webhook.model_construct(
        webhookId="wh-1",
        resourceType="workflow",
        resourceId="wf-1",
        environmentId="env-1",
        token="secret-token",
        hmacSecret="hmac-secret",
        enabled=True,
        description="Webhook",
        createdAt=now,
        createdBy=created_by,
        updatedAt=now,
        lastUsed=None,
        usageCount=0,
        lastStatus=None,
    )


def route_client() -> TestClient:
    app = FastAPI()
    app.include_router(workflows.router)
    app.include_router(collections.router)
    app.include_router(environments.router)
    app.include_router(webhooks.router)
    return TestClient(app)


def authenticated_patches(user: User, token: str = "test-session-token"):
    session, _ = make_session(token=token, user_id=user.userId)
    return (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    )


def test_unauthenticated_cannot_create_workflow() -> None:
    response = route_client().post("/api/workflows", json={"name": "No Auth"})

    assert response.status_code == 401


def test_unauthorized_viewer_cannot_update_workflow() -> None:
    user = make_user(roles=[PRESET_VIEWER])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch:
        response = client.put("/api/workflows/wf-1", json={"name": "Updated"})

    assert response.status_code == 403


def test_viewer_cannot_delete_workflow() -> None:
    user = make_user(roles=[PRESET_VIEWER])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch:
        response = client.delete("/api/workflows/wf-1")

    assert response.status_code == 403


def test_write_user_can_create_collection() -> None:
    user = make_user(permissions=[COLLECTIONS_CREATE])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch, patch.object(
        collections,
        "svc_create_collection",
        new=AsyncMock(return_value=make_collection()),
    ):
        response = client.post("/api/collections", json={"name": "Writable"})

    assert response.status_code == 201
    assert response.json()["collectionId"] == "col-1"


def test_viewer_cannot_create_collection() -> None:
    user = make_user(roles=[PRESET_VIEWER])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch:
        response = client.post("/api/collections", json={"name": "Denied"})

    assert response.status_code == 403


def test_non_owner_cannot_update_webhook() -> None:
    user = make_user(user_id="user-b", permissions=[WEBHOOKS_UPDATE])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch, patch.object(
        WebhookRepository,
        "get_by_id",
        new=AsyncMock(return_value=make_webhook(created_by="user-a")),
    ):
        response = client.patch("/api/webhooks/wh-1", json={"enabled": False})

    assert response.status_code == 403


def test_admin_can_manage_any_webhook() -> None:
    user = make_user(user_id="admin", roles=[PRESET_ADMIN])
    webhook = make_webhook(created_by="user-a")
    updated = make_webhook(created_by="user-a")
    updated.enabled = False
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch, patch.object(
        WebhookRepository,
        "get_by_id",
        new=AsyncMock(return_value=webhook),
    ), patch.object(
        WebhookRepository,
        "update",
        new=AsyncMock(return_value=updated),
    ):
        response = client.patch("/api/webhooks/wh-1", json={"enabled": False})

    assert response.status_code == 200
    assert response.json()["enabled"] is False


def test_environment_requires_environments_write() -> None:
    user = make_user(permissions=[ENVIRONMENTS_READ])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch:
        response = client.post("/api/environments", json={"name": "Denied"})

    assert response.status_code == 403


def test_read_routes_are_accessible_to_viewer() -> None:
    user = make_user(roles=[PRESET_VIEWER])
    client = route_client()
    client.cookies.set("session", "test-session-token")

    session_patch, touch_patch, user_patch = authenticated_patches(user)
    with session_patch, touch_patch, user_patch, patch.object(
        workflows,
        "svc_list_workflows",
        new=AsyncMock(
            return_value={"workflows": [], "total": 0, "skip": 0, "limit": 20, "hasMore": False},
        ),
    ):
        response = client.get("/api/workflows")

    assert response.status_code == 200
