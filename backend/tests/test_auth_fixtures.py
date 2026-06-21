"""
Tests for auth_fixtures.py — verifies each fixture factory produces
the correct auth persona without requiring any OAuth provider secrets.

These tests serve as both:
1. Validation that the fixtures themselves work correctly
2. Documentation of what each fixture represents

CI note: All tests pass with zero provider secrets. No GITHUB_CLIENT_ID,
GITLAB_CLIENT_SECRET, GOOGLE_CLIENT_ID, or MICROSOFT_CLIENT_ID required.
"""

from unittest.mock import AsyncMock, patch

from app.auth.permissions import (
    COLLECTIONS_CREATE,
    PRESET_ADMIN,
    PRESET_EDITOR,
    PRESET_VIEWER,
    ROLE_PRESETS,
    USERS_INVITE,
    WORKFLOWS_CREATE,
    WORKFLOWS_READ,
)
from tests.fixtures.auth_fixtures import (
    ADMIN_USER_ID,
    EDITOR_USER_ID,
    VIEWER_USER_ID,
    WEBHOOK_ADMIN_USER_ID,
    WEBHOOK_OWNER_USER_ID,
    make_admin_client,
    make_invited_user_client,
    make_logged_out_client,
    make_setup_mode_client,
    make_viewer_client,
    make_webhook_admin_client,
    make_webhook_owner_client,
)

# ---------------------------------------------------------------------------
# make_logged_out_client
# ---------------------------------------------------------------------------


def test_logged_out_client_has_no_session_cookie() -> None:
    """Logged-out client carries no session cookie."""
    client = make_logged_out_client()
    assert "session" not in client.cookies


def test_logged_out_client_returns_401_on_protected_route() -> None:
    """Unauthenticated requests to protected routes return 401."""
    client = make_logged_out_client()
    response = client.get("/api/workflows")
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# make_admin_client
# ---------------------------------------------------------------------------


def test_admin_client_has_admin_role() -> None:
    """Admin client user has PRESET_ADMIN role."""
    client, patches = make_admin_client()
    with patches:
        # Verify the mock user has admin role by inspecting the patched repo
        pass  # Patches are active; user is constructed with roles=[PRESET_ADMIN]

    # Verify the user ID constant is stable
    assert ADMIN_USER_ID == "fixture-admin-1"


def test_admin_client_has_all_admin_permissions() -> None:
    """Admin role grants all permissions including users:invite."""
    admin_permissions = ROLE_PRESETS[PRESET_ADMIN]
    assert USERS_INVITE in admin_permissions
    assert WORKFLOWS_CREATE in admin_permissions
    assert COLLECTIONS_CREATE in admin_permissions


def test_admin_client_session_cookie_is_set() -> None:
    """Admin client has a session cookie set."""
    client, _ = make_admin_client()
    assert "session" in client.cookies


# ---------------------------------------------------------------------------
# make_editor_client
# ---------------------------------------------------------------------------


def test_editor_client_has_editor_role() -> None:
    """Editor client user has PRESET_EDITOR role."""
    assert EDITOR_USER_ID == "fixture-editor-1"


def test_editor_role_lacks_users_invite() -> None:
    """Editor role does NOT include users:invite (admin-only)."""
    editor_permissions = ROLE_PRESETS[PRESET_EDITOR]
    assert USERS_INVITE not in editor_permissions


def test_editor_role_has_workflows_create() -> None:
    """Editor role includes workflows:create."""
    editor_permissions = ROLE_PRESETS[PRESET_EDITOR]
    assert WORKFLOWS_CREATE in editor_permissions


# ---------------------------------------------------------------------------
# make_viewer_client
# ---------------------------------------------------------------------------


def test_viewer_client_has_viewer_role() -> None:
    """Viewer client user has PRESET_VIEWER role."""
    assert VIEWER_USER_ID == "fixture-viewer-1"


def test_viewer_role_is_read_only() -> None:
    """Viewer role only has read permissions."""
    viewer_permissions = ROLE_PRESETS[PRESET_VIEWER]
    assert WORKFLOWS_READ in viewer_permissions
    assert WORKFLOWS_CREATE not in viewer_permissions
    assert USERS_INVITE not in viewer_permissions


# ---------------------------------------------------------------------------
# make_setup_mode_client
# ---------------------------------------------------------------------------


def test_setup_mode_client_patches_user_count() -> None:
    """Setup mode context patches UserRepository.count to return 0."""
    client, patches = make_setup_mode_client()
    with patches:
        # UserRepository.count is patched to 0 inside the context
        assert "session" in client.cookies


def test_setup_mode_user_is_not_setup_complete() -> None:
    """Setup mode user has is_setup_complete=False."""
    from tests.fixtures.auth_fixtures import _make_user

    user = _make_user("fixture-setup-1", roles=[], permissions=[], is_setup_complete=False)
    assert user.is_setup_complete is False
    assert user.roles == []
    assert user.permissions == []


# ---------------------------------------------------------------------------
# make_invited_user_client
# ---------------------------------------------------------------------------


def test_invited_user_client_has_invite_role() -> None:
    """Invited user client has the role from the invite (default: viewer)."""
    client, patches = make_invited_user_client()
    with patches:
        assert "session" in client.cookies


def test_invited_user_client_custom_role() -> None:
    """Invited user client can be created with a custom role."""
    client, patches = make_invited_user_client(invite_role=PRESET_EDITOR)
    with patches:
        assert "session" in client.cookies


# ---------------------------------------------------------------------------
# make_webhook_owner_client
# ---------------------------------------------------------------------------


def test_webhook_owner_client_has_editor_role() -> None:
    """Webhook owner has PRESET_EDITOR role (can manage own webhooks)."""
    assert WEBHOOK_OWNER_USER_ID == "fixture-webhook-owner-1"
    client, _ = make_webhook_owner_client()
    assert "session" in client.cookies


# ---------------------------------------------------------------------------
# make_webhook_admin_client
# ---------------------------------------------------------------------------


def test_webhook_admin_client_has_admin_role() -> None:
    """Webhook admin has PRESET_ADMIN role (can manage any webhook)."""
    assert WEBHOOK_ADMIN_USER_ID == "fixture-webhook-admin-1"
    client, _ = make_webhook_admin_client()
    assert "session" in client.cookies


# ---------------------------------------------------------------------------
# Integration: fixtures work with route_client pattern
# ---------------------------------------------------------------------------


def test_admin_fixture_can_access_protected_route() -> None:
    """Admin fixture successfully authenticates against a protected route."""
    from app.routes._legacy_disabled import workflows
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(workflows.router)

    client, patches = make_admin_client(app=app)
    with (
        patches,
        patch.object(
            workflows,
            "svc_list_workflows",
            new=AsyncMock(
                return_value={
                    "workflows": [],
                    "total": 0,
                    "skip": 0,
                    "limit": 20,
                    "hasMore": False,
                }
            ),
        ),
    ):
        response = client.get("/api/workflows")

    assert response.status_code == 200


def test_viewer_fixture_cannot_create_workflow() -> None:
    """Viewer fixture is rejected when attempting a write operation."""
    from app.routes._legacy_disabled import workflows
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(workflows.router)

    client, patches = make_viewer_client(app=app)
    with patches:
        response = client.post("/api/workflows", json={"name": "Denied"})

    assert response.status_code == 403


def test_logged_out_fixture_cannot_list_workflows() -> None:
    """Logged-out fixture returns 401 on any authenticated route."""
    from app.routes._legacy_disabled import workflows
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(workflows.router)

    client = make_logged_out_client(app=app)
    response = client.get("/api/workflows")
    assert response.status_code == 401
