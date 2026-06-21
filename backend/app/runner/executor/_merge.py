"""Mixin: data-producing ancestor lookup for merge nodes in WorkflowExecutor."""


class _MergeMixin:
    """Find the nearest data-producing ancestor node (for merge execution)."""

    def _find_data_producing_ancestor(
        self, node_id: str, edges: list, nodes: dict, visited=None
    ) -> str:
        """
        Recursively find the nearest data-producing ancestor node.

        Skip over delay, assertion, and other non-data-producing nodes.
        Returns the node_id of the nearest data-producing ancestor.
        """
        if visited is None:
            visited = set()

        if node_id in visited:
            return node_id
        visited.add(node_id)

        # Find incoming edges to this node
        incoming = [e for e in edges if e["target"] == node_id]
        if not incoming:
            # No predecessors - this is a root node
            return node_id

        # For a single predecessor, recurse to find its data-producing ancestor
        if len(incoming) == 1:
            pred_id = incoming[0]["source"]
            pred_node = nodes.get(pred_id, {})
            node_type = pred_node.get("type", "")

            # If predecessor is a data-producing node, return it
            if node_type in ("http-request",):
                return pred_id

            # Otherwise, recurse to find its data-producing ancestor
            return self._find_data_producing_ancestor(pred_id, edges, nodes, visited)

        # For multiple predecessors (merge scenario), return the node itself
        # (merge should be handled separately)
        return node_id
