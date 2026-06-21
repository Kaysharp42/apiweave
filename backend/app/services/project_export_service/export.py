"""Export a project as a schema v2 .awecollection bundle."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.services.exceptions import ResourceNotFoundError
from app.services.secret_utils import is_secret_key

from .constants import SCHEMA_VERSION
from .secrets import (
    _extract_secret_refs_from_string,
    _sanitize_export_value,
)


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

    from . import (
        ProjectRepository,
        ScopedEnvironmentRepository,
        WorkflowRepository,
        WorkspaceRepository,
    )

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
        workspace_id,
        project_id,
        skip=0,
        limit=10000,
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
            sanitized_vars,
            raw_vars,
            "workspace",
            workspace_id,
            secret_references,
            seen_secret_refs,
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
                    config,
                    "workspace",
                    workspace_id,
                    secret_references,
                    seen_secret_refs,
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
                    secret_references.append(
                        {
                            "name": key,
                            "scopeType": env_export.get("scopeType", "workspace"),
                            "scopeId": env_export.get("scopeId", workspace_id),
                        }
                    )
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
                    secret_references.append(
                        {
                            "name": name,
                            "scopeType": scope_type,
                            "scopeId": scope_id,
                        }
                    )
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
                    secret_references.append(
                        {
                            "name": name,
                            "scopeType": scope_type,
                            "scopeId": scope_id,
                        }
                    )
        elif isinstance(value, dict):
            _collect_refs_from_config(value, scope_type, scope_id, secret_references, seen)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    for name in _extract_secret_refs_from_string(item):
                        ref_key = (name, scope_type, scope_id)
                        if ref_key not in seen:
                            seen.add(ref_key)
                            secret_references.append(
                                {
                                    "name": name,
                                    "scopeType": scope_type,
                                    "scopeId": scope_id,
                                }
                            )
                elif isinstance(item, dict):
                    _collect_refs_from_config(item, scope_type, scope_id, secret_references, seen)
