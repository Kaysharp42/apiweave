/**
 * What makes two edges the same connection: the two endpoints and the ports the
 * edge leaves and arrives at. `edgeId`, `label` and any other field are
 * identity and display, never routing.
 *
 * Two edges with the same connection are one branch drawn twice, and the
 * runner follows both — concurrently, so the target node runs once per
 * duplicate. The write path refuses one, and the analyzer reports a graph that
 * already holds one.
 */
type Connection = {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null | undefined
  readonly targetHandle?: string | null | undefined
}

/**
 * An unnamed port is spelled `undefined`, `null` or `""` depending on who wrote
 * the edge (a patch, the canvas, the analyzer); all three mean the node's
 * single output/input, so they compare equal here.
 */
function port(handle: string | null | undefined): string | null {
  return handle === undefined || handle === "" ? null : handle
}

/** A key that is equal for two edges exactly when they are the same connection. */
export function edgeConnectionKey(edge: Connection): string {
  return JSON.stringify([edge.source, port(edge.sourceHandle), edge.target, port(edge.targetHandle)])
}

/**
 * Each edge of `edges` that repeats an earlier edge's connection, as
 * `[first, duplicate]`: `first` is the earliest edge drawn for that connection,
 * which is never itself reported.
 */
export function duplicateConnections<E extends Connection>(edges: readonly E[]): Array<readonly [E, E]> {
  const byConnection = new Map<string, E>()
  const duplicates: Array<readonly [E, E]> = []
  for (const edge of edges) {
    const key = edgeConnectionKey(edge)
    const first = byConnection.get(key)
    if (first === undefined) byConnection.set(key, edge)
    else duplicates.push([first, edge])
  }
  return duplicates
}
