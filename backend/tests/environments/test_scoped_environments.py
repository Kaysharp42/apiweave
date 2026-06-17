"""
Tests for Wave 2 Task 9: User, organization, and workspace environment APIs.

QA Scenarios:
1. Default environment: Workspace creation creates default env, run without explicit env selects it.
2. Org environment policy: Org env restricted to workspace A succeeds, workspace B fails.
3. Run selection: Run selects exactly one environment.
"""
import pytest
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch, MagicMock

from app.models import (
    Environment,
    EnvironmentProtection,
    EnvironmentProtectionUpdate,
    RunEnvironmentSelection,
    ScopedEnvironmentCreate,
    ScopedEnvironmentUpdate,
    Workspace,
)
from app.services import scoped_environment_service as svc
from app.services.scoped_environment_service import (
    create_default_workspace_environment,
    create_scoped_environment,
    delete_scoped_environment,
    get_default_workspace_environment,
    get_scoped_environment,
    list_scoped_environments,
    resolve_run_environment,
    set_org_env_allowed_workspaces,
    update_scoped_environment,
    list_org_envs_available_for_workspace,
    get_environment_protection,
    update_environment_protection,
)
from app.services.exceptions import ConflictError, ResourceNotFoundError
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository


def _make_env(
    env_id: str = "env-test123",
    name: str = "Test Env",
    scope_type: str = "workspace",
    scope_id: str = "ws-test",
    is_default: bool = False,
    allowed_workspace_ids: list[str] | None = None,
) -> Environment:
    """Build an Environment via model_construct to avoid Beanie init."""
    now = datetime.now(UTC)
    return Environment.model_construct(
        environmentId=env_id,
        name=name,
        scopeType=scope_type,
        scopeId=scope_id,
        ownerType="user",
        variables={},
        secrets={},
        isDefault=is_default,
        allowedWorkspaceIds=allowed_workspace_ids or [],
        createdAt=now,
        updatedAt=now,
    )


# ======================================================================
# Scenario 1: Default environment exists
# ======================================================================


class TestDefaultEnvironment:
    """Workspace creation creates default env, run without explicit env selects it."""

    async def test_create_default_workspace_environment(self):
        """Creating a default workspace environment produces an env with isDefault=True."""
        with patch.object(
            ScopedEnvironmentRepository, "get_default_for_workspace", new_callable=AsyncMock
        ) as mock_get_default, patch.object(
            ScopedEnvironmentRepository, "create_from_dto", new_callable=AsyncMock
        ) as mock_create:
            mock_get_default.return_value = None
            mock_create.return_value = _make_env(
                env_id="env-default",
                name="Default",
                scope_type="workspace",
                scope_id="ws-new",
                is_default=True,
            )

            result = await create_default_workspace_environment("ws-new", owner_type="user")

            assert result.isDefault is True
            assert result.name == "Default"
            assert result.scopeType == "workspace"
            assert result.scopeId == "ws-new"
            mock_create.assert_called_once()

    async def test_default_env_not_duplicated(self):
        """If a default env already exists, it is returned without creating a new one."""
        existing = _make_env(
            env_id="env-existing",
            name="Default",
            scope_type="workspace",
            scope_id="ws-existing",
            is_default=True,
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_default_for_workspace", new_callable=AsyncMock
        ) as mock_get_default, patch.object(
            ScopedEnvironmentRepository, "create_from_dto", new_callable=AsyncMock
        ) as mock_create:
            mock_get_default.return_value = existing

            result = await create_default_workspace_environment("ws-existing")

            assert result.environmentId == "env-existing"
            mock_create.assert_not_called()

    async def test_run_without_explicit_env_selects_default(self):
        """A run without explicit environment selects the workspace default."""
        default_env = _make_env(
            env_id="env-default",
            name="Default",
            scope_type="workspace",
            scope_id="ws-test",
            is_default=True,
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_default_for_workspace", new_callable=AsyncMock
        ) as mock_get_default:
            mock_get_default.return_value = default_env

            result = await resolve_run_environment(workspace_id="ws-test")

            assert result.environmentId == "env-default"
            assert result.scopeType == "workspace"
            assert result.scopeId == "ws-test"
            assert result.name == "Default"

    async def test_run_fails_without_default_env(self):
        """A run fails if no default environment exists for the workspace."""
        with patch.object(
            ScopedEnvironmentRepository, "get_default_for_workspace", new_callable=AsyncMock
        ) as mock_get_default:
            mock_get_default.return_value = None

            with pytest.raises(ResourceNotFoundError, match="No default environment"):
                await resolve_run_environment(workspace_id="ws-no-default")

    async def test_cannot_delete_default_workspace_env(self):
        """Deleting the default workspace environment raises ConflictError."""
        default_env = _make_env(
            env_id="env-default",
            name="Default",
            scope_type="workspace",
            scope_id="ws-test",
            is_default=True,
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = default_env

            with pytest.raises(ConflictError, match="Cannot delete the default"):
                await delete_scoped_environment("env-default")


# ======================================================================
# Scenario 2: Org environment restricted to selected workspace
# ======================================================================


class TestOrgEnvironmentPolicy:
    """Org env can restrict access to specific workspaces."""

    async def test_org_env_allowed_for_listed_workspace(self):
        """Org env with allowedWorkspaceIds=['ws-a'] allows ws-a."""
        org_env = _make_env(
            env_id="env-org",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=["ws-a"],
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = org_env

            result = await ScopedEnvironmentRepository.is_workspace_allowed_for_org_env(
                "env-org", "ws-a"
            )
            assert result is True

    async def test_org_env_denied_for_unlisted_workspace(self):
        """Org env with allowedWorkspaceIds=['ws-a'] denies ws-b."""
        org_env = _make_env(
            env_id="env-org",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=["ws-a"],
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = org_env

            result = await ScopedEnvironmentRepository.is_workspace_allowed_for_org_env(
                "env-org", "ws-b"
            )
            assert result is False

    async def test_org_env_empty_list_allows_all(self):
        """Org env with empty allowedWorkspaceIds allows all workspaces."""
        org_env = _make_env(
            env_id="env-org",
            name="Staging",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=[],
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = org_env

            result = await ScopedEnvironmentRepository.is_workspace_allowed_for_org_env(
                "env-org", "ws-any"
            )
            assert result is True

    async def test_run_with_org_env_allowed_workspace_succeeds(self):
        """Run with explicit org env succeeds when workspace is in allowed list."""
        org_env = _make_env(
            env_id="env-org",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=["ws-a"],
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get, patch.object(
            ScopedEnvironmentRepository, "is_workspace_allowed_for_org_env", new_callable=AsyncMock
        ) as mock_allowed:
            mock_get.return_value = org_env
            mock_allowed.return_value = True

            result = await resolve_run_environment(
                workspace_id="ws-a",
                org_id="org-acme",
                explicit_environment_id="env-org",
            )

            assert result.environmentId == "env-org"
            assert result.scopeType == "organization"

    async def test_run_with_org_env_denied_workspace_fails(self):
        """Run with explicit org env fails when workspace is NOT in allowed list."""
        org_env = _make_env(
            env_id="env-org",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=["ws-a"],
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get, patch.object(
            ScopedEnvironmentRepository, "is_workspace_allowed_for_org_env", new_callable=AsyncMock
        ) as mock_allowed:
            mock_get.return_value = org_env
            mock_allowed.return_value = False

            with pytest.raises(ConflictError, match="not available to workspace"):
                await resolve_run_environment(
                    workspace_id="ws-b",
                    org_id="org-acme",
                    explicit_environment_id="env-org",
                )

    async def test_set_org_env_allowed_workspaces(self):
        """Setting allowed workspaces on an org env updates the policy."""
        org_env = _make_env(
            env_id="env-org",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=[],
        )
        updated_env = _make_env(
            env_id="env-org",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=["ws-a", "ws-b"],
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get, patch.object(
            ScopedEnvironmentRepository, "set_allowed_workspaces", new_callable=AsyncMock
        ) as mock_set:
            mock_get.return_value = org_env
            mock_set.return_value = updated_env

            result = await set_org_env_allowed_workspaces("env-org", ["ws-a", "ws-b"])

            assert result.allowedWorkspaceIds == ["ws-a", "ws-b"]
            mock_set.assert_called_once_with("env-org", ["ws-a", "ws-b"])

    async def test_set_allowed_workspaces_on_non_org_env_fails(self):
        """Setting allowed workspaces on a workspace env raises ConflictError."""
        ws_env = _make_env(
            env_id="env-ws",
            name="Dev",
            scope_type="workspace",
            scope_id="ws-test",
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = ws_env

            with pytest.raises(ConflictError, match="not 'organization'"):
                await set_org_env_allowed_workspaces("env-ws", ["ws-a"])

    async def test_list_org_envs_for_workspace_filters(self):
        """list_org_envs_for_workspace returns only envs available to the workspace."""
        env_all = _make_env(
            env_id="env-all",
            name="Staging",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=[],
        )
        env_restricted = _make_env(
            env_id="env-restricted",
            name="Production",
            scope_type="organization",
            scope_id="org-acme",
            allowed_workspace_ids=["ws-a"],
        )
        with patch.object(
            ScopedEnvironmentRepository, "list_by_scope", new_callable=AsyncMock
        ) as mock_list, patch.object(
            ScopedEnvironmentRepository, "list_org_envs_for_workspace", new_callable=AsyncMock
        ) as mock_filtered:
            mock_filtered.return_value = [env_all, env_restricted]

            result = await list_org_envs_available_for_workspace("org-acme", "ws-a")
            assert len(result) == 2

            mock_filtered.return_value = [env_all]
            result = await list_org_envs_available_for_workspace("org-acme", "ws-b")
            assert len(result) == 1
            assert result[0].environmentId == "env-all"


# ======================================================================
# Scenario 3: Run selects exactly one environment
# ======================================================================


class TestRunEnvironmentSelection:
    """Each run selects exactly one environment."""

    async def test_explicit_workspace_env_selected(self):
        """Explicit workspace environment is selected for the run."""
        ws_env = _make_env(
            env_id="env-staging",
            name="Staging",
            scope_type="workspace",
            scope_id="ws-test",
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = ws_env

            result = await resolve_run_environment(
                workspace_id="ws-test",
                explicit_environment_id="env-staging",
            )

            assert result.environmentId == "env-staging"
            assert result.scopeType == "workspace"
            assert result.scopeId == "ws-test"

    async def test_explicit_env_from_different_workspace_fails(self):
        """Explicit env from a different workspace raises ConflictError."""
        other_env = _make_env(
            env_id="env-other",
            name="Other",
            scope_type="workspace",
            scope_id="ws-other",
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = other_env

            with pytest.raises(ConflictError, match="belongs to workspace"):
                await resolve_run_environment(
                    workspace_id="ws-test",
                    explicit_environment_id="env-other",
                )

    async def test_explicit_nonexistent_env_fails(self):
        """Explicit env that doesn't exist raises ResourceNotFoundError."""
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None

            with pytest.raises(ResourceNotFoundError, match="not found"):
                await resolve_run_environment(
                    workspace_id="ws-test",
                    explicit_environment_id="env-nonexistent",
                )

    async def test_user_env_available_for_run(self):
        """User-scoped environment can be selected for a run."""
        user_env = _make_env(
            env_id="env-user",
            name="My Secrets",
            scope_type="user",
            scope_id="usr-test",
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = user_env

            result = await resolve_run_environment(
                workspace_id="ws-test",
                explicit_environment_id="env-user",
            )

            assert result.environmentId == "env-user"
            assert result.scopeType == "user"

    async def test_run_selection_returns_exactly_one_env(self):
        """resolve_run_environment always returns exactly one RunEnvironmentSelection."""
        default_env = _make_env(
            env_id="env-default",
            name="Default",
            scope_type="workspace",
            scope_id="ws-test",
            is_default=True,
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_default_for_workspace", new_callable=AsyncMock
        ) as mock_get_default:
            mock_get_default.return_value = default_env

            result = await resolve_run_environment(workspace_id="ws-test")

            assert isinstance(result, RunEnvironmentSelection)
            assert result.environmentId is not None
            assert result.scopeType is not None
            assert result.scopeId is not None
            assert result.name is not None


# ======================================================================
# Protection Config Storage
# ======================================================================


class TestProtectionConfig:
    """Protection config can be stored and retrieved per environment."""

    async def test_create_protection_config(self):
        """Protection config can be created for an environment."""
        env = _make_env(env_id="env-test", scope_type="workspace", scope_id="ws-test")
        protection = EnvironmentProtection.model_construct(
            protectionId="prot-test",
            environmentId="env-test",
            requiredReviewers=["usr-reviewer"],
            allowSelfApproval=False,
            bypassPolicy="none",
            bypassAllowlist=[],
            createdAt=datetime.now(UTC),
            updatedAt=datetime.now(UTC),
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get_env, patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
        ) as mock_get_prot, patch.object(
            ScopedEnvironmentRepository, "upsert_protection", new_callable=AsyncMock
        ) as mock_upsert:
            mock_get_env.return_value = env
            mock_get_prot.return_value = None
            mock_upsert.return_value = protection

            data = EnvironmentProtectionUpdate(
                requiredReviewers=["usr-reviewer"],
                allowSelfApproval=False,
            )
            result = await update_environment_protection("env-test", data)

            assert result.requiredReviewers == ["usr-reviewer"]
            assert result.allowSelfApproval is False

    async def test_get_protection_returns_none_when_unprotected(self):
        """get_environment_protection returns None when no protection is configured."""
        env = _make_env(env_id="env-test", scope_type="workspace", scope_id="ws-test")
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get_env, patch.object(
            ScopedEnvironmentRepository, "get_protection", new_callable=AsyncMock
        ) as mock_get_prot:
            mock_get_env.return_value = env
            mock_get_prot.return_value = None

            result = await get_environment_protection("env-test")
            assert result is None


# ======================================================================
# No Global Active Environment
# ======================================================================


class TestNoGlobalActiveEnvironment:
    """Verify no global active environment exists."""

    def test_environment_model_has_no_is_active(self):
        """Environment model should not have isActive field."""
        field_names = set(Environment.model_fields.keys())
        assert "isActive" not in field_names

    def test_environment_model_has_scope_fields(self):
        """Environment model should have scopeType, scopeId, isDefault."""
        field_names = set(Environment.model_fields.keys())
        assert "scopeType" in field_names
        assert "scopeId" in field_names
        assert "isDefault" in field_names
        assert "allowedWorkspaceIds" in field_names


# ======================================================================
# Scoped Environment CRUD
# ======================================================================


class TestScopedEnvironmentCRUD:
    """Basic CRUD operations for scoped environments."""

    async def test_create_scoped_environment(self):
        """Create a scoped environment with correct scope."""
        data = ScopedEnvironmentCreate(name="Staging", variables={"BASE_URL": "https://staging.example.com"})
        with patch.object(
            ScopedEnvironmentRepository, "create_from_dto", new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = _make_env(
                env_id="env-new",
                name="Staging",
                scope_type="workspace",
                scope_id="ws-test",
            )

            result = await create_scoped_environment(
                scope_type="workspace",
                scope_id="ws-test",
                data=data,
            )

            assert result.name == "Staging"
            assert result.scopeType == "workspace"
            mock_create.assert_called_once()

    async def test_get_scoped_environment_not_found(self):
        """Getting a non-existent environment raises ResourceNotFoundError."""
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None

            with pytest.raises(ResourceNotFoundError):
                await get_scoped_environment("env-nonexistent")

    async def test_list_scoped_environments(self):
        """List environments for a scope."""
        envs = [
            _make_env(env_id="env-1", name="Dev", scope_type="workspace", scope_id="ws-test"),
            _make_env(env_id="env-2", name="Staging", scope_type="workspace", scope_id="ws-test"),
        ]
        with patch.object(
            ScopedEnvironmentRepository, "list_by_scope", new_callable=AsyncMock
        ) as mock_list:
            mock_list.return_value = envs

            result = await list_scoped_environments("workspace", "ws-test")
            assert len(result) == 2

    async def test_update_scoped_environment(self):
        """Update a scoped environment."""
        env = _make_env(env_id="env-test", name="Old Name", scope_type="workspace", scope_id="ws-test")
        updated = _make_env(env_id="env-test", name="New Name", scope_type="workspace", scope_id="ws-test")
        with patch.object(
            ScopedEnvironmentRepository, "update", new_callable=AsyncMock
        ) as mock_update:
            mock_update.return_value = updated

            data = ScopedEnvironmentUpdate(name="New Name")
            result = await update_scoped_environment("env-test", data)
            assert result.name == "New Name"

    async def test_delete_non_default_env_succeeds(self):
        """Deleting a non-default workspace env succeeds."""
        env = _make_env(
            env_id="env-staging",
            name="Staging",
            scope_type="workspace",
            scope_id="ws-test",
            is_default=False,
        )
        with patch.object(
            ScopedEnvironmentRepository, "get_by_id", new_callable=AsyncMock
        ) as mock_get, patch.object(
            ScopedEnvironmentRepository, "delete_protection", new_callable=AsyncMock
        ) as mock_del_prot, patch.object(
            ScopedEnvironmentRepository, "delete", new_callable=AsyncMock
        ) as mock_delete:
            mock_get.return_value = env
            mock_delete.return_value = True

            await delete_scoped_environment("env-staging")
            mock_delete.assert_called_once_with("env-staging")
