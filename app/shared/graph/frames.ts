/**
 * Canvas-only nodes, from the runner's point of view: not there.
 *
 * A frame is a persisted node (`type: "group"`) because that is the only shape
 * the sync path already carries — the server validates node/edge ids and
 * dangling edges, and canvas-only nodes have no edges, so they round-trip
 * through cloud merge without a proto change. Every consumer that treats
 * `nodes` as "the things that run" has to drop them first, or a note shows up
 * as an unreachable node in the validator and a `skipped` row in the run
 * timeline.
 */

export const FRAME_NODE_TYPE = "group"
export const NOTE_NODE_TYPE = "note"

export function isFrameNode(node: { readonly type?: string | undefined }): boolean {
  return node.type === FRAME_NODE_TYPE
}

export function isCanvasOnlyNode(node: { readonly type?: string | undefined }): boolean {
  return node.type === FRAME_NODE_TYPE || node.type === NOTE_NODE_TYPE
}

/** The executable graph: everything but the canvas furniture. */
export function withoutCanvasOnlyNodes<T extends { readonly type?: string | undefined }>(
  nodes: readonly T[],
): T[] {
  return nodes.filter((node) => !isCanvasOnlyNode(node))
}
