interface BaselineGraph {
  nodeCount?: number;
  edgeCount?: number;
}

interface AutosaveWorkflowNode {
  type?: string;
  nodeId?: string;
  id?: string;
}

export function isDefaultStartOnlyGraph(
  nodes: unknown[] | null | undefined,
  edges: unknown[] | null | undefined,
): boolean {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return false;
  if (nodes.length !== 1 || edges.length !== 0) return false;

  const node = (nodes[0] ?? {}) as AutosaveWorkflowNode;
  const nodeId = node.nodeId ?? node.id;

  return node.type === "start" && nodeId === "start-1";
}

export function shouldBlockDestructiveAutosave(
  nodes: unknown[] | null | undefined,
  edges: unknown[] | null | undefined,
  baseline: BaselineGraph | null,
): boolean {
  if (!baseline) return false;

  const baselineNodeCount = Number(baseline.nodeCount ?? 0);
  const baselineEdgeCount = Number(baseline.edgeCount ?? 0);
  const baselineHadLargerGraph = baselineNodeCount > 1 || baselineEdgeCount > 0;

  if (!baselineHadLargerGraph) return false;

  return isDefaultStartOnlyGraph(nodes, edges);
}
