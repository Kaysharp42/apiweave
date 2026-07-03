"""
Task 26 — Org flows: CRUD, members, teams, invites, outside collaborators.

Covers the full lifecycle:
- Org CRUD (create, read, update, delete, restore)
- Member management (add, list, update role, remove)
- Team CRUD + members + permission grants
- Invite lifecycle (create, list, accept, cancel)
- Outside collaborators (add, list, remove)
- Negative authorization tests (403 for non-owners, non-members)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.auth.dependencies import get_current_active_user
from app.routes.orgs import router as orgs_router
from app.routes.workspaces import router as workspaces_router
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(user_id: str = "user-1", email: str = "owner@example.com") -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        userId=user_id,
        verified_email=email,
        display_name="Test User",
        roles=[],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


def _make_org_response(
    org_id: str = "org-test123",
    slug: str = "acme",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        orgId=org_id,
        slug=slug,
        name="Acme Corp",
        ownerUserId="user-1",
        description=None,
        avatarUrl=None,
        createdAt=now,
        updatedAt=now,
        deletedAt=None,
    )


def _make_member(
    member_id: str = "om-1",
    org_id: str = "org-test123",
    user_id: str = "user-1",
    role: str = "owner",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        memberId=member_id,
        orgId=org_id,
        userId=user_id,
        role=role,
        createdAt=now,
        updatedAt=now,
    )


def _make_team_response(
    team_id: str = "team-1",
    org_id: str = "org-test123",
    slug: str = "backend",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        teamId=team_id,
        orgId=org_id,
        slug=slug,
        name="Backend",
        description=None,
        createdAt=now,
        updatedAt=now,
    )


def _make_invite_response(
    invite_id: str = "oi-1",
    org_id: str = "org-test123",
    email: str = "new@example.com",
    role: str = "member",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        inviteId=invite_id,
        orgId=org_id,
        email=email,
        token="raw-token-value",
        role=role,
        invitedBy="user-1",
        createdAt=now,
        expires_at=now + timedelta(days=7),
        consumed=False,
        consumedAt=None,
    )


# ---------------------------------------------------------------------------
# Org CRUD
# ---------------------------------------------------------------------------


class TestOrgCRUDFlows:
    """Full org CRUD lifecycle via route layer."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_create_org(self) -> None:
        org_resp = _make_org_response()
        with patch(
            "app.routes.orgs.org_service.create_org",
            new=AsyncMock(return_value=org_resp),
        ):
            resp = self.client.post("/api/orgs", json={"name": "Acme Corp", "slug": "acme"})
            assert resp.status_code == 201
            assert resp.json()["slug"] == "acme"

    def test_list_orgs(self) -> None:
        with patch(
            "app.routes.orgs.org_service.list_orgs_for_user",
            new=AsyncMock(return_value=[]),
        ):
            resp = self.client.get("/api/orgs")
            assert resp.status_code == 200
            assert resp.json() == []

    def test_get_org(self) -> None:
        org_resp = _make_org_response()
        with patch(
            "app.routes.orgs.org_service.get_org",
            new=AsyncMock(return_value=org_resp),
        ):
            resp = self.client.get("/api/orgs/acme")
            assert resp.status_code == 200
            assert resp.json()["slug"] == "acme"

    def test_update_org(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        updated_org = _make_org_response()
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.update_org",
                new=AsyncMock(return_value=updated_org),
            ),
        ):
            resp = self.client.patch("/api/orgs/acme", json={"name": "New Name"})
            assert resp.status_code == 200

    def test_delete_org(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.delete_org",
                new=AsyncMock(return_value={"status": "deleted", "orgId": "org-test123"}),
            ),
        ):
            resp = self.client.delete("/api/orgs/acme")
            assert resp.status_code == 200
            assert resp.json()["status"] == "deleted"


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------


class TestOrgMemberFlows:
    """Member management: add, list, update role, remove."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_list_members(self) -> None:
        now = datetime.now(UTC)
        org_member = _make_member(role="owner")
        members = [
            SimpleNamespace(
                memberId="om-1",
                orgId="org-1",
                userId="user-1",
                role="owner",
                createdAt=now,
                updatedAt=now,
            ),
        ]
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.list_members",
                new=AsyncMock(return_value=members),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/members")
            assert resp.status_code == 200
            assert len(resp.json()) == 1

    def test_add_member(self) -> None:
        now = datetime.now(UTC)
        org_member = _make_member(role="owner")
        new_member = SimpleNamespace(
            memberId="om-2",
            orgId="org-1",
            userId="user-2",
            role="member",
            createdAt=now,
            updatedAt=now,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.add_member",
                new=AsyncMock(return_value=new_member),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/members",
                json={"user_id": "user-2", "role": "member"},
            )
            assert resp.status_code == 201

    def test_update_member_role(self) -> None:
        now = datetime.now(UTC)
        org_member = _make_member(role="owner")
        updated = SimpleNamespace(
            memberId="om-2",
            orgId="org-1",
            userId="user-2",
            role="billing",
            createdAt=now,
            updatedAt=now,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.update_member_role",
                new=AsyncMock(return_value=updated),
            ),
        ):
            resp = self.client.patch(
                "/api/orgs/acme/members/user-2",
                json={"role": "billing"},
            )
            assert resp.status_code == 200

    def test_remove_member(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.remove_member",
                new=AsyncMock(return_value={"status": "removed"}),
            ),
        ):
            resp = self.client.delete("/api/orgs/acme/members/user-2")
            assert resp.status_code == 200

    def test_non_member_cannot_list_members(self) -> None:
        """Negative auth: non-member gets 403."""
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="Not a member"),
                ),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/members")
            assert resp.status_code == 403

    def test_non_owner_cannot_add_member(self) -> None:
        """Negative auth: non-owner gets 403 on add member."""
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="Owner role required"),
                ),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/members",
                json={"user_id": "user-3", "role": "member"},
            )
            assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------


class TestOrgTeamFlows:
    """Team CRUD + members + permission grants."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_list_teams(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.team_service.list_teams",
                new=AsyncMock(return_value=[]),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/teams")
            assert resp.status_code == 200

    def test_create_team(self) -> None:
        team_resp = _make_team_response()
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.team_service.create_team",
                new=AsyncMock(return_value=team_resp),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/teams",
                json={"name": "Backend", "slug": "backend"},
            )
            assert resp.status_code == 201
            assert resp.json()["slug"] == "backend"

    def test_get_team(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        team_resp = _make_team_response()
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.team_service.get_team",
                new=AsyncMock(return_value=team_resp),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/teams/backend")
            assert resp.status_code == 200

    def test_delete_team(self) -> None:
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.team_service.delete_team",
                new=AsyncMock(return_value={"status": "deleted"}),
            ),
        ):
            resp = self.client.delete("/api/orgs/acme/teams/backend")
            assert resp.status_code == 200

    def test_list_team_members(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.team_service.list_team_members",
                new=AsyncMock(return_value=[]),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/teams/backend/members")
            assert resp.status_code == 200

    def test_add_team_member(self) -> None:
        now = datetime.now(UTC)
        team_member = SimpleNamespace(
            memberId="tm-1",
            teamId="team-1",
            userId="user-2",
            role="member",
            createdAt=now,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.team_service.add_team_member",
                new=AsyncMock(return_value=team_member),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/teams/backend/members",
                json={"user_id": "user-2", "role": "member"},
            )
            assert resp.status_code == 201

    def test_list_grants(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.team_service.list_permission_grants",
                new=AsyncMock(return_value=[]),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/teams/backend/grants")
            assert resp.status_code == 200

    def test_add_grant(self) -> None:
        now = datetime.now(UTC)
        grant_resp = SimpleNamespace(
            grantId="tg-1",
            teamId="team-1",
            orgId="org-1",
            resourceType="workspace",
            resourceId="ws-1",
            permissions=["workflows:read"],
            grantedBy="user-1",
            createdAt=now,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.team_service.add_permission_grant",
                new=AsyncMock(return_value=grant_resp),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/teams/backend/grants",
                json={
                    "resource_type": "workspace",
                    "resource_id": "ws-1",
                    "permissions": ["workflows:read"],
                },
            )
            assert resp.status_code == 201


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


class TestOrgInviteFlows:
    """Invite lifecycle: create, list, accept, cancel."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_create_invite(self) -> None:
        invite_resp = _make_invite_response()
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_invite_service.create_org_invite",
                new=AsyncMock(return_value=invite_resp),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/invites",
                json={"email": "new@example.com", "role": "member"},
            )
            assert resp.status_code == 201

    def test_list_invites(self) -> None:
        datetime.now(UTC)
        org_member = _make_member(role="owner")
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_invite_service.list_org_invites",
                new=AsyncMock(return_value=[]),
            ),
        ):
            resp = self.client.get("/api/orgs/acme/invites")
            assert resp.status_code == 200

    def test_accept_invite(self) -> None:
        now = datetime.now(UTC)
        consumed_invite = SimpleNamespace(
            inviteId="oi-1",
            orgId="org-1",
            email="new@example.com",
            token_hash="hash",
            role="member",
            invited_by="user-1",
            created_at=now,
            expires_at=now + timedelta(days=7),
            consumed=True,
            consumed_at=now,
        )
        with patch(
            "app.routes.orgs.org_invite_service.accept_org_invite",
            new=AsyncMock(return_value=consumed_invite),
        ):
            resp = self.client.post(
                "/api/orgs/acme/invites/accept",
                json={"token": "raw-token"},
            )
            assert resp.status_code == 200

    def test_cancel_invite(self) -> None:
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_invite_service.cancel_org_invite",
                new=AsyncMock(return_value={"status": "cancelled"}),
            ),
        ):
            resp = self.client.delete("/api/orgs/acme/invites/oi-1")
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Outside Collaborators (workspace-level)
# ---------------------------------------------------------------------------


class TestOutsideCollaboratorFlows:
    """Outside collaborator management on workspaces."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(workspaces_router)
        self.user = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.user
        self.client = TestClient(self.app)

    def test_list_collaborators(self) -> None:
        with patch(
            "app.routes.workspaces.workspace_service.list_outside_collaborators",
            new=AsyncMock(return_value=[]),
        ):
            resp = self.client.get("/api/workspaces/ws-1/collaborators")
            assert resp.status_code == 200
            assert resp.json()["total"] == 0

    def test_add_collaborator(self) -> None:
        now = datetime.now(UTC)
        collab = {
            "collaboratorId": "oc-1",
            "workspaceId": "ws-1",
            "userId": "user-2",
            "role": "read",
            "createdAt": now,
        }
        with patch(
            "app.routes.workspaces.workspace_service.add_outside_collaborator",
            new=AsyncMock(return_value={"collaborator": collab}),
        ):
            resp = self.client.post(
                "/api/workspaces/ws-1/collaborators",
                json={"userId": "user-2", "role": "read"},
            )
            assert resp.status_code == 201

    def test_remove_collaborator(self) -> None:
        with patch(
            "app.routes.workspaces.workspace_service.remove_outside_collaborator",
            new=AsyncMock(return_value=None),
        ):
            resp = self.client.delete("/api/workspaces/ws-1/collaborators/oc-1")
            assert resp.status_code == 204

    def test_list_collaborators_workspace_not_found(self) -> None:
        from app.services.exceptions import ResourceNotFoundError

        with patch(
            "app.routes.workspaces.workspace_service.list_outside_collaborators",
            new=AsyncMock(side_effect=ResourceNotFoundError("Workspace not found")),
        ):
            resp = self.client.get("/api/workspaces/ws-nope/collaborators")
            assert resp.status_code == 404

    def test_add_duplicate_collaborator_returns_409(self) -> None:
        from app.services.exceptions import ConflictError

        with patch(
            "app.routes.workspaces.workspace_service.add_outside_collaborator",
            new=AsyncMock(
                side_effect=ConflictError("User is already an outside collaborator"),
            ),
        ):
            resp = self.client.post(
                "/api/workspaces/ws-1/collaborators",
                json={"userId": "user-2", "role": "read"},
            )
            assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Negative authorization: non-owner cannot perform owner-only actions
# ---------------------------------------------------------------------------


class TestOrgNegativeAuthorization:
    """Non-owners get 403 on owner-only operations."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.member = _make_user(user_id="user-2", email="member@example.com")
        self.app.dependency_overrides[get_current_active_user] = lambda: self.member
        self.client = TestClient(self.app)

    def test_non_owner_cannot_delete_org(self) -> None:
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="Owner role required"),
                ),
            ),
        ):
            resp = self.client.delete("/api/orgs/acme")
            assert resp.status_code == 403

    def test_non_owner_cannot_add_member(self) -> None:
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="Owner role required"),
                ),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/members",
                json={"user_id": "user-3", "role": "member"},
            )
            assert resp.status_code == 403

    def test_non_owner_cannot_update_member_role(self) -> None:
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="Owner role required"),
                ),
            ),
        ):
            resp = self.client.patch(
                "/api/orgs/acme/members/user-1",
                json={"role": "member"},
            )
            assert resp.status_code == 403

    def test_non_owner_cannot_remove_member(self) -> None:
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=_make_org_response()),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(
                    side_effect=HTTPException(status_code=403, detail="Owner role required"),
                ),
            ),
        ):
            resp = self.client.delete("/api/orgs/acme/members/user-1")
            assert resp.status_code == 403
