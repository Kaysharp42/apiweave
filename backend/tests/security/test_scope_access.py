"""Scope-access binding tests (roadmap P1.3/P1.4 / §3.2).

The /api/scopes/{scope_type}/{scope_id}/* routes previously authorized with a
GLOBAL permission check and never bound scope_id to the caller, so any holder of
the global role could enumerate any tenant's scope. These tests prove the new
`resolve_scope_access` + `require_scope_permission` bind scope_id to the caller:
out-of-scope -> 404, own personal scope -> full access, member-without-perm -> 403.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.auth.dependencies import (
    get_current_active_user,
    require_scope_permission,
)
from app.auth.scope_resolver import ResourceScopeResolver
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.workspace_repository import WorkspaceRepository
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _user(user_id: str = "user-1") -> SimpleNamespace:
    return SimpleNamespace(userId=user_id, roles=[], permissions=[])


def _patch_no_access(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patch every repo method resolve_scope_access AND build_scope_context touch."""

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


# --------------------------------------------------------------------------
# resolve_scope_access (unit)
# --------------------------------------------------------------------------


async def test_own_user_scope_is_allowed() -> None:
    access = await ResourceScopeResolver.resolve_scope_access(_user(), "user", "user-1")
    assert access.allowed is True
    assert access.own_user_scope is True


async def test_other_user_scope_is_denied() -> None:
    access = await ResourceScopeResolver.resolve_scope_access(_user(), "user", "victim")
    assert access.allowed is False
    assert access.own_user_scope is False


async def test_workspace_member_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    async def get_member(workspace_id: str, user_id: str) -> object:
        return SimpleNamespace(role="read")

    monkeypatch.setattr(WorkspaceRepository, "get_member", get_member)

    access = await ResourceScopeResolver.resolve_scope_access(_user(), "workspace", "ws-1")
    assert access.allowed is True
    assert access.workspace_id == "ws-1"


async def test_workspace_non_member_is_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    access = await ResourceScopeResolver.resolve_scope_access(
        _user("outsider"), "workspace", "ws-1"
    )
    assert access.allowed is False


# --------------------------------------------------------------------------
# require_scope_permission (integration via FastAPI)
# --------------------------------------------------------------------------


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/scopes/{scope_type}/{scope_id}/secrets")
    async def list_secrets(
        scope_type: str,
        scope_id: str,
        user=require_scope_permission("secrets", "read"),
    ) -> dict[str, bool]:
        return {"ok": True}

    return app


def test_non_member_gets_404_not_403(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)
    app = _app()
    app.dependency_overrides[get_current_active_user] = lambda: _user("outsider")

    resp = TestClient(app).get("/api/scopes/workspace/aliceWs/secrets")
    # Existence-hiding: a non-member must not be able to tell the scope exists.
    assert resp.status_code == 404


def test_own_user_scope_allows_read(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)
    app = _app()
    app.dependency_overrides[get_current_active_user] = lambda: _user("user-1")

    resp = TestClient(app).get("/api/scopes/user/user-1/secrets")
    assert resp.status_code == 200


def test_workspace_member_without_perm_gets_403(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_access(monkeypatch)

    # Member with no role permissions that include secrets:read at workspace
    # scope... use an empty/unknown role so the evaluator grants nothing.
    async def get_member(workspace_id: str, user_id: str) -> object:
        return SimpleNamespace(role="__none__")

    monkeypatch.setattr(WorkspaceRepository, "get_member", get_member)

    app = _app()
    app.dependency_overrides[get_current_active_user] = lambda: _user("user-1")

    resp = TestClient(app).get("/api/scopes/workspace/ws-1/secrets")
    # Member (so not 404) but role grants no secrets:read => 403.
    assert resp.status_code == 403
