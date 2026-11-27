import { edgeConnectionKey } from "@shared/graph/edgeConnection";

/** What makes two canvas edges the same connection; ids and labels do not count. */
type ConnectionShape = {
  readonly source: string;
  readonly target: string;
  readonly sourceHandle?: string | null | undefined;
  readonly targetHandle?: string | null | undefined;
};

/**
 * Whether the canvas already draws this connection.
 *
 * A graph write refuses two edges that join the same nodes through the same
 * handles (they would run the target twice), so a drag that would add one has
 * to be dropped here instead of at the next save. ReactFlow's `addEdge` already
 * does this for the ordinary path; the assertion branch builds its edge by hand
 * and needs the same check.
 */
export function hasDuplicateConnection(
  edges: readonly ConnectionShape[],
  connection: ConnectionShape,
): boolean {
  const key = edgeConnectionKey(connection);
  return edges.some((edge) => edgeConnectionKey(edge) === key);
}
