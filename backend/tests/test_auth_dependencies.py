import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.dependencies import csrf_protect, require_permission, rotate_session
from app.auth.permissions import COLLECTIONS_CREATE, PRESET_VIEWER
from app.auth.router import router as auth_router
from app.models import Session, User
from app.repositories.auth_repositories import SessionRepository, UserRepository


def make_session(
    token: str = "test-session-token",
    user_id: str = "user-1",
) -> tuple[Session, str]:
    now = datetime.now(UTC)
    return (
        Session.model_construct(
            sessionId="ses-test",
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
        verified_email="user@example.com",
        display_name="Test User",
        avatar_url=None,
        roles=roles or [],
        permissions=permissions or [],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def auth_client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


def test_missing_session_returns_401() -> None:
    response = auth_client().get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_invalid_session_returns_401() -> None:
    client = auth_client()
    client.cookies.set("session", "random-token")

    with patch.object(
        SessionRepository,
        "get_by_token_hash",
        new=AsyncMock(return_value=None),
    ):
        response = client.get("/api/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid session"


def test_api_auth_me_returns_profile() -> None:
    session, token = make_session()
    user = make_user(roles=["viewer"], permissions=["collections:read"])
    client = auth_client()
    client.cookies.set("session", token)

    with patch.object(
        SessionRepository,
        "get_by_token_hash",
        new=AsyncMock(return_value=session),
    ), patch.object(
        SessionRepository,
        "touch",
        new=AsyncMock(return_value=True),
    ), patch.object(
        UserRepository,
        "get_by_id",
        new=AsyncMock(return_value=user),
    ):
        response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.json()["userId"] == "user-1"
    assert response.json()["verified_email"] == "user@example.com"
    assert "session" not in response.text


def test_mutation_without_csrf_returns_403() -> None:
    app = FastAPI()

    @app.post("/mutate", dependencies=[Depends(csrf_protect)])
    async def mutate() -> dict[str, bool]:
        return {"ok": True}

    response = TestClient(app).post("/mutate")

    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF token missing"


def test_logout_revokes_session() -> None:
    session, token = make_session()
    client = auth_client()
    client.cookies.set("session", token)
    client.cookies.set("csrftoken", "csrf-token")

    with patch.object(
        SessionRepository,
        "get_by_token_hash",
        new=AsyncMock(return_value=session),
    ), patch.object(
        SessionRepository,
        "revoke",
        new=AsyncMock(return_value=True),
    ) as revoke:
        response = client.post(
            "/api/auth/logout",
            headers={"X-CSRF-Token": "csrf-token"},
        )

    assert response.status_code == 200
    assert response.json() == {"revoked": True}
    revoke.assert_awaited_once_with("ses-test")
    assert "session=" in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_csrf_token_endpoint_sets_cookie() -> None:
    response = auth_client().get("/api/auth/csrf-token")

    assert response.status_code == 200
    assert response.json()["csrfToken"]
    assert "csrftoken=" in response.headers["set-cookie"]
    assert "HttpOnly" not in response.headers["set-cookie"]


def test_session_touch_refreshes_last_seen() -> None:
    session, token = make_session()
    client = auth_client()
    client.cookies.set("session", token)
    client.cookies.set("csrftoken", "csrf-token")

    with patch.object(
        SessionRepository,
        "get_by_token_hash",
        new=AsyncMock(return_value=session),
    ), patch.object(
        SessionRepository,
        "touch",
        new=AsyncMock(return_value=True),
    ) as touch:
        response = client.post(
            "/api/auth/session/touch",
            headers={"X-CSRF-Token": "csrf-token"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "touched"
    assert touch.await_count == 1
    assert touch.await_args.args[0] == "ses-test"


def test_permission_dependency_returns_403_for_missing_permission() -> None:
    session, token = make_session()
    user = make_user(roles=[PRESET_VIEWER])
    app = FastAPI()

    @app.get("/needs-collection-create")
    async def needs_collection_create(
        current_user: User = require_permission(COLLECTIONS_CREATE),
    ) -> dict[str, str]:
        return {"userId": current_user.userId}

    client = TestClient(app)
    client.cookies.set("session", token)

    with patch.object(
        SessionRepository,
        "get_by_token_hash",
        new=AsyncMock(return_value=session),
    ), patch.object(
        SessionRepository,
        "touch",
        new=AsyncMock(return_value=True),
    ), patch.object(
        UserRepository,
        "get_by_id",
        new=AsyncMock(return_value=user),
    ):
        response = client.get("/needs-collection-create")

    assert response.status_code == 403
    assert response.json()["detail"] == f"Missing required permission: {COLLECTIONS_CREATE}"


@pytest.mark.asyncio
async def test_session_rotation() -> None:
    old_session, old_token = make_session("old-token")
    new_session, _ = make_session("new-token")
    new_session.sessionId = "ses-new"

    with patch.object(
        SessionRepository,
        "revoke",
        new=AsyncMock(return_value=True),
    ) as revoke, patch.object(
        SessionRepository,
        "create",
        new=AsyncMock(return_value=new_session),
    ) as create:
        rotated_session, new_token = await rotate_session(old_session)

    assert rotated_session.sessionId == "ses-new"
    assert new_token != old_token
    assert len(new_token) == 64
    revoke.assert_awaited_once_with("ses-test")
    create.assert_awaited_once()
    assert create.await_args.kwargs["user_id"] == "user-1"
    assert create.await_args.kwargs["token_hash"] == hashlib.sha256(new_token.encode()).hexdigest()
    assert create.await_args.kwargs["token_hash"] != new_token
