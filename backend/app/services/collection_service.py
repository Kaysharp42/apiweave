"""
Collection service — shared business logic for collection CRUD and workflow membership.
Called by both FastAPI routes and MCP tools.
"""
from datetime import UTC, datetime
from typing import Any

from app.models import Collection, CollectionCreate, CollectionUpdate
from app.repositories import CollectionRepository, WorkflowRepository
from app.services.secret_utils import sanitize_secrets_in_dict


async def list_collections() -> list[Collection]:
    """List all collections with workflow counts."""
    collections_list, _ = await CollectionRepository.list_all(skip=0, limit=1000)
    for col in collections_list:
        count = await WorkflowRepository.count_by_collection(col.collectionId)
        col.workflowCount = count
    return collections_list


async def get_collection(collection_id: str) -> Collection:
    """Get a collection by ID. Raises ValueError if not found."""
    col = await CollectionRepository.get_by_id(collection_id)
    if not col:
        raise ValueError(f"Collection {collection_id} not found")
    count = await WorkflowRepository.count_by_collection(collection_id)
    col.workflowCount = count
    return col


async def create_collection(data: CollectionCreate) -> Collection:
    """Create a new collection."""
    return await CollectionRepository.create(data)


async def update_collection(
    collection_id: str, data: CollectionUpdate
) -> Collection:
    """Update a collection. Raises ValueError if not found."""
    updated = await CollectionRepository.update(collection_id, data)
    if not updated:
        raise ValueError(f"Collection {collection_id} not found")
    count = await WorkflowRepository.count_by_collection(collection_id)
    updated.workflowCount = count
    return updated


async def delete_collection(collection_id: str) -> None:
    """Delete a collection. Raises ValueError if not found or has workflows."""
    col = await CollectionRepository.get_by_id(collection_id)
    if not col:
        raise ValueError(f"Collection {collection_id} not found")
    count = await WorkflowRepository.count_by_collection(collection_id)
    if count > 0:
        raise ValueError(
            f"Cannot delete collection. {count} workflow(s) are still in it."
        )
    await CollectionRepository.delete(collection_id)


async def add_workflow_to_collection(
    collection_id: str, workflow_id: str
) -> Any:
    """Add a workflow to a collection. Raises ValueError if either not found."""
    col = await CollectionRepository.get_by_id(collection_id)
    if not col:
        raise ValueError(f"Collection {collection_id} not found")
    updated = await WorkflowRepository.update_collection_assignment(
        workflow_id, collection_id
    )
    if not updated:
        raise ValueError(f"Workflow {workflow_id} not found")
    return updated


async def remove_workflow_from_collection(
    collection_id: str, workflow_id: str
) -> Any:
    """Remove a workflow from a collection. Raises ValueError if not in collection."""
    workflow = await WorkflowRepository.get_by_id(workflow_id)
    if not workflow:
        raise ValueError(f"Workflow {workflow_id} not found")
    if workflow.collectionId != collection_id:
        raise ValueError(f"Workflow is not in collection {collection_id}")
    return await WorkflowRepository.update_collection_assignment(workflow_id, None)


async def list_collection_workflows(collection_id: str) -> list[Any]:
    """List workflows in a collection. Raises ValueError if collection not found."""
    col = await CollectionRepository.get_by_id(collection_id)
    if not col:
        raise ValueError(f"Collection {collection_id} not found")
    return await WorkflowRepository.list_by_collection(collection_id)


async def export_collection(
    collection_id: str, include_environment: bool = True
) -> dict[str, Any]:
    """Export a collection with all workflows and environments (secrets sanitized)."""
    col = await CollectionRepository.get_by_id(collection_id)
    if not col:
        raise ValueError(f"Collection {collection_id} not found")

    workflows_list, _ = await WorkflowRepository.list_by_collection(
        collection_id, skip=0, limit=1000
    )

    environment_ids = {
        wf.environmentId for wf in workflows_list if wf.environmentId
    }

    environments_list: list[dict[str, Any]] = []
    if include_environment and environment_ids:
        from app.repositories import EnvironmentRepository

        for env_id in environment_ids:
            env = await EnvironmentRepository.get_by_id(env_id)
            if env:
                secret_refs: list[str] = []
                sanitized_vars = sanitize_secrets_in_dict(
                    env.variables if env.variables else {},
                    secret_refs,
                    f"environments.{env_id}.variables",
                )
                env_dict = env.model_dump(by_alias=True)
                env_dict["variables"] = sanitized_vars
                environments_list.append(env_dict)

    secret_refs: list[str] = []
    sanitized_workflows: list[dict[str, Any]] = []

    for wf in workflows_list:
        wf_secret_refs: list[str] = []
        wf_dict = wf.model_dump(by_alias=True)

        sanitized_vars = sanitize_secrets_in_dict(
            wf_dict.get("variables", {}),
            wf_secret_refs,
            "workflows.variables",
        )

        sanitized_nodes = []
        for node in wf_dict.get("nodes", []):
            node_copy = dict(node)
            if "config" in node_copy and isinstance(node_copy["config"], dict):
                node_secret_refs: list[str] = []
                sanitized_config = sanitize_secrets_in_dict(
                    node_copy["config"],
                    node_secret_refs,
                    f"nodes.{node.get('nodeId', 'unknown')}.config",
                )
                for ref in node_secret_refs:
                    wf_secret_refs.append(f"workflows.nodes.{ref}")
                node_copy["config"] = sanitized_config
            sanitized_nodes.append(node_copy)

        sanitized_workflows.append(
            {
                "workflowId": wf_dict.get("workflowId"),
                "name": wf_dict.get("name"),
                "description": wf_dict.get("description", ""),
                "nodes": sanitized_nodes,
                "edges": wf_dict.get("edges", []),
                "variables": sanitized_vars,
                "tags": wf_dict.get("tags", []),
                "environmentId": wf_dict.get("environmentId"),
            }
        )
        secret_refs.extend(wf_secret_refs)

    collection_dict = col.model_dump(by_alias=True)

    return {
        "type": "awecollection",
        "version": "1.0",
        "collection": {
            "name": collection_dict.get("name"),
            "description": collection_dict.get("description", ""),
            "color": collection_dict.get("color", "#3B82F6"),
        },
        "workflows": sanitized_workflows,
        "environments": [
            {
                "environmentId": env.get("environmentId"),
                "name": env.get("name"),
                "variables": env.get("variables", {}),
                "swaggerDocUrl": env.get("swaggerDocUrl"),
            }
            for env in environments_list
        ],
        "secretReferences": secret_refs,
        "metadata": {
            "exportedAt": datetime.now(UTC).isoformat(),
            "apiweaveVersion": "0.1.0",
            "workflowCount": len(sanitized_workflows),
            "environmentCount": len(environments_list),
        },
    }
