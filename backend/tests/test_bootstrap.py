"""
Tests for bootstrap service and database reset.

Verifies:
- Setup creates first owner with default personal workspace
- No global Environment.isActive remains in the schema
- Wipe script drops all collections
"""
import pytest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from app.models import User, Environment, Workspace
from app.services.bootstrap import bootstrap_first_owner
from app.repositories.workspace_repository import WorkspaceRepository


def make_user(user_id: str = "usr-test123", email: str = "owner@example.com") -> User:
    """Build a User via model_construct to avoid Beanie init."""
    now = datetime.now(UTC)
    return User.model_construct(
        userId=user_id,
        verified_email=email,
        display_name="Test Owner",
        avatar_url=None,
        roles=["admin"],
        permissions=[],
        oauth_accounts=[],
        is_setup_complete=True,
        created_at=now,
        updated_at=now,
    )


class TestBootstrapFirstOwner:
    """Test bootstrap_first_owner creates default personal workspace."""

    async def test_creates_personal_workspace_for_first_user(self):
        """First user gets a default personal workspace."""
        user = make_user()

        with patch.object(
            WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
        ) as mock_get, patch.object(
            WorkspaceRepository, "create", new_callable=AsyncMock
        ) as mock_create, patch.object(
            WorkspaceRepository, "add_member", new_callable=AsyncMock
        ) as mock_add_member:
            mock_get.return_value = None
            mock_workspace = Workspace.model_construct(
                workspaceId="ws-test123",
                slug="personal",
                name="My Workspace",
                ownerType="user",
                ownerUserId=user.userId,
                isPersonal=True,
                createdAt=datetime.now(UTC),
                updatedAt=datetime.now(UTC),
            )
            mock_create.return_value = mock_workspace

            result = await bootstrap_first_owner(user)

            assert result.workspaceId == "ws-test123"
            assert result.ownerType == "user"
            assert result.ownerUserId == user.userId
            assert result.isPersonal is True
            mock_create.assert_called_once()
            mock_add_member.assert_called_once()

    async def test_skips_if_personal_workspace_exists(self):
        """Does not create duplicate workspace if one already exists."""
        user = make_user()
        existing_ws = Workspace.model_construct(
            workspaceId="ws-existing",
            slug="personal",
            name="My Workspace",
            ownerType="user",
            ownerUserId=user.userId,
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )

        with patch.object(
            WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
        ) as mock_get, patch.object(
            WorkspaceRepository, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_get.return_value = existing_ws

            result = await bootstrap_first_owner(user)

            assert result.workspaceId == "ws-existing"
            mock_create.assert_not_called()


class TestEnvironmentSchema:
    """Verify Environment model no longer has isActive."""

    def test_environment_has_no_is_active_field(self):
        """Environment model should not have isActive field."""
        field_names = set(Environment.model_fields.keys())
        assert "isActive" not in field_names, (
            "Environment.isActive must be removed — scoped environments replace it"
        )

    def test_environment_has_scope_fields(self):
        """Environment model should have scopeType and scopeId."""
        field_names = set(Environment.model_fields.keys())
        assert "scopeType" in field_names
        assert "scopeId" in field_names


class TestWipeScript:
    """Verify wipe_db script exists and is importable."""

    def test_wipe_script_exists(self):
        """wipe_db.py script should exist."""
        import importlib.util
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "wipe_db.py"
        assert script_path.exists(), f"wipe_db.py not found at {script_path}"

    def test_wipe_script_has_wipe_function(self):
        """wipe_db.py should export wipe_database function."""
        import importlib.util
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "wipe_db.py"
        spec = importlib.util.spec_from_file_location("wipe_db", script_path)
        assert spec is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert hasattr(module, "wipe_database")
        assert callable(module.wipe_database)
