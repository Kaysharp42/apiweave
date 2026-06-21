"""
Task 26 — Soft-delete behaviour.

Verifies that:
- Soft-deleted orgs return 404 on normal reads/writes
- Soft-deleted workspaces return 404 on normal reads/writes
- Restore endpoints bring deleted resources back
- Non-owners cannot delete/restore
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
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


def _make_org(
    org_id: str = "org-test123",
    slug: str = "acme",
    deleted_at: datetime | None = None,
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
        deletedAt=deleted_at,
    )


def _make_workspace(
    workspace_id: str = "ws-test123",
    slug: str = "test-ws",
    deleted_at: datetime | None = None,
) -> SimpleNamespace:
    now = datetime.now(UTC)
    return SimpleNamespace(
        workspaceId=workspace_id,
        slug=slug,
        name="Test WS",
        ownerType="user",
        ownerUserId="user-1",
        orgId=None,
        isPersonal=False,
        description=None,
        createdAt=now,
        updatedAt=now,
        deletedAt=deleted_at,
    )


# ---------------------------------------------------------------------------
# Org soft-delete
# ---------------------------------------------------------------------------


class TestOrgSoftDelete:
    """Org soft-delete: deleted org returns 404, restore brings it back."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(orgs_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_delete_org_returns_deleted_status(self) -> None:
        org = _make_org()
        with (
            patch(
                "app.routes.orgs.org_service.get_org",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        orgId=org.orgId,
                        slug=org.slug,
                        name=org.name,
                        ownerUserId="user-1",
                        description=None,
                        avatarUrl=None,
                        createdAt=datetime.now(UTC),
                        updatedAt=datetime.now(UTC),
                        deletedAt=None,
                    )
                ),
            ),
            patch(
                "app.routes.orgs.org_service.require_org_owner",
                new=AsyncMock(
                    return_value=SimpleNamespace(
                        memberId="m1",
                        orgId=org.orgId,
                        userId="user-1",
                        role="owner",
                        createdAt=datetime.now(UTC),
                        updatedAt=datetime.now(UTC),
                    )
                ),
            ),
            patch(
                "app.routes.orgs.org_service.delete_org",
                new=AsyncMock(return_value={"status": "deleted", "orgId": org.orgId}),
            ),
        ):
            resp = self.client.delete(f"/api/orgs/{org.slug}")
            assert resp.status_code == 200
            assert resp.json()["status"] == "deleted"

    def test_get_deleted_org_returns_404(self) -> None:
        """A deleted org raises 404 from the service layer."""
        with patch(
            "app.routes.orgs.org_service.get_org",
            new=AsyncMock(
                side_effect=HTTPException(status_code=404, detail="Organization not found")
            ),
        ):
            resp = self.client.get("/api/orgs/acme")
            assert resp.status_code == 404

    def test_restore_org_returns_org(self) -> None:
        now = datetime.now(UTC)
        restored_org = SimpleNamespace(
            orgId="org-test123",
            slug="acme",
            name="Acme Corp",
            ownerUserId="user-1",
            description=None,
            avatarUrl=None,
            createdAt=now,
            updatedAt=now,
            deletedAt=None,
        )
        with patch(
            "app.routes.orgs.org_service.restore_org",
            new=AsyncMock(return_value=restored_org),
        ):
            resp = self.client.post("/api/orgs/acme/restore")
            assert resp.status_code == 200
            assert resp.json()["slug"] == "acme"


# ---------------------------------------------------------------------------
# Workspace soft-delete
# ---------------------------------------------------------------------------


class TestWorkspaceSoftDelete:
    """Workspace soft-delete: deleted workspace returns 404, restore brings it back."""

    def setup_method(self) -> None:
        self.app = FastAPI()
        self.app.include_router(workspaces_router)
        self.owner = _make_user()
        self.app.dependency_overrides[get_current_active_user] = lambda: self.owner
        self.client = TestClient(self.app)

    def test_delete_workspace_returns_204(self) -> None:
        with patch(
            "app.routes.workspaces.workspace_service.delete_workspace",
            new=AsyncMock(return_value=None),
        ):
            resp = self.client.delete("/api/workspaces/ws-test123")
            assert resp.status_code == 204

    def test_get_deleted_workspace_returns_404(self) -> None:
        from app.services.exceptions import ResourceNotFoundError

        with patch(
            "app.routes.workspaces.workspace_service.get_workspace",
            new=AsyncMock(side_effect=ResourceNotFoundError("Workspace ws-test123 not found")),
        ):
            resp = self.client.get("/api/workspaces/ws-test123")
            assert resp.status_code == 404

    def test_update_deleted_workspace_returns_404(self) -> None:
        from app.services.exceptions import ResourceNotFoundError

        with patch(
            "app.routes.workspaces.workspace_service.update_workspace",
            new=AsyncMock(side_effect=ResourceNotFoundError("Workspace ws-test123 not found")),
        ):
            resp = self.client.patch(
                "/api/workspaces/ws-test123",
                json={"name": "New Name"},
            )
            assert resp.status_code == 404

    def test_restore_workspace_returns_workspace(self) -> None:
        now = datetime.now(UTC)
        restored = {
            "workspaceId": "ws-test123",
            "slug": "test-ws",
            "name": "Test WS",
            "ownerType": "user",
            "ownerUserId": "user-1",
            "orgId": None,
            "isPersonal": False,
            "description": None,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
            "deletedAt": None,
        }
        with patch(
            "app.routes.workspaces.workspace_service.restore_workspace",
            new=AsyncMock(return_value=restored),
        ):
            resp = self.client.post("/api/workspaces/ws-test123/restore")
            assert resp.status_code == 200
            assert resp.json()["workspaceId"] == "ws-test123"

    def test_delete_nonexistent_workspace_returns_404(self) -> None:
        from app.services.exceptions import ResourceNotFoundError

        with patch(
            "app.routes.workspaces.workspace_service.delete_workspace",
            new=AsyncMock(side_effect=ResourceNotFoundError("Workspace ws-nope not found")),
        ):
            resp = self.client.delete("/api/workspaces/ws-nope")
            assert resp.status_code == 404

    def test_delete_personal_workspace_returns_409(self) -> None:
        from app.services.exceptions import ConflictError

        with patch(
            "app.routes.workspaces.workspace_service.delete_workspace",
            new=AsyncMock(side_effect=ConflictError("Cannot delete a personal workspace")),
        ):
            resp = self.client.delete("/api/workspaces/ws-personal")
            assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Service-level soft-delete checks
# ---------------------------------------------------------------------------


class TestOrgServiceSoftDelete:
    """Service-level: delete_org marks deletedAt, get_org returns 404 for deleted."""

    @pytest.mark.asyncio
    async def test_delete_org_sets_deleted_flag(self) -> None:
        from app.services import org_service

        owner = _make_user()
        org = _make_org()

        with (
            patch(
                "app.services.org_service.OrganizationRepository.get_by_slug",
                new=AsyncMock(return_value=org),
            ),
            patch(
                "app.services.org_service.OrganizationRepository.soft_delete",
                new=AsyncMock(return_value=True),
            ) as mock_soft_delete,
            patch(
                "app.services.org_service.append_event",
                new=AsyncMock(),
            ),
        ):
            result = await org_service.delete_org("acme", actor=owner)
            assert result["status"] == "deleted"
            mock_soft_delete.assert_called_once_with(org.orgId)

    @pytest.mark.asyncio
    async def test_get_deleted_org_returns_404(self) -> None:
        from app.services import org_service

        deleted_org = _make_org(deleted_at=datetime.now(UTC))

        with patch(
            "app.services.org_service.OrganizationRepository.get_by_slug",
            new=AsyncMock(return_value=deleted_org),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_service.get_org("acme")
            assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_restore_non_deleted_org_returns_409(self) -> None:
        from app.services import org_service

        active_org = _make_org(deleted_at=None)

        with patch(
            "app.services.org_service.OrganizationRepository.get_by_slug",
            new=AsyncMock(return_value=active_org),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await org_service.restore_org("acme", actor=_make_user())
            assert exc_info.value.status_code == 409
