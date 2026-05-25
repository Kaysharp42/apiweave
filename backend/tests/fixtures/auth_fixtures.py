"""
Auth test fixtures for E2E-ish QA scenarios.

Provides pre-configured TestClient instances for each auth persona:
- logged-out (no session)
- admin (all permissions via PRESET_ADMIN role)
- editor (PRESET_EDITOR role — no users:invite)
- viewer (PRESET_VIEWER role — read-only)
- setup mode (no users exist, first-run state)
- invited user (valid unconsumed invite)
- webhook owner (created the webhook)
- webhook admin (admin overriding any webhook)

All fixtures use the mock patch pattern from test_auth_route_permissions.py —
no real OAuth provider secrets, no real database, no real sessions.

Usage in tests:
    from tests.fixtures.auth_fixtures import (
        make_admin_client,
        make_editor_client,
        make_viewer_client,
        make_logged_out_client,
        make_setup_mode_client,
        make_invited_user_client,
        make_webhook_owner_client,
        make_webhook_admin_client,
        ADMIN_USER_ID,
        EDITOR_USER_ID,
        VIEWER_USER_ID,
        WEBHOOK_OWNER_USER_ID,
    )

    def test_admin_can_invite(make_admin_client):
        client, patches = make_admin_client()
        with patches:
            response = client.post("/api/users/invite", json={...})
        assert response.status_code == 201
"""

import hashlib
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Generator
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.permissions import PRESET_ADMIN, PRESET_EDITOR, PRESET_VIEWER, ROLE_PRESETS
from app.models import Invite, Session, User
from app.repositories.auth_repositories import SessionRepository, UserRepository

# ---------------------------------------------------------------------------
# Stable test IDs — use these in assertions to avoid magic strings
# ---------------------------------------------------------------------------

ADMIN_USER_ID: str = "fixture-admin-1"
EDITOR_USER_ID: str = "fixture-editor-1"
VIEWER_USER_ID: str = "fixture-viewer-1"
SETUP_MODE_USER_ID: str = "fixture-setup-1"
INVITED_USER_ID: str = "fixture-invited-1"
WEBHOOK_OWNER_USER_ID: str = "fixture-webhook-owner-1"
WEBHOOK_ADMIN_USER_ID: str = "fixture-webhook-admin-1"

_SESSION_TOKEN: str = "fixture-session-token"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _make_session(user_id: str, token: str = _SESSION_TOKEN) -> Session:
    """Build a mock Session bypassing Beanie init."""
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
    user_id: str,
    roles: list[str] | None = None,
    permissions: list[str] | None = None,
    is_setup_complete: bool = True,
    email: str | None = None,
) -> User:
    """Build a mock User bypassing Beanie init."""
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=email or f"{user_id}@example.com",
        display_name=f"Test {user_id}",
        avatar_url=None,
        roles=roles or [],
        permissions=permissions or [],
        is_setup_complete=is_setup_complete,
        created_at=now,
        updated_at=now,
    )


def _make_invite(
    email: str = "invited@example.com",
    role_preset: str = PRESET_VIEWER,
    consumed: bool = False,
) -> Invite:
    """Build a mock Invite bypassing Beanie init."""
    now = datetime.now(UTC)
    return Invite.model_construct(
        inviteId="inv-fixture-1",
        email=email,
        token_hash=hashlib.sha256(b"fixture-invite-token").hexdigest(),
        role_preset=role_preset,
        created_by=ADMIN_USER_ID,
        created_at=now,
        expires_at=now + timedelta(days=7),
        consumed=consumed,
        consumed_at=None,
    )


def _default_app() -> FastAPI:
    """Minimal FastAPI app with all auth-relevant routers mounted."""
    from app.routes import collections, environments, webhooks, workflows

    app = FastAPI()
    app.include_router(workflows.router)
    app.include_router(collections.router)
    app.include_router(environments.router)
    app.include_router(webhooks.router)
    return app


@contextmanager
def _auth_patches(
    user: User,
    token: str = _SESSION_TOKEN,
) -> Generator[None, None, None]:
    """Context manager that patches SessionRepository + UserRepository for one user."""
    session = _make_session(user.userId, token)
    with (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    ):
        yield


# ---------------------------------------------------------------------------
# Public fixture factories
# ---------------------------------------------------------------------------


def make_logged_out_client(app: FastAPI | None = None) -> TestClient:
    """
    TestClient with NO session cookie.

    All authenticated endpoints should return 401.
    No patches needed — the real auth dependency raises 401 when no session exists.
    """
    return TestClient(app or _default_app())


def make_admin_client(
    app: FastAPI | None = None,
    user_id: str = ADMIN_USER_ID,
    token: str = _SESSION_TOKEN,
) -> tuple[TestClient, "_AuthPatchContext"]:
    """
    TestClient authenticated as an admin (all permissions via PRESET_ADMIN role).

    Returns (client, patches) — use `with patches:` to activate the mocks.

    Example::

        client, patches = make_admin_client()
        with patches:
            response = client.post("/api/collections", json={"name": "Test"})
        assert response.status_code == 201
    """
    user = _make_user(user_id, roles=[PRESET_ADMIN])
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _AuthPatchContext(user, token)


def make_editor_client(
    app: FastAPI | None = None,
    user_id: str = EDITOR_USER_ID,
    token: str = _SESSION_TOKEN,
) -> tuple[TestClient, "_AuthPatchContext"]:
    """
    TestClient authenticated as an editor.

    Editor permissions: all workflow/collection/environment/webhook CRUD + run,
    but NO users:invite, users:update_role, users:delete, settings:update.
    """
    user = _make_user(user_id, roles=[PRESET_EDITOR])
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _AuthPatchContext(user, token)


def make_viewer_client(
    app: FastAPI | None = None,
    user_id: str = VIEWER_USER_ID,
    token: str = _SESSION_TOKEN,
) -> tuple[TestClient, "_AuthPatchContext"]:
    """
    TestClient authenticated as a viewer (read-only).

    Viewer permissions: workflows:read, collections:read, environments:read,
    webhooks:read, runs:read — nothing else.
    """
    user = _make_user(user_id, roles=[PRESET_VIEWER])
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _AuthPatchContext(user, token)


def make_setup_mode_client(
    app: FastAPI | None = None,
    token: str = _SESSION_TOKEN,
) -> tuple[TestClient, "_SetupModePatchContext"]:
    """
    TestClient simulating setup mode (no users exist yet, first-run state).

    The user object has is_setup_complete=False and no roles/permissions.
    UserRepository.count is patched to return 0 to simulate an empty database.

    Use this to test the /api/auth/setup endpoint and setup-mode guards.
    """
    user = _make_user(
        SETUP_MODE_USER_ID,
        roles=[],
        permissions=[],
        is_setup_complete=False,
    )
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _SetupModePatchContext(user, token)


def make_invited_user_client(
    app: FastAPI | None = None,
    user_id: str = INVITED_USER_ID,
    token: str = _SESSION_TOKEN,
    invite_role: str = PRESET_VIEWER,
) -> tuple[TestClient, "_InvitedUserPatchContext"]:
    """
    TestClient for a user who arrived via an invite link.

    The user has the role from the invite (default: viewer).
    The invite is valid (not consumed, not expired).
    """
    user = _make_user(user_id, roles=[invite_role])
    invite = _make_invite(email=f"{user_id}@example.com", role_preset=invite_role)
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _InvitedUserPatchContext(user, invite, token)


def make_webhook_owner_client(
    app: FastAPI | None = None,
    user_id: str = WEBHOOK_OWNER_USER_ID,
    token: str = _SESSION_TOKEN,
) -> tuple[TestClient, "_AuthPatchContext"]:
    """
    TestClient for the user who owns a webhook (createdBy == user_id).

    Has PRESET_EDITOR permissions (can create/update/delete own webhooks).
    Use WEBHOOK_OWNER_USER_ID as the createdBy value when constructing test webhooks.
    """
    user = _make_user(user_id, roles=[PRESET_EDITOR])
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _AuthPatchContext(user, token)


def make_webhook_admin_client(
    app: FastAPI | None = None,
    user_id: str = WEBHOOK_ADMIN_USER_ID,
    token: str = _SESSION_TOKEN,
) -> tuple[TestClient, "_AuthPatchContext"]:
    """
    TestClient for an admin overriding any webhook (admin bypass).

    Admins can manage webhooks they did not create.
    Use this to test the admin override path in webhook permission checks.
    """
    user = _make_user(user_id, roles=[PRESET_ADMIN])
    client = TestClient(app or _default_app())
    client.cookies.set("session", token)
    return client, _AuthPatchContext(user, token)


# ---------------------------------------------------------------------------
# Patch context helpers (returned alongside clients)
# ---------------------------------------------------------------------------


class _AuthPatchContext:
    """
    Context manager that activates SessionRepository + UserRepository mocks.

    Usage::

        client, patches = make_admin_client()
        with patches:
            response = client.get("/api/workflows")
    """

    def __init__(self, user: User, token: str = _SESSION_TOKEN) -> None:
        self._user = user
        self._token = token
        self._ctx: contextmanager | None = None  # type: ignore[type-arg]

    def __enter__(self) -> "_AuthPatchContext":
        self._ctx = _auth_patches(self._user, self._token)
        self._ctx.__enter__()
        return self

    def __exit__(self, *args: object) -> None:
        if self._ctx is not None:
            self._ctx.__exit__(*args)


class _SetupModePatchContext(_AuthPatchContext):
    """
    Extends _AuthPatchContext with a UserRepository.count=0 patch
    to simulate an empty database (setup mode).
    """

    def __enter__(self) -> "_SetupModePatchContext":
        super().__enter__()
        self._count_patch = patch.object(
            UserRepository,
            "count",
            new=AsyncMock(return_value=0),
        )
        self._count_patch.start()
        return self

    def __exit__(self, *args: object) -> None:
        if hasattr(self, "_count_patch"):
            self._count_patch.stop()
        super().__exit__(*args)


class _InvitedUserPatchContext(_AuthPatchContext):
    """
    Extends _AuthPatchContext with an InviteRepository mock
    so the invite token resolves to a valid, unconsumed invite.
    """

    def __init__(self, user: User, invite: Invite, token: str = _SESSION_TOKEN) -> None:
        super().__init__(user, token)
        self._invite = invite

    def __enter__(self) -> "_InvitedUserPatchContext":
        super().__enter__()
        from app.repositories.auth_repositories import InviteRepository

        self._invite_patch = patch.object(
            InviteRepository,
            "get_by_token_hash",
            new=AsyncMock(return_value=self._invite),
        )
        self._invite_patch.start()
        return self

    def __exit__(self, *args: object) -> None:
        if hasattr(self, "_invite_patch"):
            self._invite_patch.stop()
        super().__exit__(*args)
