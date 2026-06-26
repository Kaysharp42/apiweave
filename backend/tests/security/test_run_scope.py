"""Flat /api/runs scope-binding tests (roadmap §3.4).

The flat run routes previously used a global permission check with no scope
binding — any session with the global runs role could read any tenant's run,
and GET /api/runs returned every tenant's runs. These tests prove each route
now binds the run/workflow to its workspace and enforces membership.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.auth.dependencies import get_current_active_user
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.run_repository import RunRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.routes import runs as runs_route
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
    app.include_router(runs_route.router)
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app)


def test_get_run_404_for_non_member(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    async def get_run(run_id: str) -> object:
        return SimpleNamespace(runId=run_id, workspaceId="alice-ws")

    monkeypatch.setattr(RunRepository, "get_by_id", get_run)

    resp = _client(_user("outsider")).get("/api/runs/run-1")
    # Non-member must not be able to read another tenant's run.
    assert resp.status_code == 404


def test_member_without_cancel_perm_is_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    async def get_run(run_id: str) -> object:
        return SimpleNamespace(runId=run_id, workspaceId="ws-1")

    async def get_member(workspace_id: str, user_id: str) -> object:
        return SimpleNamespace(role="read")  # read role lacks runs:cancel

    monkeypatch.setattr(RunRepository, "get_by_id", get_run)
    monkeypatch.setattr(WorkspaceRepository, "get_member", get_member)

    resp = _client(_user()).delete("/api/runs/run-1")
    assert resp.status_code == 404  # existence-hiding: insufficient perm => not found


def test_admin_member_can_cancel(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    async def get_run(run_id: str) -> object:
        return SimpleNamespace(runId=run_id, workspaceId="ws-1")

    async def get_member(workspace_id: str, user_id: str) -> object:
        return SimpleNamespace(role="admin")  # admin has runs:cancel

    async def svc_cancel_run(run_id: str) -> None:
        return None

    monkeypatch.setattr(RunRepository, "get_by_id", get_run)
    monkeypatch.setattr(WorkspaceRepository, "get_member", get_member)
    monkeypatch.setattr(runs_route, "svc_cancel_run", svc_cancel_run)

    resp = _client(_user()).delete("/api/runs/run-1")
    assert resp.status_code == 204  # authorization passed, run cancelled


def test_list_runs_requires_workflow_id(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)
    # No workflow_id => 422 (required query param); the unfiltered "list all" leak is gone.
    resp = _client(_user()).get("/api/runs")
    assert resp.status_code == 422
