"""create_webhook scope-binding tests (roadmap P1.2 / §3.5).

create_webhook checked only a GLOBAL WEBHOOKS_CREATE and persisted a
caller-supplied workspaceId, so anyone with the global role could attach a
webhook to another tenant's workflow and mis-attribute the workspace. It now
binds to the RESOURCE's own workspace and requires webhooks:create there.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from app.auth.dependencies import get_current_active_user
from app.repositories import WorkflowRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.routes import webhooks as webhooks_route
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _user(user_id: str = "user-1") -> SimpleNamespace:
    return SimpleNamespace(userId=user_id, roles=[], permissions=[])


def _patch_no_access(monkeypatch: pytest.MonkeyPatch) -> None:
    async def none(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr(WorkspaceRepository, "get_by_id", none)
    monkeypatch.setattr(WorkspaceRepository, "get_member", none)
    monkeypatch.setattr(OrganizationRepository, "get_by_id", none)
    monkeypatch.setattr(OrganizationRepository, "get_by_slug", none)
    monkeypatch.setattr(OrganizationRepository, "get_member", none)
    monkeypatch.setattr(TeamRepository, "list_teams_for_user_in_org", none)
    monkeypatch.setattr(OutsideCollaboratorRepository, "get_by_workspace_and_user", none)
    monkeypatch.setattr(OutsideCollaboratorRepository, "get_permissions_for_workspace", none)


def _client(user: SimpleNamespace) -> TestClient:
    app = FastAPI()
    app.include_router(webhooks_route.router)
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def _body(workspace_id: str = "claimed-ws") -> dict[str, Any]:
    return {
        "resourceType": "workflow",
        "resourceId": "wf-1",
        "environmentId": "env-1",
        "workspaceId": workspace_id,  # caller-supplied; must be ignored
    }


def test_non_member_cannot_create_webhook(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    async def get_workflow(workflow_id: str) -> object:
        return SimpleNamespace(workflowId=workflow_id, workspaceId="real-ws")

    monkeypatch.setattr(WorkflowRepository, "get_by_id", get_workflow)

    resp = _client(_user("outsider")).post("/api/webhooks", json=_body())
    assert resp.status_code == 404


def test_member_creates_webhook_bound_to_resource_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_no_access(monkeypatch)

    async def get_workflow(workflow_id: str) -> object:
        return SimpleNamespace(workflowId=workflow_id, workspaceId="real-ws")

    async def get_member(workspace_id: str, user_id: str) -> object:
        assert workspace_id == "real-ws"  # authorized against the resource's ws
        return SimpleNamespace(role="admin")  # admin has webhooks:create

    created: dict[str, Any] = {}

    async def create(data: dict[str, Any]) -> object:
        created.update(data)
        return SimpleNamespace(
            webhookId=data["webhookId"],
            resourceType=data["resourceType"],
            resourceId=data["resourceId"],
            environmentId=data["environmentId"],
            enabled=True,
            description=data.get("description"),
            createdAt=datetime.now(UTC),
        )

    monkeypatch.setattr(WorkflowRepository, "get_by_id", get_workflow)
    monkeypatch.setattr(WorkspaceRepository, "get_member", get_member)
    monkeypatch.setattr(webhooks_route.WebhookRepository, "create", create)

    resp = _client(_user()).post("/api/webhooks", json=_body(workspace_id="claimed-ws"))
    assert resp.status_code == 201
    # The persisted workspace is the resource's, NOT the caller-supplied one.
    assert created["workspaceId"] == "real-ws"
    assert created["scopeId"] == "real-ws"
