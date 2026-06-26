"""Scope-resolver hydration tests (roadmap P1.1 / Bug A).

`build_scope_context` previously read `user.org_memberships` etc. — attributes
the `User` document does not have — so every scoped permission check silently
degraded to global-role-only. These tests prove it now hydrates the caller's
real workspace/org/outside-collaborator roles from the membership collections
for the resolved scope, and that a non-member gets nothing.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from app.auth.permissions import (
    WORKFLOWS_CREATE,
    WORKFLOWS_READ,
    ScopedPermissionEvaluator,
)
from app.auth.scope_resolver import ResolvedScope, ResourceScopeResolver
from app.repositories.organization_repository import OrganizationRepository
from app.repositories.outside_collaborator_repository import OutsideCollaboratorRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.workspace_repository import WorkspaceRepository


def _user(user_id: str = "user-1") -> SimpleNamespace:
    return SimpleNamespace(userId=user_id, roles=[], permissions=[])


def _patch_no_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default everything to 'not a member / nothing found'."""

    async def none(*args: object, **kwargs: object) -> None:
        return None

    async def empty_perms(*args: object, **kwargs: object) -> None:
        return None

    monkeypatch.setattr(WorkspaceRepository, "get_by_id", none)
    monkeypatch.setattr(WorkspaceRepository, "get_member", none)
    monkeypatch.setattr(OrganizationRepository, "get_by_id", none)
    monkeypatch.setattr(OrganizationRepository, "get_by_slug", none)
    monkeypatch.setattr(OrganizationRepository, "get_member", none)
    monkeypatch.setattr(TeamRepository, "list_teams_for_user_in_org", none)
    monkeypatch.setattr(OutsideCollaboratorRepository, "get_permissions_for_workspace", empty_perms)


async def test_workspace_member_role_is_hydrated(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_membership(monkeypatch)

    async def get_member(workspace_id: str, user_id: str) -> object:
        assert workspace_id == "ws-1"
        return SimpleNamespace(role="write")

    monkeypatch.setattr(WorkspaceRepository, "get_member", get_member)

    resolved = ResolvedScope(resource="workflows", action="create", workspace_id="ws-1")
    ctx = await ResourceScopeResolver.build_scope_context(_user(), resolved)

    assert ctx["workspace_role"] == "write"
    effective = ScopedPermissionEvaluator.evaluate(**_evaluate_kwargs(ctx))
    assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)


async def test_non_member_gets_no_scoped_permissions(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_no_membership(monkeypatch)

    resolved = ResolvedScope(resource="workflows", action="create", workspace_id="ws-1")
    ctx = await ResourceScopeResolver.build_scope_context(_user("outsider"), resolved)

    assert ctx["workspace_role"] is None
    assert ctx["org_role"] is None
    effective = ScopedPermissionEvaluator.evaluate(**_evaluate_kwargs(ctx))
    # No global role, no scoped role => not even read.
    assert not ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)


async def test_outside_collaborator_permissions_are_hydrated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_no_membership(monkeypatch)

    async def oc_perms(workspace_id: str, user_id: str) -> set[str]:
        return {WORKFLOWS_READ}

    monkeypatch.setattr(OutsideCollaboratorRepository, "get_permissions_for_workspace", oc_perms)

    resolved = ResolvedScope(resource="workflows", action="read", workspace_id="ws-1")
    ctx = await ResourceScopeResolver.build_scope_context(_user(), resolved)

    assert ctx["outside_collaborator_permissions"] == {WORKFLOWS_READ}
    effective = ScopedPermissionEvaluator.evaluate(**_evaluate_kwargs(ctx))
    assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
    # Outside read collaborator cannot create.
    assert not ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)


def _evaluate_kwargs(ctx: dict[str, object]) -> dict[str, object]:
    return {
        "org_role": ctx["org_role"],
        "workspace_role": ctx["workspace_role"],
        "team_grants": ctx["team_grants"],
        "outside_collaborator_permissions": ctx["outside_collaborator_permissions"],
        "service_token_permissions": ctx["service_token_permissions"],
        "global_roles": ctx["global_roles"],
        "global_permissions": ctx["global_permissions"],
    }
