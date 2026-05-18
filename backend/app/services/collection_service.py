"""
Collection service — shared business logic for collection CRUD and workflow membership.
Called by both FastAPI routes and MCP tools.
"""
from datetime import UTC, datetime
from typing import Any

from app.models import Collection, CollectionCreate, CollectionUpdate
from app.repositories import CollectionRepository, WorkflowRepository
from app.services.exceptions import ConflictError
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
    """Delete a collection. Raises ValueError if not found, ConflictError if has workflows."""
    col = await CollectionRepository.get_by_id(collection_id)
    if not col:
        raise ValueError(f"Collection {collection_id} not found")
    count = await WorkflowRepository.count_by_collection(collection_id)
    if count > 0:
        raise ConflictError(
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
    workflows, _ = await WorkflowRepository.list_by_collection(
        collection_id,
        skip=0,
        limit=1000,
    )
    return workflows


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


async def import_collection(
    bundle: dict[str, Any],
    create_new_collection: bool = True,
    new_collection_name: str | None = None,
    target_collection_id: str | None = None,
    environment_mapping: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Import a collection bundle. Returns collection_id and metadata."""
    if "workflows" not in bundle:
        raise ValueError("Invalid bundle: missing 'workflows' key")

    collection_data = bundle.get("collection", {})
    workflows_data = bundle.get("workflows", [])
    environments_data = bundle.get("environments", [])

    collection_id: str | None = None

    if create_new_collection:
        name = new_collection_name or collection_data.get("name", "Imported Collection")
        description = collection_data.get("description", "")
        color = collection_data.get("color")
        from app.models import CollectionCreate
        created = await create_collection(
            CollectionCreate(name=name, description=description, color=color)
        )
        collection_id = created.collectionId
    elif target_collection_id:
        col = await CollectionRepository.get_by_id(target_collection_id)
        if not col:
            raise ValueError(f"Target collection {target_collection_id} not found")
        collection_id = target_collection_id
    else:
        raise ValueError("Either create_new_collection or target_collection_id must be provided")

    imported_workflows = 0
    imported_environments = 0
    secret_refs: list[str] = []

    for env_data in environments_data:
        env_id = env_data.get("environmentId")
        if environment_mapping and env_id in environment_mapping:
            continue
        from app.models import EnvironmentCreate
        from app.repositories import EnvironmentRepository
        env_create = EnvironmentCreate(
            name=env_data.get("name", "Imported Environment"),
            description=env_data.get("description"),
            swaggerDocUrl=env_data.get("swaggerDocUrl"),
            variables=env_data.get("variables", {}),
            secrets={},
        )
        new_env = await EnvironmentRepository.create(env_create)
        imported_environments += 1
        if env_id and not environment_mapping:
            if environment_mapping is None:
                environment_mapping = {}
            environment_mapping = dict(environment_mapping)
            environment_mapping[env_id] = new_env.environmentId

    for wf_data in workflows_data:
        from app.models import Edge, Node, WorkflowCreate

        nodes = []
        for node in wf_data.get("nodes", []):
            nodes.append(
                Node(
                    nodeId=node.get("nodeId"),
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
                    edgeId=edge.get("edgeId"),
                    source=edge.get("source"),
                    target=edge.get("target"),
                )
            )

        env_id = wf_data.get("environmentId")
        resolved_env_id: str | None = None
        if env_id and environment_mapping and env_id in environment_mapping:
            resolved_env_id = environment_mapping[env_id]

        wf_create = WorkflowCreate(
            name=wf_data.get("name", "Imported Workflow"),
            description=wf_data.get("description"),
            nodes=nodes,
            edges=edges,
            variables=wf_data.get("variables", {}),
            tags=wf_data.get("tags", []),
            collectionId=collection_id,
        )
        created_wf = await WorkflowRepository.create(wf_create)
        if resolved_env_id:
            created_wf.environmentId = resolved_env_id
            from datetime import UTC, datetime
            created_wf.updatedAt = datetime.now(UTC)
            await created_wf.save()

        imported_workflows += 1

    secret_refs = bundle.get("secretReferences", [])

    return {
        "message": "Collection imported successfully",
        "collectionId": collection_id,
        "workflowCount": imported_workflows,
        "environmentCount": imported_environments,
        "secretReferences": secret_refs,
    }


async def import_collection_dry_run(
    bundle: dict[str, Any],
    create_new_collection: bool = True,
    target_collection_id: str | None = None,
) -> dict[str, Any]:
    """Validate a collection bundle without persisting."""
    errors: list[str] = []
    warnings: list[str] = []

    if "workflows" not in bundle:
        errors.append("Missing 'workflows' key in bundle")
        return {"valid": False, "errors": errors, "warnings": warnings}

    workflows_data = bundle.get("workflows", [])
    environments_data = bundle.get("environments", [])

    if create_new_collection:
        collection_data = bundle.get("collection", {})
        if not collection_data.get("name") and not workflows_data:
            warnings.append("No collection name provided; a default name will be used")
    elif target_collection_id:
        col = await CollectionRepository.get_by_id(target_collection_id)
        if not col:
            errors.append(f"Target collection {target_collection_id} not found")
            return {"valid": False, "errors": errors, "warnings": warnings}

    for idx, wf in enumerate(workflows_data):
        if "name" not in wf:
            errors.append(f"Workflow at index {idx} missing 'name'")
        if "nodes" not in wf:
            errors.append(f"Workflow at index {idx} missing 'nodes'")
        else:
            node_ids: set[str] = set()
            for nidx, node in enumerate(wf["nodes"]):
                if "nodeId" not in node:
                    errors.append(f"Workflow {idx}, node at index {nidx} missing 'nodeId'")
                else:
                    if node["nodeId"] in node_ids:
                        errors.append(f"Workflow {idx}, duplicate node ID: {node['nodeId']}")
                    node_ids.add(node["nodeId"])
                if "type" not in node:
                    errors.append(f"Workflow {idx}, node {node.get('nodeId', nidx)} missing 'type'")

        if "edges" in wf and "nodes" in wf:
            node_id_set = {node["nodeId"] for node in wf["nodes"] if "nodeId" in node}
            for eidx, edge in enumerate(wf["edges"]):
                if "source" not in edge or "target" not in edge:
                    errors.append(
                        f"Workflow {idx}, edge at index {eidx} "
                        f"missing 'source' or 'target'"
                    )
                else:
                    if edge["source"] not in node_id_set:
                        errors.append(
                            f"Workflow {idx}, edge references "
                            f"non-existent source: {edge['source']}"
                        )
                    if edge["target"] not in node_id_set:
                        errors.append(
                            f"Workflow {idx}, edge references "
                            f"non-existent target: {edge['target']}"
                        )

    for env_data in environments_data:
        if "name" not in env_data:
            errors.append("Environment missing 'name'")

    secret_refs = bundle.get("secretReferences", [])
    if secret_refs:
        warnings.append(
            f"Collection contains {len(secret_refs)} secret references that must be re-entered"
        )

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "stats": {
            "workflows": len(workflows_data),
            "environments": len(environments_data),
            "secretReferences": len(secret_refs),
        },
    }
