from __future__ import annotations

import pytest
from app.auth.dependencies import require_scoped_permission
from app.auth.permissions import (
    COLLECTIONS_READ,
    COLLECTIONS_RUN,
    ENVIRONMENTS_CREATE,
    ENVIRONMENTS_DELETE,
    ENVIRONMENTS_READ,
    ENVIRONMENTS_SET_SECRET,
    RUNS_CANCEL,
    RUNS_READ,
    SETTINGS_READ,
    SETTINGS_UPDATE,
    USERS_DELETE,
    USERS_INVITE,
    USERS_READ,
    USERS_UPDATE_ROLE,
    WEBHOOKS_CREATE,
    WEBHOOKS_DELETE,
    WEBHOOKS_EXECUTE,
    WEBHOOKS_READ,
    WEBHOOKS_ROTATE,
    WORKFLOWS_CREATE,
    WORKFLOWS_DELETE,
    WORKFLOWS_EXPORT,
    WORKFLOWS_IMPORT,
    WORKFLOWS_READ,
    WORKFLOWS_RUN,
    WORKFLOWS_UPDATE,
    LastOwnerError,
    OrgRole,
    ScopedPermissionEvaluator,
    WorkspaceRole,
    check_last_owner,
)
from app.auth.scope_resolver import ResolvedScope, ResourceScopeResolver
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Workspace role matrix: 5 roles x actions
# ---------------------------------------------------------------------------


class TestWorkspaceRoleRead:
    def test_can_read_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.READ)
        assert WORKFLOWS_READ in perms

    def test_can_read_environments(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.READ)
        assert ENVIRONMENTS_READ in perms

    def test_can_read_runs(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.READ)
        assert RUNS_READ in perms

    def test_cannot_create_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.READ)
        assert WORKFLOWS_CREATE not in perms

    def test_cannot_run_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.READ)
        assert WORKFLOWS_RUN not in perms

    def test_cannot_set_secrets(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.READ)
        assert ENVIRONMENTS_SET_SECRET not in perms


class TestWorkspaceRoleTriage:
    def test_can_read_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.TRIAGE)
        assert WORKFLOWS_READ in perms

    def test_can_run_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.TRIAGE)
        assert WORKFLOWS_RUN in perms

    def test_can_run_collections(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.TRIAGE)
        assert COLLECTIONS_RUN in perms

    def test_cannot_create_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.TRIAGE)
        assert WORKFLOWS_CREATE not in perms

    def test_cannot_set_secrets(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.TRIAGE)
        assert ENVIRONMENTS_SET_SECRET not in perms


class TestWorkspaceRoleWrite:
    def test_can_create_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.WRITE)
        assert WORKFLOWS_CREATE in perms

    def test_can_update_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.WRITE)
        assert WORKFLOWS_UPDATE in perms

    def test_can_delete_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.WRITE)
        assert WORKFLOWS_DELETE in perms

    def test_can_create_environments(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.WRITE)
        assert ENVIRONMENTS_CREATE in perms

    def test_cannot_export_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.WRITE)
        assert WORKFLOWS_EXPORT not in perms

    def test_cannot_set_secrets(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.WRITE)
        assert ENVIRONMENTS_SET_SECRET not in perms


class TestWorkspaceRoleMaintain:
    def test_can_export_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert WORKFLOWS_EXPORT in perms

    def test_can_import_workflows(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert WORKFLOWS_IMPORT in perms

    def test_can_create_webhooks(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert WEBHOOKS_CREATE in perms

    def test_can_delete_webhooks(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert WEBHOOKS_DELETE in perms

    def test_cannot_set_secrets(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert ENVIRONMENTS_SET_SECRET not in perms

    def test_cannot_delete_environments(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert ENVIRONMENTS_DELETE not in perms

    def test_cannot_cancel_runs(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.MAINTAIN)
        assert RUNS_CANCEL not in perms


class TestWorkspaceRoleAdmin:
    def test_can_set_secrets(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert ENVIRONMENTS_SET_SECRET in perms

    def test_can_delete_environments(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert ENVIRONMENTS_DELETE in perms

    def test_can_rotate_webhooks(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert WEBHOOKS_ROTATE in perms

    def test_can_execute_webhooks(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert WEBHOOKS_EXECUTE in perms

    def test_can_cancel_runs(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert RUNS_CANCEL in perms

    def test_can_invite_users(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert USERS_INVITE in perms

    def test_can_update_roles(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_workspace_role(WorkspaceRole.ADMIN)
        assert USERS_UPDATE_ROLE in perms


# ---------------------------------------------------------------------------
# Org role permissions
# ---------------------------------------------------------------------------


class TestOrgRolePermissions:
    def test_owner_can_manage_users(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_org_role(OrgRole.OWNER)
        assert USERS_READ in perms
        assert USERS_INVITE in perms
        assert USERS_UPDATE_ROLE in perms
        assert USERS_DELETE in perms

    def test_owner_can_manage_settings(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_org_role(OrgRole.OWNER)
        assert SETTINGS_READ in perms
        assert SETTINGS_UPDATE in perms

    def test_member_has_no_org_permissions(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_org_role(OrgRole.MEMBER)
        assert len(perms) == 0

    def test_billing_can_manage_settings(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_org_role(OrgRole.BILLING)
        assert SETTINGS_READ in perms
        assert SETTINGS_UPDATE in perms
        assert USERS_INVITE not in perms

    def test_security_can_read_settings(self) -> None:
        perms = ScopedPermissionEvaluator.permissions_for_org_role(OrgRole.SECURITY)
        assert SETTINGS_READ in perms
        assert SETTINGS_UPDATE not in perms


# ---------------------------------------------------------------------------
# Highest-allow-wins: team-read + workspace-write = effective write
# ---------------------------------------------------------------------------


class TestHighestAllowWins:
    def test_team_read_plus_workspace_write_gives_write(self) -> None:
        team_read_perms = {WORKFLOWS_READ, COLLECTIONS_READ, ENVIRONMENTS_READ}
        effective = ScopedPermissionEvaluator.evaluate(
            workspace_role=WorkspaceRole.WRITE,
            team_grants=[team_read_perms],
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_UPDATE)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)

    def test_multiple_team_grants_union(self) -> None:
        team_a_perms = {WORKFLOWS_READ, WORKFLOWS_RUN}
        team_b_perms = {WEBHOOKS_READ, WEBHOOKS_CREATE}
        effective = ScopedPermissionEvaluator.evaluate(
            team_grants=[team_a_perms, team_b_perms],
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_RUN)
        assert ScopedPermissionEvaluator.has_permission(effective, WEBHOOKS_READ)
        assert ScopedPermissionEvaluator.has_permission(effective, WEBHOOKS_CREATE)

    def test_org_owner_plus_workspace_read_gives_all(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            org_role=OrgRole.OWNER,
            workspace_role=WorkspaceRole.READ,
        )
        assert ScopedPermissionEvaluator.has_permission(effective, USERS_DELETE)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert ScopedPermissionEvaluator.has_permission(effective, SETTINGS_UPDATE)

    def test_service_token_narrows_to_its_scope(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            workspace_role=WorkspaceRole.ADMIN,
            service_token_permissions={WORKFLOWS_READ, RUNS_READ},
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)

    def test_empty_sources_contribute_nothing(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate()
        assert len(effective) == 0


# ---------------------------------------------------------------------------
# Workspace-admin manages secrets; maintain cannot
# ---------------------------------------------------------------------------


class TestSecretManagementBoundary:
    def test_workspace_admin_can_manage_secrets(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            workspace_role=WorkspaceRole.ADMIN,
        )
        assert ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)

    def test_workspace_maintain_cannot_manage_secrets(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            workspace_role=WorkspaceRole.MAINTAIN,
        )
        assert not ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)

    def test_workspace_maintain_with_separate_grant_can_manage_secrets(self) -> None:
        secret_grant = {ENVIRONMENTS_SET_SECRET}
        effective = ScopedPermissionEvaluator.evaluate(
            workspace_role=WorkspaceRole.MAINTAIN,
            team_grants=[secret_grant],
        )
        assert ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)


# ---------------------------------------------------------------------------
# Last-owner protection
# ---------------------------------------------------------------------------


class TestLastOwnerProtection:
    def test_sole_owner_cannot_be_removed(self) -> None:
        with pytest.raises(LastOwnerError) as exc_info:
            check_last_owner(owner_count=1)
        assert exc_info.value.status_code == status.HTTP_409_CONFLICT
        assert exc_info.value.headers["X-Error-Code"] == "last_owner"

    def test_sole_owner_cannot_be_demoted(self) -> None:
        with pytest.raises(LastOwnerError):
            check_last_owner(owner_count=1)

    def test_multiple_owners_can_remove_one(self) -> None:
        check_last_owner(owner_count=2)

    def test_zero_owners_raises(self) -> None:
        with pytest.raises(LastOwnerError):
            check_last_owner(owner_count=0)

    def test_last_owner_error_detail(self) -> None:
        err = LastOwnerError()
        assert err.status_code == 409
        assert "last organization owner" in err.detail


# ---------------------------------------------------------------------------
# Outside collaborator cannot escalate
# ---------------------------------------------------------------------------


class TestOutsideCollaboratorBoundary:
    def test_outside_collab_read_cannot_write(self) -> None:
        read_perms = {WORKFLOWS_READ, COLLECTIONS_READ, ENVIRONMENTS_READ, RUNS_READ}
        effective = ScopedPermissionEvaluator.evaluate(
            outside_collaborator_permissions=read_perms,
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert not ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)
        assert not ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)

    def test_outside_collab_read_cannot_escalate_via_workspace_role(self) -> None:
        read_perms = {WORKFLOWS_READ, COLLECTIONS_READ}
        effective = ScopedPermissionEvaluator.evaluate(
            outside_collaborator_permissions=read_perms,
        )
        assert not ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_UPDATE)
        assert not ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_DELETE)

    def test_outside_collab_with_explicit_write_grant(self) -> None:
        write_perms = {
            WORKFLOWS_READ,
            WORKFLOWS_CREATE,
            WORKFLOWS_UPDATE,
            WORKFLOWS_DELETE,
        }
        effective = ScopedPermissionEvaluator.evaluate(
            outside_collaborator_permissions=write_perms,
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)
        assert not ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)


# ---------------------------------------------------------------------------
# Effective workspace role computation
# ---------------------------------------------------------------------------


class TestEffectiveWorkspaceRole:
    def test_direct_role_only(self) -> None:
        result = ScopedPermissionEvaluator.effective_workspace_role(
            direct_role=WorkspaceRole.WRITE,
        )
        assert result == WorkspaceRole.WRITE

    def test_team_role_higher_than_direct(self) -> None:
        result = ScopedPermissionEvaluator.effective_workspace_role(
            direct_role=WorkspaceRole.READ,
            team_roles=[WorkspaceRole.ADMIN],
        )
        assert result == WorkspaceRole.ADMIN

    def test_direct_role_higher_than_team(self) -> None:
        result = ScopedPermissionEvaluator.effective_workspace_role(
            direct_role=WorkspaceRole.ADMIN,
            team_roles=[WorkspaceRole.READ],
        )
        assert result == WorkspaceRole.ADMIN

    def test_outside_collab_role_considered(self) -> None:
        result = ScopedPermissionEvaluator.effective_workspace_role(
            direct_role=WorkspaceRole.READ,
            outside_collab_role=WorkspaceRole.WRITE,
        )
        assert result == WorkspaceRole.WRITE

    def test_no_roles_returns_none(self) -> None:
        result = ScopedPermissionEvaluator.effective_workspace_role(direct_role=None)
        assert result is None

    def test_multiple_team_roles_picks_highest(self) -> None:
        result = ScopedPermissionEvaluator.effective_workspace_role(
            direct_role=None,
            team_roles=[WorkspaceRole.READ, WorkspaceRole.MAINTAIN, WorkspaceRole.TRIAGE],
        )
        assert result == WorkspaceRole.MAINTAIN


# ---------------------------------------------------------------------------
# Global role fallback (backwards compat)
# ---------------------------------------------------------------------------


class TestGlobalRoleFallback:
    def test_legacy_admin_role_grants_all(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            global_roles=["admin"],
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)
        assert ScopedPermissionEvaluator.has_permission(effective, ENVIRONMENTS_SET_SECRET)
        assert ScopedPermissionEvaluator.has_permission(effective, USERS_DELETE)

    def test_legacy_viewer_role_grants_read_only(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            global_roles=["viewer"],
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert not ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)

    def test_legacy_and_scoped_combine(self) -> None:
        effective = ScopedPermissionEvaluator.evaluate(
            global_roles=["viewer"],
            workspace_role=WorkspaceRole.WRITE,
        )
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)


# ---------------------------------------------------------------------------
# ResourceScopeResolver
# ---------------------------------------------------------------------------


class TestResourceScopeResolver:
    def test_resolved_scope_permission_string(self) -> None:
        scope = ResolvedScope(resource="workflows", action="read")
        assert scope.required_permission == "workflows:read"

    def test_resolved_scope_with_ids(self) -> None:
        scope = ResolvedScope(
            resource="workflows",
            action="update",
            org_id="org-123",
            workspace_id="ws-456",
        )
        assert scope.org_id == "org-123"
        assert scope.workspace_id == "ws-456"
        assert scope.required_permission == "workflows:update"

    def test_from_request_extracts_path_params(self) -> None:
        from unittest.mock import MagicMock

        request = MagicMock()
        request.path_params = {"org_slug": "acme", "workspace_slug": "api-tests"}
        resolved = ResourceScopeResolver.from_request(request, "workflows", "read")
        assert resolved.org_id == "acme"
        assert resolved.workspace_id == "api-tests"
        assert resolved.required_permission == "workflows:read"

    def test_from_request_missing_params(self) -> None:
        from unittest.mock import MagicMock

        request = MagicMock()
        request.path_params = {}
        resolved = ResourceScopeResolver.from_request(request, "environments", "create")
        assert resolved.org_id is None
        assert resolved.workspace_id is None
        assert resolved.required_permission == "environments:create"


# ---------------------------------------------------------------------------
# require_scoped_permission dependency integration
# ---------------------------------------------------------------------------


class TestRequireScopedPermissionDependency:
    def test_returns_403_when_no_permissions(self) -> None:
        from types import SimpleNamespace

        app = FastAPI()

        async def get_test_user() -> SimpleNamespace:
            return SimpleNamespace(
                roles=[],
                permissions=[],
                org_memberships=[],
                workspace_memberships=[],
                team_memberships=[],
                outside_collaborator_grants=[],
                service_token_scope=None,
            )

        @app.get("/orgs/{org_slug}/workspaces/{workspace_slug}/workflows")
        async def list_workflows(
            user=require_scoped_permission("workflows", "read"),
        ) -> dict[str, bool]:
            return {"ok": True}

        from app.auth.dependencies import get_current_active_user

        app.dependency_overrides[get_current_active_user] = get_test_user

        client = TestClient(app)
        response = client.get("/orgs/acme/workspaces/test/workflows")

        assert response.status_code == 403
        assert "workflows:read" in response.json()["detail"]

    def test_allows_when_workspace_role_grants_permission(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        from app.repositories.organization_repository import OrganizationRepository
        from app.repositories.outside_collaborator_repository import (
            OutsideCollaboratorRepository,
        )
        from app.repositories.workspace_repository import WorkspaceRepository

        app = FastAPI()

        # New contract (roadmap P1.1): scoped roles are hydrated from the
        # membership collections keyed by userId, not read off the User doc.
        async def none(*args: object, **kwargs: object) -> None:
            return None

        async def ws_member(workspace_id: str, user_id: str) -> object:
            return SimpleNamespace(role=WorkspaceRole.WRITE)

        monkeypatch.setattr(WorkspaceRepository, "get_by_id", none)
        monkeypatch.setattr(WorkspaceRepository, "get_member", ws_member)
        monkeypatch.setattr(OrganizationRepository, "get_by_id", none)
        monkeypatch.setattr(OrganizationRepository, "get_by_slug", none)
        monkeypatch.setattr(OutsideCollaboratorRepository, "get_permissions_for_workspace", none)

        async def get_test_user() -> SimpleNamespace:
            return SimpleNamespace(userId="user-1", roles=[], permissions=[])

        @app.get("/orgs/{org_slug}/workspaces/{workspace_id}/workflows")
        async def list_workflows(
            user=require_scoped_permission("workflows", "read"),
        ) -> dict[str, bool]:
            return {"ok": True}

        from app.auth.dependencies import get_current_active_user

        app.dependency_overrides[get_current_active_user] = get_test_user

        client = TestClient(app)
        response = client.get("/orgs/acme/workspaces/test/workflows")

        assert response.status_code == 200

    def test_global_admin_fallback_allows(self) -> None:
        from types import SimpleNamespace

        app = FastAPI()

        async def get_test_user() -> SimpleNamespace:
            return SimpleNamespace(
                roles=["admin"],
                permissions=[],
                org_memberships=[],
                workspace_memberships=[],
                team_memberships=[],
                outside_collaborator_grants=[],
                service_token_scope=None,
            )

        @app.get("/orgs/{org_slug}/workspaces/{workspace_slug}/secrets")
        async def manage_secrets(
            user=require_scoped_permission("environments", "set_secret"),
        ) -> dict[str, bool]:
            return {"ok": True}

        from app.auth.dependencies import get_current_active_user

        app.dependency_overrides[get_current_active_user] = get_test_user

        client = TestClient(app)
        response = client.get("/orgs/acme/workspaces/test/secrets")

        assert response.status_code == 200
