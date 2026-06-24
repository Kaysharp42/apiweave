"""
Workflow service — shared business logic for workflow CRUD, export, import, and dry-run.
Called by both FastAPI routes and MCP tools.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from app.models import (
    EnvironmentCreate,
    PaginatedWorkflows,
    Workflow,
    WorkflowCreate,
    WorkflowUpdate,
)
from app.repositories import EnvironmentRepository, WorkflowRepository, WorkspaceRepository
from app.services.secret_utils import (
    sanitize_secrets_in_dict,
    serialize_document_for_export,
)

logger = logging.getLogger(__name__)


async def list_workflows(
    skip: int = 0,
    limit: int = 20,
    tag: str | None = None,
    name: str | None = None,
) -> PaginatedWorkflows:
    """List workflows with pagination and optional tag/name filters."""
    workflows, total = await WorkflowRepository.list_all(skip, limit, tag, name)
    has_more = (skip + len(workflows)) < total
    return PaginatedWorkflows(
        workflows=workflows,
        total=total,
        skip=skip,
        limit=limit,
        hasMore=has_more,
    )


async def list_unattached_workflows(
    skip: int = 0,
    limit: int = 20,
) -> PaginatedWorkflows:
    """List workflows not attached to any collection."""
    workflows, total = await WorkflowRepository.list_unattached(skip, limit)
    has_more = (skip + len(workflows)) < total
    return PaginatedWorkflows(
        workflows=workflows,
        total=total,
        skip=skip,
        limit=limit,
        hasMore=has_more,
    )


async def get_workflow(workflow_id: str) -> Workflow:
    """Get a workflow by ID. Raises ValueError if not found."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")
    return workflow


async def create_workflow(workflow: WorkflowCreate) -> Workflow:
    """Create a new workflow."""
    return await WorkflowRepository.create(workflow)


async def update_workflow(workflow_id: str, update: WorkflowUpdate) -> Workflow:
    """Update a workflow. Raises ValueError if not found."""
    updated = await WorkflowRepository.update(workflow_id, update)
    if not updated:
        raise ValueError(f"Workflow {workflow_id} not found")
    return updated


async def delete_workflow(workflow_id: str) -> None:
    """Delete a workflow. Raises ValueError if not found."""
    deleted = await WorkflowRepository.delete(workflow_id)
    if not deleted:
        raise ValueError(f"Workflow {workflow_id} not found")


async def attach_to_collection(workflow_id: str, collection_id: str | None) -> Workflow:
    """Attach or detach a workflow to/from a collection."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")
    if collection_id:
        from app.repositories import CollectionRepository

        collection = await CollectionRepository.get_by_id(collection_id)
        if not collection:
            raise ValueError(f"Collection {collection_id} not found")
    return await WorkflowRepository.update_collection_assignment(workflow_id, collection_id)


async def list_by_collection(collection_id: str) -> list[Workflow]:
    """List workflows in a collection."""
    from app.repositories import CollectionRepository

    collection = await CollectionRepository.get_by_id(collection_id)
    if not collection:
        raise ValueError(f"Collection {collection_id} not found")
    workflows, _ = await WorkflowRepository.list_by_collection(collection_id, skip=0, limit=1000)
    return workflows


async def set_environment(workflow_id: str, environment_id: str | None) -> Workflow:
    """Set or clear the default environment for a workflow."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")
    if environment_id:
        env = await EnvironmentRepository.get_by_id(environment_id)
        if not env:
            raise ValueError(f"Environment {environment_id} not found")
    workflow.environmentId = environment_id
    from datetime import UTC, datetime

    workflow.updatedAt = datetime.now(UTC)
    await workflow.save()
    return workflow


async def export_workflow(
    workflow_id: str,
    include_environment: bool = True,
    app_version: str = "0.1.0",
) -> dict[str, Any]:
    """Export a complete workflow bundle with secrets sanitized."""
    workflow_doc = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow_doc:
        raise ValueError(f"Workflow {workflow_id} not found")

    workflow = serialize_document_for_export(workflow_doc)

    # Convert datetime objects to ISO strings
    if workflow.get("createdAt"):
        workflow["createdAt"] = workflow["createdAt"].isoformat()
    if workflow.get("updatedAt"):
        workflow["updatedAt"] = workflow["updatedAt"].isoformat()

    secret_refs: list[str] = []

    # Sanitize secrets in workflow variables
    if workflow.get("variables"):
        workflow["variables"] = sanitize_secrets_in_dict(
            workflow["variables"], secret_refs, "variables"
        )

    # Sanitize secrets in node configs
    for node in workflow.get("nodes", []):
        if node.get("config"):
            node["config"] = sanitize_secrets_in_dict(
                node["config"],
                secret_refs,
                f"nodes.{node['nodeId']}.config",
            )

    export_bundle: dict[str, Any] = {
        "workflow": workflow,
        "environments": [],
        "secretReferences": secret_refs,
        "metadata": {
            "exportedAt": datetime.now(UTC).isoformat(),
            "apiweaveVersion": app_version,
            "sourceHost": None,
        },
    }

    # Include environment if requested
    if include_environment and workflow.get("environmentId"):
        env_id = workflow["environmentId"]
        env_doc = await EnvironmentRepository.get_by_id(env_id)
        if env_doc:
            environment = serialize_document_for_export(env_doc)
            # Remove persisted secrets entirely from exported environment
            environment.pop("secrets", None)
            if environment.get("createdAt"):
                environment["createdAt"] = environment["createdAt"].isoformat()
            if environment.get("updatedAt"):
                environment["updatedAt"] = environment["updatedAt"].isoformat()
            if environment.get("variables"):
                environment["variables"] = sanitize_secrets_in_dict(
                    environment["variables"],
                    secret_refs,
                    f"environments.{env_id}.variables",
                )
            export_bundle["environments"].append(environment)

    return export_bundle


async def import_workflow(
    bundle: dict[str, Any],
    environment_mapping: dict[str, str] | None = None,
    create_missing_environments: bool = True,
    sanitize: bool = False,
    workspace_id: str | None = None,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    """Import a workflow bundle. Returns workflowId and metadata.

    When ``workspace_id`` is provided, the workflow is created via
    :meth:`WorkflowRepository.create_scoped` so it is visible to all
    workspace-scoped lookups (``workflow_get``, ``workflow_list``,
    ``workflow_run``, ``workflow_set_environment``). Without ``workspace_id``
    the import falls back to the legacy unscoped create (used by FastAPI
    routes that pass their own scope resolution).
    """
    if "workflow" not in bundle:
        raise ValueError("Invalid bundle: missing 'workflow' key")

    workflow_data = bundle["workflow"]
    environments = bundle.get("environments", [])

    for field in ("name", "nodes", "edges"):
        if field not in workflow_data:
            raise ValueError(f"Invalid workflow: missing '{field}' field")

    old_env_id = workflow_data.get("environmentId")
    new_env_id: str | None = None

    if old_env_id:
        if environment_mapping and old_env_id in environment_mapping:
            new_env_id = environment_mapping[old_env_id]
            existing_env = await EnvironmentRepository.get_by_id(new_env_id)
            if not existing_env:
                raise ValueError(f"Mapped environment {new_env_id} not found")
        elif create_missing_environments and environments:
            env_data = next((e for e in environments if e.get("environmentId") == old_env_id), None)
            if env_data:
                env_create = EnvironmentCreate(
                    name=env_data.get("name", "Imported Environment"),
                    description=env_data.get("description"),
                    swaggerDocUrl=env_data.get("swaggerDocUrl"),
                    variables=env_data.get("variables", {}),
                    secrets={},
                )
                new_env = await EnvironmentRepository.create(env_create)
                new_env_id = new_env.environmentId

    logger.warning(
        "import_workflow: sanitize=%r type=%s workflow_id_param=%r",
        sanitize, type(sanitize).__name__, workspace_id,
    )
    if sanitize:
        if workflow_data.get("variables"):
            refs: list[str] = []
            workflow_data["variables"] = sanitize_secrets_in_dict(workflow_data["variables"], refs)
        for node in workflow_data.get("nodes", []):
            if node.get("config"):
                refs = []
                node["config"] = sanitize_secrets_in_dict(node["config"], refs)

    workflow_create = WorkflowCreate(
        name=workflow_data["name"],
        description=workflow_data.get("description"),
        nodes=workflow_data["nodes"],
        edges=workflow_data["edges"],
        variables=workflow_data.get("variables", {}),
        tags=workflow_data.get("tags", []),
        collectionId=None,
        nodeTemplates=workflow_data.get("nodeTemplates", []),
    )

    if workspace_id:
        ws = await WorkspaceRepository.get_by_id(workspace_id)
        if not ws:
            raise ValueError(f"Workspace {workspace_id} not found")
        created = await WorkflowRepository.create_scoped(
            workflow_data=workflow_create,
            workspace_id=workspace_id,
            org_id=ws.orgId,
            owner_type=ws.ownerType,
        )
    else:
        created = await WorkflowRepository.create(workflow_create)

    if new_env_id:
        created.environmentId = new_env_id
        created.updatedAt = datetime.now(UTC)
        await created.save()

    return {
        "message": "Workflow imported successfully",
        "workflowId": created.workflowId,
        "environmentId": new_env_id,
        "secretReferences": bundle.get("secretReferences", []),
        "actorUserId": actor_user_id,
    }


async def import_workflow_dry_run(
    bundle: dict[str, Any],
) -> dict[str, Any]:
    """Validate a workflow bundle without persisting."""
    errors: list[str] = []
    warnings: list[str] = []

    if "workflow" not in bundle:
        errors.append("Missing 'workflow' key in bundle")
        return {"valid": False, "errors": errors, "warnings": warnings}

    workflow_data = bundle["workflow"]

    for field in ("name", "nodes", "edges"):
        if field not in workflow_data:
            errors.append(f"Missing required field: '{field}'")

    if "nodes" in workflow_data:
        node_ids: set = set()
        for idx, node in enumerate(workflow_data["nodes"]):
            if "nodeId" not in node:
                errors.append(f"Node at index {idx} missing 'nodeId'")
            else:
                if node["nodeId"] in node_ids:
                    errors.append(f"Duplicate node ID: {node['nodeId']}")
                node_ids.add(node["nodeId"])
            if "type" not in node:
                errors.append(f"Node {node.get('nodeId', idx)} missing 'type'")

    if "edges" in workflow_data and "nodes" in workflow_data:
        node_id_set = {node["nodeId"] for node in workflow_data["nodes"]}
        for idx, edge in enumerate(workflow_data["edges"]):
            if "source" not in edge or "target" not in edge:
                errors.append(f"Edge at index {idx} missing 'source' or 'target'")
            else:
                if edge["source"] not in node_id_set:
                    errors.append(f"Edge references non-existent source node: {edge['source']}")
                if edge["target"] not in node_id_set:
                    errors.append(f"Edge references non-existent target node: {edge['target']}")

    old_env_id = workflow_data.get("environmentId")
    if old_env_id:
        env_exists = await EnvironmentRepository.get_by_id(old_env_id)
        if not env_exists:
            env_in_bundle = any(
                e.get("environmentId") == old_env_id for e in bundle.get("environments", [])
            )
            if env_in_bundle:
                warnings.append(f"Environment {old_env_id} will be created from bundle")
            else:
                warnings.append(f"Environment {old_env_id} not found - workflow will be unattached")

    secret_refs = bundle.get("secretReferences", [])
    if secret_refs:
        warnings.append(
            f"Workflow contains {len(secret_refs)} secret references that must be re-entered"
        )

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "nodes": len(workflow_data.get("nodes", [])),
            "edges": len(workflow_data.get("edges", [])),
            "variables": len(workflow_data.get("variables", {})),
            "secretReferences": len(secret_refs),
            "environmentsIncluded": len(bundle.get("environments", [])),
        },
    }
