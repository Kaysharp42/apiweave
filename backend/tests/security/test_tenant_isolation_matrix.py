"""Tenant-isolation matrix + single_user smoke (roadmap §4 / P1.7).

Consolidated cross-tenant denial proof for every scoped surface hardened in
P1.1–P1.2: a non-member (Bob) is denied on each fixed router, and the
single_user synthetic owner stays authorized (the §1.4 self-host risk).

These mount the individual routers with monkeypatched membership repos rather
than the full app — the full app needs OAuth deps (authlib) and a live Beanie
DB that this environment lacks. workspaces.py service-layer isolation
(_assert_workspace_access) therefore needs a DB-backed test and is tracked as
P1.6, not covered here.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.auth.dependencies import get_current_active_user, get_current_user
from app.auth.scope_resolver import ResourceScopeResolver
from app.repositories import WorkflowRepository
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.run_repository import RunRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.routes import runs as runs_route
from app.routes import secrets as secrets_route
from app.routes import service_tokens as tokens_route
from app.routes import webhooks as webhooks_route
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _bob() -> SimpleNamespace:
    return SimpleNamespace(userId="bob", roles=[], permissions=[])


def _deny_all_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bob is a member of nothing."""

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


def _client(router) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    # secrets/tokens routes also depend directly on get_current_user; override both.
    app.dependency_overrides[get_current_active_user] = _bob
    app.dependency_overrides[get_current_user] = _bob
    return TestClient(app)


# Each case: (label, router, method, url). All target Alice's workspace "alice-ws".
# Resources are made to *exist* (so a pass would be a real leak), then membership
# is denied — every one must come back 404 (existence-hiding), never 200.
_CASES = [
    ("secrets:list", secrets_route.router, "GET", "/api/scopes/workspace/alice-ws/secrets"),
    ("tokens:list", tokens_route.router, "GET", "/api/scopes/workspace/alice-ws/tokens"),
    ("runs:get", runs_route.router, "GET", "/api/runs/run-1"),
    ("webhooks:get", webhooks_route.router, "GET", "/api/webhooks/wh-1"),
    ("webhooks:list", webhooks_route.router, "GET", "/api/webhooks/workflows/wf-1"),
]


@pytest.mark.parametrize("label,router,method,url", _CASES, ids=[c[0] for c in _CASES])
def test_non_member_is_denied_cross_tenant(
    label: str, router, method: str, url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    _deny_all_membership(monkeypatch)

    # Make the underlying resources exist so denial is proven to come from the
    # scope check, not from a missing record.
    async def a_run(run_id: str) -> object:
        return SimpleNamespace(runId=run_id, workspaceId="alice-ws")

    async def a_webhook(webhook_id: str) -> object:
        return SimpleNamespace(webhookId=webhook_id, workspaceId="alice-ws")

    async def a_workflow(workflow_id: str) -> object:
        return SimpleNamespace(workflowId=workflow_id, workspaceId="alice-ws")

    monkeypatch.setattr(RunRepository, "get_by_id", a_run)
    monkeypatch.setattr(webhooks_route.WebhookRepository, "get_by_id", a_webhook)
    monkeypatch.setattr(WorkflowRepository, "get_by_id", a_workflow)

    resp = _client(router).request(method, url)
    assert resp.status_code == 404, f"{label} leaked: {resp.status_code}"


# --------------------------------------------------------------------------
# single_user smoke (roadmap §1.4): the synthetic owner stays authorized.
# --------------------------------------------------------------------------

SINGLE_USER_OWNER = SimpleNamespace(userId="usr-single-user-owner", roles=["admin"], permissions=[])


async def test_single_user_owner_owns_its_user_scope() -> None:
    access = await ResourceScopeResolver.resolve_scope_access(
        SINGLE_USER_OWNER, "user", "usr-single-user-owner"
    )
    assert access.allowed and access.own_user_scope


async def test_single_user_owner_authorized_in_its_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Bootstrap makes the synthetic owner a workspace ADMIN member; once the
    # global-role fallback is gone, that membership is what must keep it working.
    _deny_all_membership(monkeypatch)

    async def admin_member(workspace_id: str, user_id: str) -> object:
        return SimpleNamespace(role="admin")

    monkeypatch.setattr(WorkspaceRepository, "get_member", admin_member)

    from app.auth.dependencies import evaluate_scoped_permission

    access = await ResourceScopeResolver.resolve_scope_access(
        SINGLE_USER_OWNER, "workspace", "personal"
    )
    assert access.allowed
    # Admin member can manage secrets in its own workspace.
    assert await evaluate_scoped_permission(
        SINGLE_USER_OWNER, "secrets", "create", workspace_id="personal"
    )
