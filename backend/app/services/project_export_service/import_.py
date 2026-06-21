"""Import a schema v2 .awecollection bundle into a target workspace."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.services.exceptions import ResourceNotFoundError

from .constants import SCHEMA_VERSION
from .validation import _validate_bundle_structure

logger = logging.getLogger(__name__)


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

    from . import (
        ProjectRepository,
        ScopedEnvironmentRepository,
        WorkflowRepository,
        WorkspaceRepository,
    )

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
            nodes.append(
                Node(
                    nodeId=node.get("nodeId", str(uuid.uuid4())),
                    type=node.get("type", "http-request"),
                    label=node.get("label", ""),
                    position=node.get("position", {"x": 0, "y": 0}),
                    config=node.get("config", {}),
                )
            )

        edges = []
        for edge in wf_data.get("edges", []):
            edges.append(
                Edge(
                    edgeId=edge.get("edgeId", str(uuid.uuid4())),
                    source=edge.get("source", ""),
                    target=edge.get("target", ""),
                    sourceHandle=edge.get("sourceHandle"),
                    targetHandle=edge.get("targetHandle"),
                    label=edge.get("label"),
                )
            )

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
    from . import SecretRepository

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

    from . import WorkspaceRepository

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
            warnings.append(f"Secret '{secret_name}' not found in target workspace")

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
