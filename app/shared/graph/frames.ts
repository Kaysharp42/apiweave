/**
 * Canvas-only nodes, from the runner's point of view: not there.
 *
 * A frame is a persisted node (`type: "group"`) rather than a structure of its
 * own, so it saves, exports and imports with the graph it annotates, and
 * canvas-only nodes have no edges to leave dangling. Every consumer that treats
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
