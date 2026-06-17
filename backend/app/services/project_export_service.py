"""
Project Export/Import Service — schema v2 for .awecollection files.

Schema v2 uses Project terminology and includes secret *references* only.
Secret definitions, ciphertext, plaintext values, and private keys are
NEVER serialized into the export bundle.

Import flow validates secret references against the target workspace and
returns warnings for any missing references.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from app.repositories.project_repository import ProjectRepository
from app.repositories.scoped_environment_repository import ScopedEnvironmentRepository
from app.repositories.secret_repository import SecretRepository
from app.repositories.workflow_repository import WorkflowRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.exceptions import ResourceNotFoundError
from app.services.secret_utils import is_secret_key

logger = logging.getLogger(__name__)

# Regex to extract {{secrets.NAME}} references from arbitrary string values.
_SECRET_REF_RE = re.compile(r"\{\{secrets\.([A-Za-z_][A-Za-z0-9_]*)\}\}")

# Schema version for v2 exports.
SCHEMA_VERSION = "2.0"

# Fields that must NEVER appear in an export bundle — fail-closed if detected.
# These are structural fields from the secret storage layer, NOT user variable names.
# User variable names like "api_key" are sanitized by _sanitize_variables_for_export
# but the key itself is allowed to remain (with a <SECRET> placeholder value).
_FORBIDDEN_EXPORT_KEYS: frozenset[str] = frozenset({
    "ciphertext",
    "privateKey",
    "private_key",
    "plaintext",
    "secretValue",
    "secret_value",
    "encryptedValue",
    "encrypted_value",
    "kek_id",
    "kek",
    "dek",
    "wrapped_dek",
    "hmacSecret",
    "hmac_secret",
})


# ============================================================================
# Secret reference extraction
# ============================================================================


def _extract_secret_refs_from_string(value: str) -> list[str]:
    """Extract secret names from ``{{secrets.NAME}}`` placeholders in a string."""
    if not isinstance(value, str):
        return []
    return _SECRET_REF_RE.findall(value)


def _extract_secret_refs_from_struct(data: Any) -> list[str]:
    """Recursively walk a JSON-like structure and collect all secret names."""
    refs: list[str] = []
    if isinstance(data, dict):
        for key, value in data.items():
            if isinstance(value, str):
                refs.extend(_extract_secret_refs_from_string(value))
            elif isinstance(value, (dict, list)):
                refs.extend(_extract_secret_refs_from_struct(value))
    elif isinstance(data, list):
        for item in data:
            refs.extend(_extract_secret_refs_from_struct(item))
    return refs


def _sanitize_export_value(data: Any) -> Any:
    """Recursively strip any forbidden keys from export data.

    Raises ValueError if a forbidden key is found — this is a programming
    error that must fail loudly to prevent secret leakage.
    """
    if isinstance(data, dict):
        leaked = _FORBIDDEN_EXPORT_KEYS & set(data.keys())
        if leaked:
            raise ValueError(
                f"Export contains forbidden secret fields: {sorted(leaked)}. "
                "This is a programming error — secret values must never reach the export layer."
            )
        return {k: _sanitize_export_value(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_sanitize_export_value(item) for item in data]
    return data


# ============================================================================
# Export — schema v2
# ============================================================================


async def export_project_v2(
    project_id: str,
    workspace_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Export a project as a schema v2 .awecollection bundle.

    The bundle contains:
    - Project metadata (name, description, color)
    - All workflows in the project (nodes, edges, variables — sanitized)
    - All environments referenced by the workflows (variables only, no secrets)
    - Secret references extracted from ``{{secrets.*}}`` placeholders

    NEVER includes: secret values, ciphertext, private keys, or plaintext.

    Parameters
    ----------
    project_id:
        The project to export.
    workspace_id:
        The workspace that owns the project (enforces isolation).
    actor_user_id:
        The user performing the export (for audit).

    Returns
    -------
    A dict representing the schema v2 export bundle.

    Raises
    ------
    ResourceNotFoundError
        If the project or workspace does not exist.
    """
    from app.services.workspace_service import _assert_workspace_access

    # Verify workspace exists and actor has access
    ws = await WorkspaceRepository.get_by_id(workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    # Verify project exists and belongs to workspace
    project = await ProjectRepository.get_by_id(project_id)
    if not project:
        raise ResourceNotFoundError(f"Project {project_id} not found")
    if project.workspaceId and project.workspaceId != workspace_id:
        raise ResourceNotFoundError(f"Project {project_id} not found")

    # Gather workflows in this project
    workflows_list, _ = await WorkflowRepository.list_by_workspace_and_project(
        workspace_id, project_id, skip=0, limit=10000,
    )

    # Collect environment IDs referenced by workflows
    environment_ids: set[str] = set()
    for wf in workflows_list:
        if wf.selectedEnvironmentId:
            environment_ids.add(wf.selectedEnvironmentId)
        if wf.environmentId:
            environment_ids.add(wf.environmentId)

    # Export environments (variables only, no secrets)
    environments_export: list[dict[str, Any]] = []
    for env_id in sorted(environment_ids):
        env = await ScopedEnvironmentRepository.get_by_id(env_id)
        if env:
            env_dict: dict[str, Any] = {
                "environmentId": env.environmentId,
                "name": env.name,
                "description": env.description,
                "scopeType": env.scopeType,
                "scopeId": env.scopeId,
                "variables": dict(env.variables) if env.variables else {},
                "swaggerDocUrl": env.swaggerDocUrl,
            }
            environments_export.append(env_dict)

    # Export workflows with sanitized variables and secret reference extraction
    secret_references: list[dict[str, str]] = []
    seen_secret_refs: set[tuple[str, str, str]] = set()
    workflows_export: list[dict[str, Any]] = []

    for wf in workflows_list:
        wf_dict = wf.model_dump(by_alias=True)

        # Sanitize variables — replace secret-key values with placeholder
        raw_vars = wf_dict.get("variables", {})
        sanitized_vars = _sanitize_variables_for_export(raw_vars)

        # Extract secret references from variables
        _collect_refs(
            sanitized_vars, raw_vars, "workspace", workspace_id,
            secret_references, seen_secret_refs,
        )

        # Sanitize nodes
        sanitized_nodes: list[dict[str, Any]] = []
        for node in wf_dict.get("nodes", []):
            node_copy = dict(node)
            config = node_copy.get("config")
            if isinstance(config, dict):
                sanitized_config = _sanitize_variables_for_export(config)
                # Extract secret refs from node config string values
                _collect_refs_from_config(
                    config, "workspace", workspace_id,
                    secret_references, seen_secret_refs,
                )
                node_copy["config"] = sanitized_config
            sanitized_nodes.append(node_copy)

        wf_export: dict[str, Any] = {
            "workflowId": wf_dict.get("workflowId"),
            "name": wf_dict.get("name"),
            "description": wf_dict.get("description", ""),
            "nodes": sanitized_nodes,
            "edges": wf_dict.get("edges", []),
            "variables": sanitized_vars,
            "tags": wf_dict.get("tags", []),
            "selectedEnvironmentId": wf_dict.get("selectedEnvironmentId"),
        }
        workflows_export.append(wf_export)

    # Also extract secret refs from environment variables (key-name based)
    for env_export in environments_export:
        env_vars = env_export.get("variables", {})
        for key, value in env_vars.items():
            if is_secret_key(key) and isinstance(value, str):
                ref_key = (key, env_export.get("scopeType", ""), env_export.get("scopeId", ""))
                if ref_key not in seen_secret_refs:
                    seen_secret_refs.add(ref_key)
                    secret_references.append({
                        "name": key,
                        "scopeType": env_export.get("scopeType", "workspace"),
                        "scopeId": env_export.get("scopeId", workspace_id),
                    })
        # Sanitize env variables too
        env_export["variables"] = _sanitize_variables_for_export(env_vars)

    # Build the v2 bundle
    bundle: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "type": "awecollection",
        "project": {
            "projectId": project.projectId or project.collectionId,
            "name": project.name,
            "description": project.description or "",
            "color": project.color or "#3B82F6",
        },
        "workflows": workflows_export,
        "environments": environments_export,
        "secretReferences": secret_references,
        "metadata": {
            "exportedAt": datetime.now(UTC).isoformat(),
            "schemaVersion": SCHEMA_VERSION,
            "workflowCount": len(workflows_export),
            "environmentCount": len(environments_export),
            "secretReferenceCount": len(secret_references),
        },
    }

    # Final safety check — ensure no forbidden keys leaked
    _sanitize_export_value(bundle)

    return bundle


def _sanitize_variables_for_export(data: dict[str, Any]) -> dict[str, Any]:
    """Replace values whose keys match secret patterns with <SECRET> placeholder."""
    sanitized: dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, dict):
            sanitized[key] = _sanitize_variables_for_export(value)
        elif isinstance(value, str) and is_secret_key(key):
            sanitized[key] = "<SECRET>"
        else:
            sanitized[key] = value
    return sanitized


def _collect_refs(
    sanitized: dict[str, Any],
    raw: dict[str, Any],
    scope_type: str,
    scope_id: str,
    secret_references: list[dict[str, str]],
    seen: set[tuple[str, str, str]],
) -> None:
    """Collect secret references from raw variable values ({{secrets.*}} patterns)."""
    for key, value in raw.items():
        if isinstance(value, str):
            for name in _extract_secret_refs_from_string(value):
                ref_key = (name, scope_type, scope_id)
                if ref_key not in seen:
                    seen.add(ref_key)
                    secret_references.append({
                        "name": name,
                        "scopeType": scope_type,
                        "scopeId": scope_id,
                    })
        elif isinstance(value, dict):
            _collect_refs(value, value, scope_type, scope_id, secret_references, seen)


def _collect_refs_from_config(
    config: dict[str, Any],
    scope_type: str,
    scope_id: str,
    secret_references: list[dict[str, str]],
    seen: set[tuple[str, str, str]],
) -> None:
    """Collect secret references from node config values."""
    for _key, value in config.items():
        if isinstance(value, str):
            for name in _extract_secret_refs_from_string(value):
                ref_key = (name, scope_type, scope_id)
                if ref_key not in seen:
                    seen.add(ref_key)
                    secret_references.append({
                        "name": name,
                        "scopeType": scope_type,
                        "scopeId": scope_id,
                    })
        elif isinstance(value, dict):
            _collect_refs_from_config(value, scope_type, scope_id, secret_references, seen)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    for name in _extract_secret_refs_from_string(item):
                        ref_key = (name, scope_type, scope_id)
                        if ref_key not in seen:
                            seen.add(ref_key)
                            secret_references.append({
                                "name": name,
                                "scopeType": scope_type,
                                "scopeId": scope_id,
                            })
                elif isinstance(item, dict):
                    _collect_refs_from_config(item, scope_type, scope_id, secret_references, seen)


# ============================================================================
# Import — schema v2
# ============================================================================


async def import_project_v2(
    bundle: dict[str, Any],
    target_workspace_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Import a schema v2 .awecollection bundle into a target workspace.

    Creates:
    - A new project in the target workspace
    - Workflows from the bundle, mapped to the new project
    - Environments from the bundle (variables only, no secrets)

    Returns warnings for:
    - Secret references that don't exist in the target workspace
    - Environment references that couldn't be mapped

    Parameters
    ----------
    bundle:
        The schema v2 export bundle.
    target_workspace_id:
        The workspace to import into.
    actor_user_id:
        The user performing the import (for audit).

    Returns
    -------
    A dict with projectId, workflowCount, environmentCount, and warnings.

    Raises
    ------
    ResourceNotFoundError
        If the target workspace does not exist.
    ValueError
        If the bundle is invalid.
    """
    from app.services.workspace_service import _assert_workspace_access

    # Validate bundle
    _validate_bundle_structure(bundle)

    # Verify target workspace
    ws = await WorkspaceRepository.get_by_id(target_workspace_id)
    if not ws:
        raise ResourceNotFoundError(f"Workspace {target_workspace_id} not found")
    await _assert_workspace_access(ws, actor_user_id)

    project_data = bundle.get("project", {})
    workflows_data = bundle.get("workflows", [])
    environments_data = bundle.get("environments", [])
    secret_references = bundle.get("secretReferences", [])

    warnings: list[str] = []

    # Create the project
    new_project_id = f"prj-{uuid.uuid4().hex[:16]}"
    await ProjectRepository.create(
        project_id=new_project_id,
        name=project_data.get("name", "Imported Project"),
        workspace_id=target_workspace_id,
        org_id=ws.orgId,
        owner_type=ws.ownerType,
        description=project_data.get("description"),
        color=project_data.get("color"),
    )

    # Build environment mapping: old envId -> new envId
    env_mapping: dict[str, str] = {}
    imported_environments = 0

    for env_data in environments_data:
        old_env_id = env_data.get("environmentId", "")
        env_name = env_data.get("name", "Imported Environment")
        variables = env_data.get("variables", {})

        new_env_id = f"env-{uuid.uuid4().hex[:16]}"
        await ScopedEnvironmentRepository.create(
            environment_id=new_env_id,
            name=env_name,
            scope_type="workspace",
            scope_id=target_workspace_id,
            owner_type=ws.ownerType,
            variables=variables,
            description=env_data.get("description"),
        )
        env_mapping[old_env_id] = new_env_id
        imported_environments += 1

    # Import workflows
    imported_workflows = 0
    for wf_data in workflows_data:
        from app.models import Edge, Node, WorkflowCreate

        nodes = []
        for node in wf_data.get("nodes", []):
            nodes.append(Node(
                nodeId=node.get("nodeId", str(uuid.uuid4())),
                type=node.get("type", "http-request"),
                label=node.get("label", ""),
                position=node.get("position", {"x": 0, "y": 0}),
                config=node.get("config", {}),
            ))

        edges = []
        for edge in wf_data.get("edges", []):
            edges.append(Edge(
                edgeId=edge.get("edgeId", str(uuid.uuid4())),
                source=edge.get("source", ""),
                target=edge.get("target", ""),
                sourceHandle=edge.get("sourceHandle"),
                targetHandle=edge.get("targetHandle"),
                label=edge.get("label"),
            ))

        # Map environment reference
        old_env_id = wf_data.get("selectedEnvironmentId")
        mapped_env_id: str | None = env_mapping.get(old_env_id, "") if old_env_id else None

        wf_create = WorkflowCreate(
            name=wf_data.get("name", "Imported Workflow"),
            description=wf_data.get("description"),
            nodes=nodes,
            edges=edges,
            variables=wf_data.get("variables", {}),
            tags=wf_data.get("tags", []),
            collectionId=new_project_id,
        )
        created_wf = await WorkflowRepository.create_scoped(
            wf_create,
            workspace_id=target_workspace_id,
            org_id=ws.orgId,
            owner_type=ws.ownerType,
        )

        # Set selected environment if mapped
        if mapped_env_id:
            created_wf.selectedEnvironmentId = mapped_env_id
            created_wf.updatedAt = datetime.now(UTC)
            await created_wf.save()
        elif old_env_id:
            warnings.append(
                f"Environment reference '{old_env_id}' in workflow "
                f"'{wf_data.get('name', 'unknown')}' could not be mapped"
            )

        imported_workflows += 1

    # Check secret references against target workspace
    missing_secrets: list[str] = []
    for ref in secret_references:
        secret_name = ref.get("name", "")
        if not secret_name:
            continue

        # Check if the secret exists in the target workspace at any scope
        found = await _check_secret_exists(secret_name, target_workspace_id, ws.orgId)
        if not found:
            missing_secrets.append(secret_name)
            warnings.append(
                f"Secret '{secret_name}' referenced in export does not exist "
                f"in target workspace — it must be re-created manually"
            )

    # Audit the import
    try:
        from app.services.audit_service import append_event
        await append_event(
            actor="user",
            actor_id=actor_user_id,
            action="project.imported",
            scope="workspace",
            scope_id=target_workspace_id,
            resource_type="project",
            resource_id=new_project_id,
            context={
                "workflowCount": imported_workflows,
                "environmentCount": imported_environments,
                "secretReferenceCount": len(secret_references),
                "missingSecretCount": len(missing_secrets),
                "schemaVersion": SCHEMA_VERSION,
            },
        )
    except Exception:
        logger.warning("Audit write failed for project import", exc_info=True)

    return {
        "message": "Project imported successfully",
        "projectId": new_project_id,
        "workflowCount": imported_workflows,
        "environmentCount": imported_environments,
        "secretReferences": len(secret_references),
        "missingSecrets": missing_secrets,
        "warnings": warnings,
    }


async def _check_secret_exists(
    name: str,
    workspace_id: str,
    org_id: str | None,
) -> bool:
    """Check if a secret with the given name exists at workspace or org scope."""
    # Check workspace scope
    ws_secret = await SecretRepository.get_by_scope_and_name("workspace", workspace_id, name)
    if ws_secret:
        return True

    # Check org scope
    if org_id:
        org_secret = await SecretRepository.get_by_scope_and_name("organization", org_id, name)
        if org_secret:
            return True

    return False


# ============================================================================
# Dry-run import validation — schema v2
# ============================================================================


async def dry_run_import_v2(
    bundle: dict[str, Any],
    target_workspace_id: str,
    actor_user_id: str,
) -> dict[str, Any]:
    """Validate a schema v2 bundle without persisting anything.

    Returns validation result with errors, warnings, and stats.
    """
    from app.services.workspace_service import _assert_workspace_access

    errors: list[str] = []
    warnings: list[str] = []

    # Validate structure
    try:
        _validate_bundle_structure(bundle)
    except ValueError as exc:
        errors.append(str(exc))
        return {"valid": False, "errors": errors, "warnings": warnings}

    # Check schema version
    schema_version = bundle.get("schemaVersion", "")
    if schema_version != SCHEMA_VERSION:
        warnings.append(
            f"Bundle schema version '{schema_version}' differs from "
            f"expected '{SCHEMA_VERSION}' — some features may not import correctly"
        )

    # Verify target workspace
    ws = await WorkspaceRepository.get_by_id(target_workspace_id)
    if not ws:
        errors.append(f"Target workspace {target_workspace_id} not found")
        return {"valid": False, "errors": errors, "warnings": warnings}

    try:
        await _assert_workspace_access(ws, actor_user_id)
    except Exception:
        errors.append("Actor does not have access to target workspace")
        return {"valid": False, "errors": errors, "warnings": warnings}

    workflows_data = bundle.get("workflows", [])
    environments_data = bundle.get("environments", [])
    secret_references = bundle.get("secretReferences", [])

    # Validate workflows
    for idx, wf in enumerate(workflows_data):
        if "name" not in wf:
            errors.append(f"Workflow at index {idx} missing 'name'")
        if "nodes" not in wf:
            errors.append(f"Workflow at index {idx} missing 'nodes'")
        else:
            node_ids: set[str] = set()
            for nidx, node in enumerate(wf["nodes"]):
                nid = node.get("nodeId")
                if not nid:
                    errors.append(f"Workflow {idx}, node at index {nidx} missing 'nodeId'")
                elif nid in node_ids:
                    errors.append(f"Workflow {idx}, duplicate node ID: {nid}")
                else:
                    node_ids.add(nid)

    # Check secret references
    missing_count = 0
    for ref in secret_references:
        secret_name = ref.get("name", "")
        if not secret_name:
            continue
        found = await _check_secret_exists(secret_name, target_workspace_id, ws.orgId)
        if not found:
            missing_count += 1
            warnings.append(
                f"Secret '{secret_name}' not found in target workspace"
            )

    if missing_count > 0:
        warnings.append(
            f"{missing_count} secret reference(s) missing in target workspace — "
            f"they must be re-created manually after import"
        )

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "schemaVersion": bundle.get("schemaVersion", "unknown"),
            "workflows": len(workflows_data),
            "environments": len(environments_data),
            "secretReferences": len(secret_references),
            "missingSecrets": missing_count,
        },
    }


# ============================================================================
# Bundle validation
# ============================================================================


def _validate_bundle_structure(bundle: dict[str, Any]) -> None:
    """Validate the basic structure of a v2 export bundle."""
    if not isinstance(bundle, dict):
        raise ValueError("Bundle must be a JSON object")

    if "workflows" not in bundle:
        raise ValueError("Invalid bundle: missing 'workflows' key")

    # Check for forbidden fields — secret values must never be in a bundle
    _check_no_secret_values(bundle)


def _check_no_secret_values(data: Any, path: str = "") -> None:
    """Recursively check that no forbidden secret fields exist in the bundle."""
    if isinstance(data, dict):
        found = _FORBIDDEN_EXPORT_KEYS & set(data.keys())
        if found:
            raise ValueError(
                f"Bundle contains forbidden secret field(s) at '{path}': {sorted(found)}. "
                "Schema v2 bundles must never contain secret values or ciphertext."
            )
        for key, value in data.items():
            child_path = f"{path}.{key}" if path else key
            _check_no_secret_values(value, child_path)
    elif isinstance(data, list):
        for idx, item in enumerate(data):
            _check_no_secret_values(item, f"{path}[{idx}]")
