"""
Tests for bootstrap service and database reset.

Verifies:
- Setup creates first owner with default personal workspace
- No global Environment.isActive remains in the schema
- Wipe script drops all collections
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from app.models import Environment, User, Workspace
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.bootstrap import bootstrap_first_owner


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

        with (
            patch.object(
                WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
            ) as mock_get,
            patch.object(
                WorkspaceRepository, "get_orphan_personal", new_callable=AsyncMock
            ) as mock_orphan,
            patch.object(WorkspaceRepository, "create", new_callable=AsyncMock) as mock_create,
            patch.object(
                WorkspaceRepository, "add_member", new_callable=AsyncMock
            ) as mock_add_member,
            patch(
                "app.services.bootstrap.create_default_workspace_environment",
                new_callable=AsyncMock,
            ) as mock_create_env,
        ):
            mock_get.return_value = None
            mock_orphan.return_value = None
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
            mock_create_env.assert_called_once()

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

        with (
            patch.object(
                WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
            ) as mock_get,
            patch.object(WorkspaceRepository, "create", new_callable=AsyncMock) as mock_create,
        ):
            mock_get.return_value = existing_ws

            result = await bootstrap_first_owner(user)

            assert result.workspaceId == "ws-existing"
            mock_create.assert_not_called()

    async def test_adopts_orphan_personal_workspace(self):
        """Adopts an unowned (orgId=null, slug="personal") workspace from a
        prior run instead of failing on the unique (orgId, slug) index.

        Regression: in single_user mode, the bootstrap was crashing with a
        500 ``DuplicateKeyError`` on existing databases that had a
        ``(None, "personal")`` workspace from a 1.0 install or a previous
        multi_tenant run. The fix is to claim the orphan by setting
        ``ownerUserId`` to the new user, then re-fetching.
        """
        from app.services.bootstrap import ensure_personal_workspace

        user = make_user()
        orphan = Workspace.model_construct(
            workspaceId="ws-orphan",
            slug="personal",
            name="Stale Workspace",
            ownerType=None,
            ownerUserId=None,
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        claimed = Workspace.model_construct(
            workspaceId="ws-orphan",
            slug="personal",
            name="My Workspace",
            ownerType="user",
            ownerUserId=user.userId,
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )

        with (
            patch.object(
                WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
            ) as mock_get,
            patch.object(
                WorkspaceRepository, "get_orphan_personal", new_callable=AsyncMock
            ) as mock_orphan,
            patch.object(
                WorkspaceRepository, "claim_orphan_personal", new_callable=AsyncMock
            ) as mock_claim,
            patch.object(WorkspaceRepository, "create", new_callable=AsyncMock) as mock_create,
            patch.object(WorkspaceRepository, "get_member", new_callable=AsyncMock) as mock_member,
            patch.object(WorkspaceRepository, "add_member", new_callable=AsyncMock) as mock_add,
            patch(
                "app.services.bootstrap.create_default_workspace_environment",
                new_callable=AsyncMock,
            ) as mock_env,
        ):
            mock_get.side_effect = [None, claimed]
            mock_orphan.return_value = orphan
            mock_claim.return_value = claimed
            mock_member.return_value = None

            result = await ensure_personal_workspace(user)

            assert result.workspaceId == "ws-orphan"
            assert result.ownerUserId == user.userId
            mock_claim.assert_awaited_once_with("ws-orphan", user.userId)
            mock_create.assert_not_called()
            mock_add.assert_awaited_once()
            mock_env.assert_awaited_once()

    async def test_handles_duplicate_key_race(self):
        """Re-fetches and returns the winner when the create loses a race."""
        from app.services.bootstrap import ensure_personal_workspace
        from pymongo.errors import DuplicateKeyError

        user = make_user()
        winner = Workspace.model_construct(
            workspaceId="ws-race-winner",
            slug="personal",
            name="My Workspace",
            ownerType="user",
            ownerUserId=user.userId,
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )

        with (
            patch.object(
                WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
            ) as mock_get,
            patch.object(
                WorkspaceRepository, "get_orphan_personal", new_callable=AsyncMock
            ) as mock_orphan,
            patch.object(WorkspaceRepository, "create", new_callable=AsyncMock) as mock_create,
            patch.object(WorkspaceRepository, "add_member", new_callable=AsyncMock),
            patch(
                "app.services.bootstrap.create_default_workspace_environment",
                new_callable=AsyncMock,
            ),
        ):
            mock_orphan.return_value = None
            # First call: nothing for this user. Second call (after the
            # DuplicateKeyError): a different worker created it.
            mock_get.side_effect = [None, winner]
            mock_create.side_effect = DuplicateKeyError("dup", 11000, {"index": 0})

            result = await ensure_personal_workspace(user)

            assert result.workspaceId == "ws-race-winner"
            assert result.ownerUserId == user.userId


class TestEnvironmentSchema:
    """Verify Environment model no longer has isActive."""

    def test_environment_has_no_is_active_field(self):
        """Environment model should not have isActive field."""
        field_names = set(Environment.model_fields.keys())
        assert (
            "isActive" not in field_names
        ), "Environment.isActive must be removed — scoped environments replace it"

    def test_environment_has_scope_fields(self):
        """Environment model should have scopeType and scopeId."""
        field_names = set(Environment.model_fields.keys())
        assert "scopeType" in field_names
        assert "scopeId" in field_names


class TestWorkspaceIndexes:
    """Workspace (orgId, slug) must be a partial unique index.

    Regression: a plain unique on (orgId, slug) meant every personal workspace
    (orgId=null) shared one global namespace, so only one personal workspace
    could exist in the entire DB. Switching DEPLOYMENT_MODE or having two
    multi_tenant users would both crash with DuplicateKeyError.
    """

    def test_orgid_slug_index_is_partial_on_string_orgid(self):
        from pymongo import ASCENDING

        indexes = Workspace.Settings.indexes
        target = next(
            (
                idx
                for idx in indexes
                if idx.document.get("key") == {"orgId": ASCENDING, "slug": ASCENDING}
            ),
            None,
        )
        assert target is not None, "Expected an (orgId, slug) IndexModel on Workspace"
        assert target.document.get("unique") is True
        assert target.document.get("partialFilterExpression") == {"orgId": {"$type": "string"}}, (
            "The (orgId, slug) unique index MUST be partial on orgId being a "
            "string; otherwise personal workspaces collide on (null, slug)."
        )

    def test_owner_slug_index_uniques_personal_workspaces(self):
        from pymongo import ASCENDING

        indexes = Workspace.Settings.indexes
        owner_slug = next(
            (
                idx
                for idx in indexes
                if idx.document.get("key")
                == {"ownerType": ASCENDING, "ownerUserId": ASCENDING, "slug": ASCENDING}
            ),
            None,
        )
        assert owner_slug is not None, (
            "Personal workspaces are uniqued by (ownerType, ownerUserId, slug); "
            "this index is what makes the partial (orgId, slug) safe."
        )
        assert owner_slug.document.get("unique") is True


class TestModeSwitchBootstrap:
    """Switching DEPLOYMENT_MODE must not crash the bootstrap.

    Production scenario: an operator runs multi_tenant, then flips to
    single_user. A workspace owned by a real OAuth user already exists with
    (orgId=null, slug="personal"). The synthetic owner's bootstrap must
    succeed by creating a fresh personal workspace alongside the old one.
    """

    async def test_single_user_bootstrap_succeeds_when_foreign_personal_exists(self):
        from app.services.bootstrap import ensure_personal_workspace

        user = make_user(user_id="usr-single-user-owner")
        fresh = Workspace.model_construct(
            workspaceId="ws-new-synthetic",
            slug="personal",
            name="My Workspace",
            ownerType="user",
            ownerUserId=user.userId,
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )

        with (
            patch.object(
                WorkspaceRepository, "get_personal_for_user", new_callable=AsyncMock
            ) as mock_get,
            patch.object(
                WorkspaceRepository, "get_orphan_personal", new_callable=AsyncMock
            ) as mock_orphan,
            patch.object(WorkspaceRepository, "create", new_callable=AsyncMock) as mock_create,
            patch.object(WorkspaceRepository, "add_member", new_callable=AsyncMock),
            patch(
                "app.services.bootstrap.create_default_workspace_environment",
                new_callable=AsyncMock,
            ),
        ):
            mock_get.return_value = None
            mock_orphan.return_value = None
            mock_create.return_value = fresh

            result = await ensure_personal_workspace(user)

            assert result.workspaceId == "ws-new-synthetic"
            assert result.ownerUserId == user.userId


class TestAdoptWorkspaceScript:
    """Operator CLI for transferring a workspace to the single-user owner."""

    def test_adopt_script_exists(self):
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "adopt_workspace.py"
        assert script_path.exists()

    async def test_adopt_reassigns_ownership_and_adds_membership(self):
        import importlib.util
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "adopt_workspace.py"
        spec = importlib.util.spec_from_file_location("adopt_workspace", script_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        existing_ws = Workspace.model_construct(
            workspaceId="ws-foreign",
            slug="personal",
            name="Stale",
            ownerType="user",
            ownerUserId="usr-old",
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        synthetic_owner = make_user(user_id="usr-single-user-owner")

        with (
            patch.object(module, "connect_db", new_callable=AsyncMock),
            patch.object(module, "close_db", new_callable=AsyncMock),
            patch.object(module, "_ensure_implicit_owner", new_callable=AsyncMock) as mock_owner,
            patch.object(WorkspaceRepository, "get_by_id", new_callable=AsyncMock) as mock_get,
            patch.object(
                WorkspaceRepository, "get_by_slug_and_user", new_callable=AsyncMock
            ) as mock_conflict,
            patch.object(
                WorkspaceRepository, "force_transfer_to_user", new_callable=AsyncMock
            ) as mock_transfer,
            patch.object(WorkspaceRepository, "get_member", new_callable=AsyncMock) as mock_member,
            patch.object(WorkspaceRepository, "add_member", new_callable=AsyncMock) as mock_add,
        ):
            mock_owner.return_value = synthetic_owner
            mock_get.return_value = existing_ws
            mock_conflict.return_value = None
            mock_member.return_value = None

            exit_code = await module.adopt_workspace("ws-foreign")

            assert exit_code == 0
            mock_transfer.assert_awaited_once_with("ws-foreign", synthetic_owner.userId)
            mock_add.assert_awaited_once()

    async def test_adopt_is_idempotent_when_already_owned(self):
        import importlib.util
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "adopt_workspace.py"
        spec = importlib.util.spec_from_file_location("adopt_workspace", script_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        synthetic_owner = make_user(user_id="usr-single-user-owner")
        existing_ws = Workspace.model_construct(
            workspaceId="ws-already-owned",
            slug="personal",
            name="My Workspace",
            ownerType="user",
            ownerUserId=synthetic_owner.userId,
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        existing_member = object()

        with (
            patch.object(module, "connect_db", new_callable=AsyncMock),
            patch.object(module, "close_db", new_callable=AsyncMock),
            patch.object(module, "_ensure_implicit_owner", new_callable=AsyncMock) as mock_owner,
            patch.object(WorkspaceRepository, "get_by_id", new_callable=AsyncMock) as mock_get,
            patch.object(
                WorkspaceRepository, "force_transfer_to_user", new_callable=AsyncMock
            ) as mock_transfer,
            patch.object(WorkspaceRepository, "get_member", new_callable=AsyncMock) as mock_member,
            patch.object(WorkspaceRepository, "add_member", new_callable=AsyncMock) as mock_add,
        ):
            mock_owner.return_value = synthetic_owner
            mock_get.return_value = existing_ws
            mock_member.return_value = existing_member

            exit_code = await module.adopt_workspace("ws-already-owned")

            assert exit_code == 0
            mock_transfer.assert_not_awaited()
            mock_add.assert_not_awaited()

    async def test_adopt_refuses_when_owner_already_has_personal(self):
        import importlib.util
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "adopt_workspace.py"
        spec = importlib.util.spec_from_file_location("adopt_workspace", script_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        target = Workspace.model_construct(
            workspaceId="ws-target",
            slug="personal",
            name="Old",
            ownerType="user",
            ownerUserId="usr-old",
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        bootstrap_existing = Workspace.model_construct(
            workspaceId="ws-bootstrap-already-there",
            slug="personal",
            name="My Workspace",
            ownerType="user",
            ownerUserId="usr-single-user-owner",
            isPersonal=True,
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        synthetic_owner = make_user(user_id="usr-single-user-owner")

        with (
            patch.object(module, "connect_db", new_callable=AsyncMock),
            patch.object(module, "close_db", new_callable=AsyncMock),
            patch.object(module, "_ensure_implicit_owner", new_callable=AsyncMock) as mock_owner,
            patch.object(WorkspaceRepository, "get_by_id", new_callable=AsyncMock) as mock_get,
            patch.object(
                WorkspaceRepository, "get_by_slug_and_user", new_callable=AsyncMock
            ) as mock_conflict,
            patch.object(
                WorkspaceRepository, "force_transfer_to_user", new_callable=AsyncMock
            ) as mock_transfer,
            patch.object(WorkspaceRepository, "add_member", new_callable=AsyncMock) as mock_add,
        ):
            mock_owner.return_value = synthetic_owner
            mock_get.return_value = target
            mock_conflict.return_value = bootstrap_existing

            exit_code = await module.adopt_workspace("ws-target")

            assert exit_code == 3
            mock_transfer.assert_not_awaited()
            mock_add.assert_not_awaited()

    async def test_adopt_returns_error_when_workspace_missing(self):
        import importlib.util
        from pathlib import Path

        script_path = Path(__file__).parent.parent / "scripts" / "adopt_workspace.py"
        spec = importlib.util.spec_from_file_location("adopt_workspace", script_path)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        with (
            patch.object(module, "connect_db", new_callable=AsyncMock),
            patch.object(module, "close_db", new_callable=AsyncMock),
            patch.object(WorkspaceRepository, "get_by_id", new_callable=AsyncMock) as mock_get,
        ):
            mock_get.return_value = None
            exit_code = await module.adopt_workspace("ws-missing")
            assert exit_code == 2


class TestWipeScript:
    """Verify wipe_db script exists and is importable."""

    def test_wipe_script_exists(self):
        """wipe_db.py script should exist."""
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
