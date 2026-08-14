/**
 * Edges grouped by one endpoint.
 *
 * Both the choreography (which waits on a node's predecessors) and the fronts
 * (which also walk successors) need the same one-pass grouping over the same
 * edge list, so it lives here rather than being written out twice.
 */
export function groupEdgesBy(
  edges: readonly { source: string; target: string }[],
  key: "source" | "target",
): Map<string, string[]> {
  const other = key === "source" ? "target" : "source";
  const grouped = new Map<string, string[]>();

  for (const edge of edges) {
    const existing = grouped.get(edge[key]);
    if (existing) existing.push(edge[other]);
    else grouped.set(edge[key], [edge[other]]);
  }

  return grouped;
}
