export function isDefaultStartOnlyGraph(nodes = [], edges = []) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return false;
  if (nodes.length !== 1 || edges.length !== 0) return false;

  const node = nodes[0] || {};
  const nodeId = node.nodeId || node.id;

  return node.type === 'start' && nodeId === 'start-1';
}

export function shouldBlockDestructiveAutosave(nodes = [], edges = [], baseline = null) {
  if (!baseline) return false;

  const baselineNodeCount = Number(baseline.nodeCount || 0);
  const baselineEdgeCount = Number(baseline.edgeCount || 0);
  const baselineHadLargerGraph = baselineNodeCount > 1 || baselineEdgeCount > 0;

  if (!baselineHadLargerGraph) return false;

  return isDefaultStartOnlyGraph(nodes, edges);
}
