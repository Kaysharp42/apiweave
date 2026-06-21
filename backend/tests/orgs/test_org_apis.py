"""
Tests for Wave 2 Task 7: Organization, member, team, and invite APIs.

Covers the three mandatory QA scenarios:
  1. Org invite accepts into member role (with audit)
  2. Team grants workspace permission
  3. Last-owner protection blocks unsafe removal/demotion
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from app.auth.dependencies import get_current_active_user
from app.auth.permissions import (
    WORKFLOWS_CREATE,
    WORKFLOWS_READ,
    WORKFLOWS_UPDATE,
    LastOwnerError,
    ScopedPermissionEvaluator,
    WorkspaceRole,
    check_last_owner,
)
from fastapi import FastAPI, HTTPException

# ---------------------------------------------------------------------------
# Helpers — use SimpleNamespace to avoid Beanie init requirement
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


def _make_org(
    org_id: str = "org-test123",
    slug: str = "acme",
    owner_user_id: str = "user-1",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        orgId=org_id,
        slug=slug,
        name="Acme Corp",
        ownerUserId=owner_user_id,
        description=None,
        avatarUrl=None,
        createdAt=now,
        updatedAt=now,
        deletedAt=None,
    )


def _make_member(
    member_id: str = "om-test",
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


def _make_team(
    team_id: str = "team-test",
    org_id: str = "org-test123",
    slug: str = "backend",
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        teamId=team_id,
        orgId=org_id,
        slug=slug,
        name="Backend Team",
        description=None,
        createdAt=now,
        updatedAt=now,
    )


def _make_grant(
    grant_id: str = "tg-test",
    team_id: str = "team-test",
    org_id: str = "org-test123",
    resource_type: str = "workspace",
    resource_id: str = "ws-123",
    permissions: list[str] | None = None,
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        grantId=grant_id,
        teamId=team_id,
        orgId=org_id,
        resourceType=resource_type,
        resourceId=resource_id,
        permissions=permissions or [WORKFLOWS_READ, WORKFLOWS_CREATE, WORKFLOWS_UPDATE],
        grantedBy="user-1",
        createdAt=now,
    )


def _make_invite(
    invite_id: str = "oi-test",
    org_id: str = "org-test123",
    email: str = "new@example.com",
    role: str = "member",
    consumed: bool = False,
    expired: bool = False,
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        inviteId=invite_id,
        orgId=org_id,
        email=email,
        token_hash="fake-hash",
        role=role,
        invited_by="user-1",
        created_at=now - timedelta(hours=1),
        expires_at=now + timedelta(days=6) if not expired else now - timedelta(days=3),
        consumed=consumed,
        consumed_at=now if consumed else None,
    )


# ---------------------------------------------------------------------------
# Scenario 1: Org invite accepts into member role
# ---------------------------------------------------------------------------


class TestOrgInviteAcceptsIntoMemberRole:
    """
    Scenario: Org invite accepts into member role
    Steps:
      1. Invite new@example.com as member.
      2. Accept invite through test fixture.
    Expected: User joins org as member and audit logs invite/accept.
    """

    @pytest.mark.asyncio
    async def test_invite_create_returns_token(self) -> None:
        from app.services import org_invite_service

        owner = _make_user()
        owner_member = _make_member(role="owner")
        invite = _make_invite()

        with (
            patch.object(
                org_invite_service, "require_org_member", new=AsyncMock(return_value=owner_member)
            ),
            patch.object(
                org_invite_service.OrganizationRepository,
                "get_member",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                org_invite_service.OrgInviteRepository,
                "find_active_by_org_and_email",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                org_invite_service.OrgInviteRepository,
                "count_recent_by_org",
                new=AsyncMock(return_value=0),
            ),
            patch.object(
                org_invite_service.OrgInviteRepository, "create", new=AsyncMock(return_value=invite)
            ),
            patch.object(org_invite_service, "append_event", new=AsyncMock()) as mock_audit,
        ):
            result = await org_invite_service.create_org_invite(
                "org-test123",
                email="new@example.com",
                role="member",
                actor=owner,
            )

            assert result.email == "new@example.com"
            assert result.role == "member"
            assert len(result.token) > 20
            mock_audit.assert_called_once()
            assert mock_audit.call_args.kwargs["action"] == "org.invite.created"

    @pytest.mark.asyncio
    async def test_accept_invite_adds_member_and_audits(self) -> None:
        from app.services import org_invite_service

        accepting_user = _make_user("user-2", "new@example.com")
        invite = _make_invite(email="new@example.com")
        consumed_invite = _make_invite(email="new@example.com", consumed=True)

        with (
            patch.object(
                org_invite_service.OrgInviteRepository,
                "get_by_token_hash",
                new=AsyncMock(return_value=invite),
            ),
            patch.object(
                org_invite_service.OrganizationRepository,
                "get_member",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                org_invite_service.OrganizationRepository, "add_member", new=AsyncMock()
            ) as mock_add,
            patch.object(
                org_invite_service.OrgInviteRepository, "consume", new=AsyncMock(return_value=True)
            ),
            patch.object(
                org_invite_service.OrgInviteRepository,
                "get_by_id",
                new=AsyncMock(return_value=consumed_invite),
            ),
            patch.object(org_invite_service, "append_event", new=AsyncMock()) as mock_audit,
        ):
            result = await org_invite_service.accept_org_invite("raw-token", accepting_user)

            assert result.consumed is True
            mock_add.assert_called_once()
            assert mock_add.call_args.kwargs["role"] == "member"
            assert mock_add.call_args.kwargs["user_id"] == "user-2"

            assert mock_audit.call_count == 1
            assert mock_audit.call_args.kwargs["action"] == "org.invite.accepted"
            assert mock_audit.call_args.kwargs["context"]["role"] == "member"

    @pytest.mark.asyncio
    async def test_accept_expired_invite_fails(self) -> None:
        from app.services import org_invite_service

        accepting_user = _make_user("user-2", "new@example.com")
        invite = _make_invite(expired=True)

        with (
            patch.object(
                org_invite_service.OrgInviteRepository,
                "get_by_token_hash",
                new=AsyncMock(return_value=invite),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_invite_service.accept_org_invite("raw-token", accepting_user)
            assert exc_info.value.status_code == 410

    @pytest.mark.asyncio
    async def test_accept_wrong_email_fails(self) -> None:
        from app.services import org_invite_service

        wrong_user = _make_user("user-3", "wrong@example.com")
        invite = _make_invite(email="new@example.com")

        with (
            patch.object(
                org_invite_service.OrgInviteRepository,
                "get_by_token_hash",
                new=AsyncMock(return_value=invite),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_invite_service.accept_org_invite("raw-token", wrong_user)
            assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# Scenario 2: Team grants workspace permission
# ---------------------------------------------------------------------------


class TestTeamGrantsWorkspacePermission:
    """
    Scenario: Team grants workspace permission
    Steps:
      1. Create team with workspace write grant.
      2. Add user to team.
      3. Evaluate permissions — user should have write through team.
    Expected: Edit succeeds through team grant.
    """

    def test_team_grant_provides_workspace_write(self) -> None:
        grant = _make_grant(permissions=[WORKFLOWS_READ, WORKFLOWS_CREATE, WORKFLOWS_UPDATE])

        effective = ScopedPermissionEvaluator.evaluate(
            team_grants=[set(grant.permissions)],
        )

        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_CREATE)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_UPDATE)

    def test_team_grant_combined_with_workspace_role(self) -> None:
        team_perms = {WORKFLOWS_READ, WORKFLOWS_CREATE, WORKFLOWS_UPDATE}
        effective = ScopedPermissionEvaluator.evaluate(
            workspace_role=WorkspaceRole.READ,
            team_grants=[team_perms],
        )

        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_UPDATE)
        assert ScopedPermissionEvaluator.has_permission(effective, WORKFLOWS_READ)

    @pytest.mark.asyncio
    async def test_add_permission_grant_service(self) -> None:
        from app.services import team_service

        owner = _make_user()
        owner_member = _make_member(role="owner")
        team = _make_team()
        expected_grant = _make_grant()

        with (
            patch.object(
                team_service, "require_org_owner", new=AsyncMock(return_value=owner_member)
            ),
            patch.object(
                team_service.TeamRepository, "get_by_slug", new=AsyncMock(return_value=team)
            ),
            patch.object(
                team_service.TeamPermissionGrantRepository,
                "get_by_team_and_resource",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                team_service.TeamPermissionGrantRepository,
                "create",
                new=AsyncMock(return_value=expected_grant),
            ),
            patch.object(team_service, "append_event", new=AsyncMock()) as mock_audit,
        ):
            result = await team_service.add_permission_grant(
                "org-test123",
                "backend",
                resource_type="workspace",
                resource_id="ws-123",
                permissions=[WORKFLOWS_READ, WORKFLOWS_CREATE, WORKFLOWS_UPDATE],
                actor=owner,
            )

            assert result.resourceType == "workspace"
            assert result.resourceId == "ws-123"
            assert WORKFLOWS_UPDATE in result.permissions
            mock_audit.assert_called_once()
            assert mock_audit.call_args.kwargs["action"] == "team.grant.added"

    @pytest.mark.asyncio
    async def test_duplicate_grant_rejected(self) -> None:
        from app.services import team_service

        owner = _make_user()
        owner_member = _make_member(role="owner")
        team = _make_team()
        existing_grant = _make_grant()

        with (
            patch.object(
                team_service, "require_org_owner", new=AsyncMock(return_value=owner_member)
            ),
            patch.object(
                team_service.TeamRepository, "get_by_slug", new=AsyncMock(return_value=team)
            ),
            patch.object(
                team_service.TeamPermissionGrantRepository,
                "get_by_team_and_resource",
                new=AsyncMock(return_value=existing_grant),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await team_service.add_permission_grant(
                    "org-test123",
                    "backend",
                    resource_type="workspace",
                    resource_id="ws-123",
                    permissions=[WORKFLOWS_READ],
                    actor=owner,
                )
            assert exc_info.value.status_code == 409


# ---------------------------------------------------------------------------
# Scenario 3: Last-owner protection
# ---------------------------------------------------------------------------


class TestLastOwnerProtection:
    """
    Scenario: Last owner protection blocks unsafe removal/demotion
    Steps:
      1. Org has exactly one owner.
      2. Attempt owner demotion -> 409.
      3. Attempt owner removal -> 409.
    Expected: Both operations return 409 with last-owner error.
    """

    def test_sole_owner_cannot_be_demoted(self) -> None:
        with pytest.raises(LastOwnerError) as exc_info:
            check_last_owner(owner_count=1)
        assert exc_info.value.status_code == 409

    def test_sole_owner_cannot_be_removed(self) -> None:
        with pytest.raises(LastOwnerError):
            check_last_owner(owner_count=1)

    def test_multiple_owners_allows_removal(self) -> None:
        check_last_owner(owner_count=2)

    def test_zero_owners_raises(self) -> None:
        with pytest.raises(LastOwnerError):
            check_last_owner(owner_count=0)

    @pytest.mark.asyncio
    async def test_demote_last_owner_via_service(self) -> None:
        from app.services import org_service

        owner = _make_user()
        target_member = _make_member(user_id="user-1", role="owner")

        with (
            patch.object(
                org_service.OrganizationRepository,
                "get_member",
                new=AsyncMock(return_value=target_member),
            ),
            patch.object(
                org_service.OrganizationRepository, "count_owners", new=AsyncMock(return_value=1)
            ),
        ):
            with pytest.raises(LastOwnerError):
                await org_service.update_member_role(
                    "org-test123",
                    "user-1",
                    new_role="member",
                    actor=owner,
                )

    @pytest.mark.asyncio
    async def test_remove_last_owner_via_service(self) -> None:
        from app.services import org_service

        owner = _make_user()
        target_member = _make_member(user_id="user-1", role="owner")

        with (
            patch.object(
                org_service.OrganizationRepository,
                "get_member",
                new=AsyncMock(return_value=target_member),
            ),
            patch.object(
                org_service.OrganizationRepository, "count_owners", new=AsyncMock(return_value=1)
            ),
        ):
            with pytest.raises(LastOwnerError):
                await org_service.remove_member(
                    "org-test123",
                    "user-1",
                    actor=owner,
                )

    @pytest.mark.asyncio
    async def test_demote_owner_when_multiple_owners_succeeds(self) -> None:
        from app.services import org_service

        owner = _make_user()
        target_member = _make_member(user_id="user-2", role="owner")
        updated_member = _make_member(user_id="user-2", role="member")

        with (
            patch.object(
                org_service.OrganizationRepository,
                "get_member",
                new=AsyncMock(return_value=target_member),
            ),
            patch.object(
                org_service.OrganizationRepository, "count_owners", new=AsyncMock(return_value=2)
            ),
            patch.object(
                org_service.OrganizationRepository,
                "update_member_role",
                new=AsyncMock(return_value=updated_member),
            ),
            patch.object(org_service, "append_event", new=AsyncMock()),
        ):
            result = await org_service.update_member_role(
                "org-test123",
                "user-2",
                new_role="member",
                actor=owner,
            )
            assert result.role == "member"


# ---------------------------------------------------------------------------
# Rate limiting for invites
# ---------------------------------------------------------------------------


class TestInviteRateLimiting:
    @pytest.mark.asyncio
    async def test_rate_limit_blocks_excess_invites(self) -> None:
        from app.services import org_invite_service

        owner = _make_user()
        owner_member = _make_member(role="owner")

        with (
            patch.object(
                org_invite_service, "require_org_member", new=AsyncMock(return_value=owner_member)
            ),
            patch.object(
                org_invite_service.OrganizationRepository,
                "get_member",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                org_invite_service.OrgInviteRepository,
                "find_active_by_org_and_email",
                new=AsyncMock(return_value=None),
            ),
            patch.object(
                org_invite_service.OrgInviteRepository,
                "count_recent_by_org",
                new=AsyncMock(return_value=10),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_invite_service.create_org_invite(
                    "org-test123",
                    email="new@example.com",
                    role="member",
                    actor=owner,
                )
            assert exc_info.value.status_code == 429


# ---------------------------------------------------------------------------
# Org CRUD via service
# ---------------------------------------------------------------------------


class TestOrgCRUD:
    @pytest.mark.asyncio
    async def test_create_org_adds_owner_and_audits(self) -> None:
        from app.services import org_service

        owner = _make_user()
        org = _make_org()

        with (
            patch.object(
                org_service.OrganizationRepository, "get_by_slug", new=AsyncMock(return_value=None)
            ),
            patch.object(
                org_service.OrganizationRepository, "create", new=AsyncMock(return_value=org)
            ),
            patch.object(
                org_service.OrganizationRepository, "add_member", new=AsyncMock()
            ) as mock_add,
            patch.object(org_service, "append_event", new=AsyncMock()) as mock_audit,
        ):
            result = await org_service.create_org(
                name="Acme Corp",
                slug="acme",
                owner_user=owner,
            )

            assert result.slug == "acme"
            mock_add.assert_called_once()
            assert mock_add.call_args.kwargs["role"] == "owner"
            mock_audit.assert_called_once()
            assert mock_audit.call_args.kwargs["action"] == "org.created"

    @pytest.mark.asyncio
    async def test_slug_conflict_returns_409(self) -> None:
        from app.services import org_service

        owner = _make_user()
        existing_org = _make_org()

        with (
            patch.object(
                org_service.OrganizationRepository,
                "get_by_slug",
                new=AsyncMock(return_value=existing_org),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_service.create_org(
                    name="Acme Corp",
                    slug="acme",
                    owner_user=owner,
                )
            assert exc_info.value.status_code == 409


# ---------------------------------------------------------------------------
# Route-level smoke tests
# ---------------------------------------------------------------------------

from fastapi.testclient import TestClient


class TestOrgRoutesSmoke:
    def setup_method(self) -> None:
        from app.routes.orgs import router as orgs_router

        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_healthz(self) -> None:
        response = self.client.get("/api/orgs/healthz")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_list_orgs(self) -> None:
        with patch(
            "app.routes.orgs.org_service.list_orgs_for_user",
            new=AsyncMock(return_value=[]),
        ):
            response = self.client.get("/api/orgs")
            assert response.status_code == 200

    def test_create_org_route(self) -> None:
        org_resp = SimpleNamespace(
            orgId="org-test",
            slug="acme",
            name="Acme",
            description=None,
            avatarUrl=None,
            ownerUserId="user-1",
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        with patch(
            "app.routes.orgs.org_service.create_org",
            new=AsyncMock(return_value=org_resp),
        ):
            response = self.client.post(
                "/api/orgs",
                json={"name": "Acme", "slug": "acme"},
            )
            assert response.status_code == 201
            assert response.json()["slug"] == "acme"
