"""
Task 26 — Slug conflict behaviour.

Verifies that:
- Creating an org with a duplicate slug returns 409
- Creating a workspace with a duplicate slug returns 409
- Creating a team with a duplicate slug returns 409
- Updating to an existing slug returns 409
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth.dependencies import get_current_active_user
from app.routes.orgs import router as orgs_router
from app.routes.workspaces import router as workspaces_router

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(user_id: str = "user-1") -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        userId=user_id,
        verified_email=f"{user_id}@example.com",
        display_name="Test User",
        roles=[],
        permissions=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


# ---------------------------------------------------------------------------
# Org slug conflicts
# ---------------------------------------------------------------------------


class TestOrgSlugConflicts:
    """Org slug must be unique — duplicate returns 409."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.user = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.user
        self.client = TestClient(self.app)

    def test_create_org_duplicate_slug_returns_409(self) -> None:
        with patch(
            "app.routes.orgs.org_service.create_org",
            new=AsyncMock(
                side_effect=HTTPException(
                    status_code=409,
                    detail={"error": "slug_conflict", "slug": "acme"},
                ),
            ),
        ):
            resp = self.client.post("/api/orgs", json={"name": "Acme", "slug": "acme"})
            assert resp.status_code == 409

    def test_update_org_to_existing_slug_returns_409(self) -> None:
        now = datetime.now(UTC)
        org_member = SimpleNamespace(
            memberId="m1",
            orgId="org-1",
            userId="user-1",
            role="owner",
            createdAt=now,
            updatedAt=now,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        orgId="org-1",
                        slug="acme",
                        name="Acme",
                        ownerUserId="user-1",
                        description=None,
                        avatarUrl=None,
                        createdAt=now,
                        updatedAt=now,
                        deletedAt=None,
                    )
                ),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_member",
                new=AsyncMock(return_value=org_member),
            ),
            patch(
                "app.routes.orgs.org_service.update_org",
                new=AsyncMock(
                    side_effect=HTTPException(
                        status_code=409,
                        detail={"error": "slug_conflict", "slug": "taken"},
                    ),
                ),
            ),
        ):
            resp = self.client.patch(
                "/api/orgs/acme",
                json={"slug": "taken"},
            )
            assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_service_create_org_slug_conflict(self) -> None:
        from app.services import org_service

        existing = SimpleNamespace(
            orgId="org-existing",
            slug="acme",
            name="Acme",
            ownerUserId="other-user",
            deletedAt=None,
        )
        with patch(
            "app.services.org_service.OrganizationRepository.get_by_slug",
            new=AsyncMock(return_value=existing),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_service.create_org(
                    name="Acme 2",
                    slug="acme",
                    owner_user=_make_user(),
                )
            assert exc_info.value.status_code == 409


# ---------------------------------------------------------------------------
# Workspace slug conflicts
# ---------------------------------------------------------------------------


class TestWorkspaceSlugConflicts:
    """Workspace slug must be unique within scope — duplicate returns 409."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(workspaces_router)
        self.user = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.user
        self.client = TestClient(self.app)

    def test_create_workspace_duplicate_slug_returns_409(self) -> None:
        with patch(
            "app.routes.workspaces.workspace_service.create_workspace",
            new=AsyncMock(
                side_effect=__import__(
                    "app.services.exceptions", fromlist=["ConflictError"]
                ).ConflictError("Workspace slug 'test' is already taken in this scope"),
            ),
        ):
            resp = self.client.post(
                "/api/workspaces",
                json={
                    "name": "Test",
                    "slug": "test",
                    "ownerType": "user",
                },
            )
            assert resp.status_code == 409

    def test_update_workspace_to_existing_slug_returns_409(self) -> None:
        from app.services.exceptions import ConflictError

        with patch(
            "app.routes.workspaces.workspace_service.update_workspace",
            new=AsyncMock(
                side_effect=ConflictError("Workspace slug 'taken' is already taken"),
            ),
        ):
            resp = self.client.patch(
                "/api/workspaces/ws-123",
                json={"slug": "taken"},
            )
            assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Team slug conflicts
# ---------------------------------------------------------------------------


class TestTeamSlugConflicts:
    """Team slug must be unique within org — duplicate returns 409."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.user = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.user
        self.client = TestClient(self.app)

    def test_create_team_duplicate_slug_returns_409(self) -> None:
        now = datetime.now(UTC)
        org = SimpleNamespace(
            orgId="org-1",
            slug="acme",
            name="Acme",
            ownerUserId="user-1",
            description=None,
            avatarUrl=None,
            createdAt=now,
            updatedAt=now,
            deletedAt=None,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=org),
            ),
            patch(
                "app.routes.orgs.team_service.create_team",
                new=AsyncMock(
                    side_effect=HTTPException(
                        status_code=409,
                        detail={"error": "slug_conflict", "slug": "backend"},
                    ),
                ),
            ),
        ):
            resp = self.client.post(
                "/api/orgs/acme/teams",
                json={"name": "Backend", "slug": "backend"},
            )
            assert resp.status_code == 409

    def test_update_team_to_existing_slug_returns_409(self) -> None:
        now = datetime.now(UTC)
        org = SimpleNamespace(
            orgId="org-1",
            slug="acme",
            name="Acme",
            ownerUserId="user-1",
            description=None,
            avatarUrl=None,
            createdAt=now,
            updatedAt=now,
            deletedAt=None,
        )
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(return_value=org),
            ),
            patch(
                "app.routes.orgs.team_service.update_team",
                new=AsyncMock(
                    side_effect=HTTPException(
                        status_code=409,
                        detail={"error": "slug_conflict", "slug": "taken"},
                    ),
                ),
            ),
        ):
            resp = self.client.patch(
                "/api/orgs/acme/teams/backend",
                json={"slug": "taken"},
            )
            assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_service_create_team_slug_conflict(self) -> None:
        from app.services import team_service

        existing_team = SimpleNamespace(
            teamId="team-existing",
            orgId="org-1",
            slug="backend",
            name="Backend",
            description=None,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        with (
            patch(
                "app.services.team_service.TeamRepository.get_by_slug",
                new=AsyncMock(return_value=existing_team),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await team_service.create_team(
                    "org-1",
                    name="Backend 2",
                    slug="backend",
                    actor=_make_user(),
                )
            assert exc_info.value.status_code == 409
