"""
Tests for project export/import schema v2 (Wave 2, Task 13).

Covers:
- Export contains references only — no secret values, ciphertext, or private keys.
- Import warns about missing secret references.
- Dry-run validation catches structural errors.
- Forbidden fields in bundles are rejected.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.project_export_service import (
    SCHEMA_VERSION,
    _check_no_secret_values,
    _extract_secret_refs_from_string,
    _sanitize_export_value,
    _validate_bundle_structure,
    dry_run_import_v2,
    export_project_v2,
    import_project_v2,
)

# ---------------------------------------------------------------------------
# Fixtures — mock documents (MagicMock to avoid Beanie initialization)
# ---------------------------------------------------------------------------


def _make_workspace(workspace_id: str = "ws-test-001") -> MagicMock:
    ws = MagicMock()
    ws.workspaceId = workspace_id
    ws.slug = "test-workspace"
    ws.name = "Test Workspace"
    ws.ownerType = "user"
    ws.ownerUserId = "user-001"
    ws.orgId = None
    ws.isPersonal = True
    return ws


def _make_project(project_id: str = "prj-test-001", workspace_id: str = "ws-test-001") -> MagicMock:
    p = MagicMock()
    p.collectionId = project_id
    p.projectId = project_id
    p.name = "Test Project"
    p.description = "A test project"
    p.color = "#FF5733"
    p.workspaceId = workspace_id
    p.orgId = None
    p.ownerType = "user"
    return p


def _make_workflow(
    workflow_id: str = "wf-test-001",
    project_id: str = "prj-test-001",
    workspace_id: str = "ws-test-001",
    env_id: str = "env-test-001",
) -> MagicMock:
    wf = MagicMock()
    wf.workflowId = workflow_id
    wf.name = "Test Workflow"
    wf.description = "A test workflow"
    wf.selectedEnvironmentId = env_id
    wf.environmentId = None
    wf.workspaceId = workspace_id
    wf.collectionId = project_id
    wf.tags = ["test"]
    wf.variables = {
        "base_url": "https://api.example.com",
        "api_key": "should-be-sanitized",
    }

    # model_dump returns a dict representation
    wf.model_dump = MagicMock(return_value={
        "workflowId": workflow_id,
        "name": "Test Workflow",
        "description": "A test workflow",
        "nodes": [
            {"nodeId": "start_1", "type": "start", "label": "Start", "position": {"x": 100, "y": 100}, "config": {}},
            {
                "nodeId": "httpRequest_1", "type": "http-request", "label": "API Call",
                "position": {"x": 300, "y": 100},
                "config": {
                    "method": "GET",
                    "url": "https://api.example.com/data",
                    "headers": "Authorization=Bearer {{secrets.API_TOKEN}}",
                    "body": None,
                    "timeout": 30,
                    "followRedirects": True,
                    "extractors": {},
                },
            },
            {"nodeId": "end_1", "type": "end", "label": "End", "position": {"x": 500, "y": 100}, "config": {}},
        ],
        "edges": [
            {"edgeId": "e1", "source": "start_1", "target": "httpRequest_1"},
            {"edgeId": "e2", "source": "httpRequest_1", "target": "end_1"},
        ],
        "variables": {
            "base_url": "https://api.example.com",
            "api_key": "should-be-sanitized",
        },
        "tags": ["test"],
        "selectedEnvironmentId": env_id,
        "environmentId": None,
        "collectionId": project_id,
        "workspaceId": workspace_id,
    })

    # For save() during import
    wf.save = AsyncMock()
    wf.updatedAt = datetime.now(UTC)

    return wf


def _make_environment(env_id: str = "env-test-001", workspace_id: str = "ws-test-001") -> MagicMock:
    env = MagicMock()
    env.environmentId = env_id
    env.name = "Development"
    env.description = "Dev environment"
    env.scopeType = "workspace"
    env.scopeId = workspace_id
    env.ownerType = "user"
    env.variables = {
        "BASE_URL": "https://dev.example.com",
        "db_password": "super-secret-db-pass",
    }
    env.swaggerDocUrl = None
    env.isDefault = True
    return env


# ---------------------------------------------------------------------------
# Unit tests — helper functions
# ---------------------------------------------------------------------------


class TestSecretRefExtraction:
    """Tests for secret reference extraction from strings."""

    def test_single_ref(self) -> None:
        refs = _extract_secret_refs_from_string("Bearer {{secrets.API_TOKEN}}")
        assert refs == ["API_TOKEN"]

    def test_multiple_refs(self) -> None:
        refs = _extract_secret_refs_from_string(
            "{{secrets.API_TOKEN}} and {{secrets.DB_PASSWORD}}"
        )
        assert sorted(refs) == ["API_TOKEN", "DB_PASSWORD"]

    def test_no_refs(self) -> None:
        refs = _extract_secret_refs_from_string("plain text value")
        assert refs == []

    def test_non_string(self) -> None:
        refs = _extract_secret_refs_from_string(123)  # type: ignore[arg-type]
        assert refs == []

    def test_partial_match_ignored(self) -> None:
        """Only full {{secrets.NAME}} patterns are extracted."""
        refs = _extract_secret_refs_from_string("{{secrets.}}")
        assert refs == []

    def test_underscore_in_name(self) -> None:
        refs = _extract_secret_refs_from_string("{{secrets.MY_SECRET_KEY}}")
        assert refs == ["MY_SECRET_KEY"]


class TestForbiddenFieldCheck:
    """Tests for the forbidden field checker."""

    def test_clean_data_passes(self) -> None:
        _check_no_secret_values({"name": "test", "variables": {"key": "value"}})

    def test_ciphertext_rejected(self) -> None:
        with pytest.raises(ValueError, match="forbidden secret field"):
            _check_no_secret_values({"ciphertext": "abc123"})

    def test_private_key_rejected(self) -> None:
        with pytest.raises(ValueError, match="forbidden secret field"):
            _check_no_secret_values({"privateKey": "abc123"})

    def test_nested_forbidden_rejected(self) -> None:
        with pytest.raises(ValueError, match="forbidden secret field"):
            _check_no_secret_values({
                "workflows": [{"secrets": {"ciphertext": "abc"}}]
            })

    def test_sanitize_export_value_strips_forbidden(self) -> None:
        """_sanitize_export_value raises on forbidden keys."""
        with pytest.raises(ValueError, match="forbidden secret fields"):
            _sanitize_export_value({"ciphertext": "leaked"})


class TestBundleValidation:
    """Tests for bundle structure validation."""

    def test_valid_bundle(self) -> None:
        _validate_bundle_structure({
            "schemaVersion": "2.0",
            "workflows": [],
            "project": {"name": "Test"},
        })

    def test_missing_workflows(self) -> None:
        with pytest.raises(ValueError, match="missing 'workflows'"):
            _validate_bundle_structure({"project": {"name": "Test"}})

    def test_non_dict_bundle(self) -> None:
        with pytest.raises(ValueError, match="must be a JSON object"):
            _validate_bundle_structure("not a dict")  # type: ignore[arg-type]

    def test_bundle_with_ciphertext_rejected(self) -> None:
        with pytest.raises(ValueError, match="forbidden secret field"):
            _validate_bundle_structure({
                "workflows": [],
                "project": {"name": "Test"},
                "secretData": {"ciphertext": "leaked"},
            })


# ---------------------------------------------------------------------------
# Integration tests — export_project_v2
# ---------------------------------------------------------------------------


class TestExportProjectV2:
    """Tests for the export_project_v2 function."""

    @pytest.mark.asyncio
    async def test_export_contains_references_only(self) -> None:
        """Export contains secret references but NEVER secret values/ciphertext."""
        workspace = _make_workspace()
        project = _make_project()
        workflow = _make_workflow()
        environment = _make_environment()

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.ProjectRepository") as prj_repo,
            patch("app.services.project_export_service.WorkflowRepository") as wf_repo,
            patch("app.services.project_export_service.ScopedEnvironmentRepository") as env_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            prj_repo.get_by_id = AsyncMock(return_value=project)
            wf_repo.list_by_workspace_and_project = AsyncMock(return_value=([workflow], 1))
            env_repo.get_by_id = AsyncMock(return_value=environment)

            bundle = await export_project_v2("prj-test-001", "ws-test-001", "user-001")

        # Schema v2 assertions
        assert bundle["schemaVersion"] == SCHEMA_VERSION
        assert bundle["type"] == "awecollection"
        assert "project" in bundle
        assert bundle["project"]["name"] == "Test Project"

        # Secret references exist
        secret_refs = bundle["secretReferences"]
        assert len(secret_refs) > 0
        ref_names = [r["name"] for r in secret_refs]
        assert "API_TOKEN" in ref_names

        # Each reference has structured fields
        for ref in secret_refs:
            assert "name" in ref
            assert "scopeType" in ref
            assert "scopeId" in ref

        # CRITICAL: No secret values, ciphertext, or private keys in the bundle
        bundle_json = json.dumps(bundle)
        assert "super-secret-db-pass" not in bundle_json
        assert "should-be-sanitized" not in bundle_json
        assert "ciphertext" not in bundle_json
        assert "privateKey" not in bundle_json
        assert "private_key" not in bundle_json

    @pytest.mark.asyncio
    async def test_export_sanitizes_secret_key_variables(self) -> None:
        """Variables with secret-matching key names are replaced with <SECRET>."""
        workspace = _make_workspace()
        project = _make_project()
        workflow = _make_workflow()
        environment = _make_environment()

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.ProjectRepository") as prj_repo,
            patch("app.services.project_export_service.WorkflowRepository") as wf_repo,
            patch("app.services.project_export_service.ScopedEnvironmentRepository") as env_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            prj_repo.get_by_id = AsyncMock(return_value=project)
            wf_repo.list_by_workspace_and_project = AsyncMock(return_value=([workflow], 1))
            env_repo.get_by_id = AsyncMock(return_value=environment)

            bundle = await export_project_v2("prj-test-001", "ws-test-001", "user-001")

        # Workflow variables: api_key should be sanitized
        wf_vars = bundle["workflows"][0]["variables"]
        assert wf_vars["api_key"] == "<SECRET>"
        assert wf_vars["base_url"] == "https://api.example.com"

        # Environment variables: db_password should be sanitized
        env_vars = bundle["environments"][0]["variables"]
        assert env_vars["db_password"] == "<SECRET>"
        assert env_vars["BASE_URL"] == "https://dev.example.com"

    @pytest.mark.asyncio
    async def test_export_metadata_counts(self) -> None:
        """Export metadata includes correct counts."""
        workspace = _make_workspace()
        project = _make_project()
        workflow = _make_workflow()
        environment = _make_environment()

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.ProjectRepository") as prj_repo,
            patch("app.services.project_export_service.WorkflowRepository") as wf_repo,
            patch("app.services.project_export_service.ScopedEnvironmentRepository") as env_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            prj_repo.get_by_id = AsyncMock(return_value=project)
            wf_repo.list_by_workspace_and_project = AsyncMock(return_value=([workflow], 1))
            env_repo.get_by_id = AsyncMock(return_value=environment)

            bundle = await export_project_v2("prj-test-001", "ws-test-001", "user-001")

        meta = bundle["metadata"]
        assert meta["schemaVersion"] == SCHEMA_VERSION
        assert meta["workflowCount"] == 1
        assert meta["environmentCount"] == 1
        assert meta["secretReferenceCount"] >= 1
        assert "exportedAt" in meta

    @pytest.mark.asyncio
    async def test_export_project_not_found(self) -> None:
        """Export raises ResourceNotFoundError for missing project."""
        from app.services.exceptions import ResourceNotFoundError

        workspace = _make_workspace()

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.ProjectRepository") as prj_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            prj_repo.get_by_id = AsyncMock(return_value=None)

            with pytest.raises(ResourceNotFoundError, match="not found"):
                await export_project_v2("prj-missing", "ws-test-001", "user-001")


# ---------------------------------------------------------------------------
# Integration tests — import_project_v2
# ---------------------------------------------------------------------------


class TestImportProjectV2:
    """Tests for the import_project_v2 function."""

    @pytest.mark.asyncio
    async def test_import_warns_missing_secret(self) -> None:
        """Import warns when a referenced secret doesn't exist in target workspace."""
        workspace = _make_workspace()
        bundle = {
            "schemaVersion": SCHEMA_VERSION,
            "type": "awecollection",
            "project": {
                "projectId": "prj-old-001",
                "name": "Imported Project",
                "description": "Test import",
                "color": "#3B82F6",
            },
            "workflows": [
                {
                    "workflowId": "wf-old-001",
                    "name": "Test Workflow",
                    "description": "",
                    "nodes": [
                        {"nodeId": "start_1", "type": "start", "label": "Start", "position": {"x": 0, "y": 0}, "config": {}},
                        {"nodeId": "end_1", "type": "end", "label": "End", "position": {"x": 200, "y": 0}, "config": {}},
                    ],
                    "edges": [
                        {"edgeId": "e1", "source": "start_1", "target": "end_1"},
                    ],
                    "variables": {},
                    "tags": [],
                    "selectedEnvironmentId": "env-old-001",
                },
            ],
            "environments": [
                {
                    "environmentId": "env-old-001",
                    "name": "Dev",
                    "scopeType": "workspace",
                    "scopeId": "ws-old",
                    "variables": {"BASE_URL": "https://dev.example.com"},
                },
            ],
            "secretReferences": [
                {"name": "API_TOKEN", "scopeType": "workspace", "scopeId": "ws-old"},
                {"name": "DB_PASSWORD", "scopeType": "workspace", "scopeId": "ws-old"},
            ],
        }

        mock_project = _make_project(project_id="prj-new-001")
        mock_wf = _make_workflow(workflow_id="wf-new-001")

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.ProjectRepository") as prj_repo,
            patch("app.services.project_export_service.WorkflowRepository") as wf_repo,
            patch("app.services.project_export_service.ScopedEnvironmentRepository") as env_repo,
            patch("app.services.project_export_service.SecretRepository") as secret_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
            patch("app.services.audit_service.append_event", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            prj_repo.create = AsyncMock(return_value=mock_project)
            wf_repo.create_scoped = AsyncMock(return_value=mock_wf)
            env_repo.create = AsyncMock(return_value=_make_environment(env_id="env-new-001"))

            # Neither secret exists in target workspace
            secret_repo.get_by_scope_and_name = AsyncMock(return_value=None)

            result = await import_project_v2(bundle, "ws-test-001", "user-001")

        # Import succeeded
        assert result["projectId"] is not None
        assert result["workflowCount"] == 1
        assert result["environmentCount"] == 1

        # Warnings for missing secrets
        assert len(result["warnings"]) >= 2
        assert len(result["missingSecrets"]) == 2
        assert "API_TOKEN" in result["missingSecrets"]
        assert "DB_PASSWORD" in result["missingSecrets"]

        # Warning messages mention the missing secrets
        warning_text = " ".join(result["warnings"])
        assert "API_TOKEN" in warning_text
        assert "DB_PASSWORD" in warning_text

    @pytest.mark.asyncio
    async def test_import_no_warning_when_secret_exists(self) -> None:
        """Import does NOT warn when the secret exists in target workspace."""
        workspace = _make_workspace()
        bundle = {
            "schemaVersion": SCHEMA_VERSION,
            "type": "awecollection",
            "project": {"name": "Test", "description": "", "color": "#3B82F6"},
            "workflows": [
                {
                    "name": "WF",
                    "nodes": [{"nodeId": "s1", "type": "start", "position": {"x": 0, "y": 0}, "config": {}}],
                    "edges": [],
                    "variables": {},
                    "tags": [],
                },
            ],
            "environments": [],
            "secretReferences": [
                {"name": "API_TOKEN", "scopeType": "workspace", "scopeId": "ws-old"},
            ],
        }

        # Mock a secret that exists
        existing_secret = MagicMock()
        existing_secret.name = "API_TOKEN"

        mock_project = _make_project(project_id="prj-new")
        mock_wf = _make_workflow()

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.ProjectRepository") as prj_repo,
            patch("app.services.project_export_service.WorkflowRepository") as wf_repo,
            patch("app.services.project_export_service.SecretRepository") as secret_repo,
            patch(
                "app.services.workspace_service._assert_workspace_access",
                new_callable=AsyncMock,
            ),
            patch("app.services.audit_service.append_event", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            prj_repo.create = AsyncMock(return_value=mock_project)
            wf_repo.create_scoped = AsyncMock(return_value=mock_wf)

            # Secret exists at workspace scope
            secret_repo.get_by_scope_and_name = AsyncMock(return_value=existing_secret)

            result = await import_project_v2(bundle, "ws-test-001", "user-001")

        assert result["missingSecrets"] == []
        # No missing-secret warnings
        missing_warnings = [w for w in result["warnings"] if "not exist" in w]
        assert len(missing_warnings) == 0

    @pytest.mark.asyncio
    async def test_import_invalid_bundle(self) -> None:
        """Import raises ValueError for invalid bundle."""
        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=_make_workspace())

            with pytest.raises(ValueError, match="missing 'workflows'"):
                await import_project_v2({"project": {"name": "Test"}}, "ws-test-001", "user-001")

    @pytest.mark.asyncio
    async def test_import_bundle_with_ciphertext_rejected(self) -> None:
        """Import rejects bundles containing forbidden secret fields."""
        bundle = {
            "schemaVersion": SCHEMA_VERSION,
            "workflows": [],
            "project": {"name": "Test"},
            "secretData": {"ciphertext": "leaked-value"},
        }

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=_make_workspace())

            with pytest.raises(ValueError, match="forbidden secret field"):
                await import_project_v2(bundle, "ws-test-001", "user-001")


# ---------------------------------------------------------------------------
# Integration tests — dry_run_import_v2
# ---------------------------------------------------------------------------


class TestDryRunImportV2:
    """Tests for the dry_run_import_v2 function."""

    @pytest.mark.asyncio
    async def test_dry_run_valid_bundle(self) -> None:
        """Dry run returns valid=True for a correct bundle."""
        workspace = _make_workspace()
        bundle = {
            "schemaVersion": SCHEMA_VERSION,
            "workflows": [
                {
                    "name": "WF",
                    "nodes": [{"nodeId": "s1", "type": "start", "position": {"x": 0, "y": 0}, "config": {}}],
                    "edges": [],
                    "variables": {},
                },
            ],
            "environments": [],
            "secretReferences": [],
        }

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)

            result = await dry_run_import_v2(bundle, "ws-test-001", "user-001")

        assert result["valid"] is True
        assert result["stats"]["workflows"] == 1
        assert result["stats"]["schemaVersion"] == SCHEMA_VERSION

    @pytest.mark.asyncio
    async def test_dry_run_missing_secret_warns(self) -> None:
        """Dry run warns about missing secrets."""
        workspace = _make_workspace()
        bundle = {
            "schemaVersion": SCHEMA_VERSION,
            "workflows": [],
            "environments": [],
            "secretReferences": [
                {"name": "MISSING_SECRET", "scopeType": "workspace", "scopeId": "ws-old"},
            ],
        }

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.project_export_service.SecretRepository") as secret_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)
            secret_repo.get_by_scope_and_name = AsyncMock(return_value=None)

            result = await dry_run_import_v2(bundle, "ws-test-001", "user-001")

        assert result["valid"] is True  # Still valid, just warnings
        assert result["stats"]["missingSecrets"] == 1
        assert any("MISSING_SECRET" in w for w in result["warnings"])

    @pytest.mark.asyncio
    async def test_dry_run_invalid_structure(self) -> None:
        """Dry run returns valid=False for invalid bundle."""
        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=_make_workspace())

            result = await dry_run_import_v2({"no_workflows": True}, "ws-test-001", "user-001")

        assert result["valid"] is False
        assert any("missing 'workflows'" in e for e in result["errors"])

    @pytest.mark.asyncio
    async def test_dry_run_duplicate_node_ids(self) -> None:
        """Dry run catches duplicate node IDs in workflows."""
        workspace = _make_workspace()
        bundle = {
            "schemaVersion": SCHEMA_VERSION,
            "workflows": [
                {
                    "name": "WF",
                    "nodes": [
                        {"nodeId": "dup_1", "type": "start", "position": {"x": 0, "y": 0}, "config": {}},
                        {"nodeId": "dup_1", "type": "end", "position": {"x": 200, "y": 0}, "config": {}},
                    ],
                    "edges": [],
                },
            ],
            "environments": [],
            "secretReferences": [],
        }

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)

            result = await dry_run_import_v2(bundle, "ws-test-001", "user-001")

        assert result["valid"] is False
        assert any("duplicate node ID" in e for e in result["errors"])

    @pytest.mark.asyncio
    async def test_dry_run_wrong_schema_version_warns(self) -> None:
        """Dry run warns when schema version differs."""
        workspace = _make_workspace()
        bundle = {
            "schemaVersion": "1.0",
            "workflows": [],
            "environments": [],
            "secretReferences": [],
        }

        with (
            patch("app.services.project_export_service.WorkspaceRepository") as ws_repo,
            patch("app.services.workspace_service._assert_workspace_access", new_callable=AsyncMock),
        ):
            ws_repo.get_by_id = AsyncMock(return_value=workspace)

            result = await dry_run_import_v2(bundle, "ws-test-001", "user-001")

        assert result["valid"] is True
        assert any("schema version" in w.lower() for w in result["warnings"])
