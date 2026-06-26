import hashlib
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from app.middleware.webhook_auth import generate_hmac_signature
from app.models import Session, User, Webhook
from app.repositories import WebhookRepository, WorkflowRepository
from app.repositories.auth_repositories import SessionRepository, UserRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.routes import webhooks
from fastapi import FastAPI
from fastapi.testclient import TestClient


def route_client() -> TestClient:
    app = FastAPI()
    app.include_router(webhooks.router)
    return TestClient(app)


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


def make_user(permissions: list[str] | None = None) -> User:
    now = datetime.now(UTC)
    return User.model_construct(
        userId="user-1",
        verified_email="user@example.com",
        display_name="Test User",
        avatar_url=None,
        roles=[],
        permissions=permissions or [],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def make_webhook() -> Webhook:
    now = datetime.now(UTC)
    return Webhook.model_construct(
        webhookId="webhook-123",
        resourceType="workflow",
        resourceId="wf-123",
        environmentId="env-test",
        token="test-token",
        hmacSecret="hmac-secret",
        enabled=True,
        description="Test webhook",
        createdAt=now,
        createdBy="user-1",
        updatedAt=now,
        lastUsed=None,
        usageCount=0,
        lastStatus=None,
    )


def authenticated_patches(user: User, token: str = "test-session-token"):
    session, _ = make_session(token=token, user_id=user.userId)
    return (
        patch.object(SessionRepository, "get_by_token_hash", new=AsyncMock(return_value=session)),
        patch.object(SessionRepository, "touch", new=AsyncMock(return_value=True)),
        patch.object(UserRepository, "get_by_id", new=AsyncMock(return_value=user)),
    )


def _mock_webhook_log(*_args, **_kwargs):
    mock_log = MagicMock()
    mock_log.insert = AsyncMock(return_value=mock_log)
    return mock_log


def _mock_run(*_args, **kwargs):
    mock_run = MagicMock()
    mock_run.runId = kwargs.get("runId", "run-123")
    mock_run.insert = AsyncMock(return_value=mock_run)
    return mock_run


def _close_background_task(coroutine):
    coroutine.close()
    return MagicMock()


def test_webhook_management_requires_user_session() -> None:
    response = route_client().get("/api/webhooks/workflows/wf-123")

    assert response.status_code == 401


def _deny_membership_patches():
    """Patch every repo build_scope_context / resolve_scope_access touches to deny."""
    none = AsyncMock(return_value=None)
    return (
        patch.object(WorkspaceRepository, "get_by_id", new=none),
        patch.object(WorkspaceRepository, "get_member", new=none),
        patch.object(OrganizationRepository, "get_member", new=none),
        patch.object(OutsideCollaboratorRepository, "get_by_workspace_and_user", new=none),
        patch.object(OutsideCollaboratorRepository, "get_permissions_for_workspace", new=none),
    )


def test_webhook_list_denies_non_member() -> None:
    # New model (P1.2): a global permission no longer grants access; non-members
    # of the resource's workspace get 404 (existence-hiding), not 403.
    client = route_client()
    client.cookies.set("session", "test-session-token")
    user = make_user(permissions=[])
    session_patch, touch_patch, user_patch = authenticated_patches(user)
    d1, d2, d3, d4, d5 = _deny_membership_patches()

    with (
        session_patch,
        touch_patch,
        user_patch,
        patch.object(
            WorkflowRepository,
            "get_by_id",
            new=AsyncMock(return_value=MagicMock(workspaceId="ws-1")),
        ),
        d1,
        d2,
        d3,
        d4,
        d5,
    ):
        response = client.get("/api/webhooks/workflows/wf-123")

    assert response.status_code == 404


def test_webhook_list_allows_workspace_member() -> None:
    # A workspace admin member has webhooks:read in that workspace → 200, even
    # with no global permission.
    client = route_client()
    client.cookies.set("session", "test-session-token")
    user = make_user(permissions=[])
    session_patch, touch_patch, user_patch = authenticated_patches(user)
    none = AsyncMock(return_value=None)

    with (
        session_patch,
        touch_patch,
        user_patch,
        patch.object(
            WorkflowRepository,
            "get_by_id",
            new=AsyncMock(return_value=MagicMock(workspaceId="ws-1")),
        ),
        patch.object(WorkspaceRepository, "get_by_id", new=none),
        patch.object(
            WorkspaceRepository, "get_member", new=AsyncMock(return_value=MagicMock(role="admin"))
        ),
        patch.object(OrganizationRepository, "get_member", new=none),
        patch.object(OutsideCollaboratorRepository, "get_by_workspace_and_user", new=none),
        patch.object(OutsideCollaboratorRepository, "get_permissions_for_workspace", new=none),
        patch.object(WebhookRepository, "get_by_resource", new=AsyncMock(return_value=[])),
    ):
        response = client.get("/api/webhooks/workflows/wf-123")

    assert response.status_code == 200
    assert response.json() == []


def test_production_hmac_required() -> None:
    with (
        patch("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", True),
        patch.object(WebhookRepository, "get_by_id", new=AsyncMock(return_value=make_webhook())),
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        response = route_client().post(
            "/api/webhooks/workflows/webhook-123/execute",
            content=b'{"test":"data"}',
            headers={
                "X-Webhook-Token": "test-token",
                "Content-Type": "application/json",
            },
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing X-Webhook-Signature header"


def test_webhook_execution_m2m_still_works() -> None:
    body = b'{"test":"data"}'
    timestamp = str(int(time.time()))
    signature = generate_hmac_signature("hmac-secret", timestamp, body)

    with (
        patch("app.routes.webhooks.settings.WEBHOOK_REQUIRE_HMAC", True),
        patch.object(WebhookRepository, "get_by_id", new=AsyncMock(return_value=make_webhook())),
        patch(
            "app.routes.webhooks.WorkflowRepository.get_by_id",
            new=AsyncMock(return_value=MagicMock()),
        ),
        patch("app.routes.webhooks.webhook_runner") as mock_runner,
        patch("app.routes.webhooks.WebhookLog", side_effect=_mock_webhook_log),
    ):
        mock_runner.enqueue = AsyncMock(return_value="run-m2m-test")
        response = route_client().post(
            "/api/webhooks/workflows/webhook-123/execute",
            content=body,
            headers={
                "X-Webhook-Token": "test-token",
                "X-Webhook-Timestamp": timestamp,
                "X-Webhook-Signature": signature,
                "Content-Type": "application/json",
            },
        )

    assert response.status_code == 202
    assert response.json()["status"] == "accepted"
