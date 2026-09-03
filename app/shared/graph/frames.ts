/**
 * Group frames, from the runner's point of view: not there.
 *
 * A frame is a persisted node (`type: "group"`) because that is the only shape
 * the sync path already carries — the server validates node/edge ids and
 * dangling edges, and a frame has no edges, so it round-trips through cloud
 * merge without a proto change. The cost of that choice is this module: every
 * consumer that treats `nodes` as "the things that run" has to drop frames
 * first, or a frame shows up as an unreachable node in the validator and a
 * `skipped` row in the run timeline.
 */

export const FRAME_NODE_TYPE = "group"

export function isFrameNode(node: { readonly type?: string | undefined }): boolean {
  return node.type === FRAME_NODE_TYPE
}

/** The executable graph: everything but the furniture. */
export function withoutFrameNodes<T extends { readonly type?: string | undefined }>(
  nodes: readonly T[],
): T[] {
  return nodes.filter((node) => !isFrameNode(node))
}
