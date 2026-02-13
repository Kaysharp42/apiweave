from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Tuple


@dataclass(frozen=True)
class WorkflowIntegrityResult:
    workflow_id: str
    name: str
    node_count: int
    edge_count: int
    default_start_only: bool


def count_nodes_edges(workflow: Dict[str, Any]) -> Tuple[int, int]:
    nodes = workflow.get("nodes") or []
    edges = workflow.get("edges") or []
    return len(nodes), len(edges)


def is_default_start_only_graph(workflow: Dict[str, Any]) -> bool:
    nodes = workflow.get("nodes") or []
    edges = workflow.get("edges") or []

    if len(nodes) != 1 or len(edges) != 0:
        return False

    node = nodes[0] if nodes else {}
    node_id = node.get("nodeId")
    node_type = node.get("type")
    return node_id == "start-1" and node_type == "start"


def summarize_workflows(workflows: Iterable[Dict[str, Any]]) -> List[WorkflowIntegrityResult]:
    results: List[WorkflowIntegrityResult] = []

    for workflow in workflows:
        workflow_id = workflow.get("workflowId") or "<unknown>"
        name = workflow.get("name") or "<unnamed>"
        node_count, edge_count = count_nodes_edges(workflow)
        results.append(
            WorkflowIntegrityResult(
                workflow_id=workflow_id,
                name=name,
                node_count=node_count,
                edge_count=edge_count,
                default_start_only=is_default_start_only_graph(workflow),
            )
        )

    return results
