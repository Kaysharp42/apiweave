import type { CanvasClipboard } from "../types/CanvasClipboard";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";
import {
  absoluteNodePosition,
  freedFromFrame,
  nodesById,
  sortFramesFirst,
} from "./canvasGroups";

/** How far a paste lands from what was copied, so the copy is visible. */
export const PASTE_OFFSET = 40;

/**
 * What copying `ids` puts on the clipboard: those nodes, every child of a
 * copied frame, and each edge whose two ends are both copied. A child copied
 * without its frame leaves the frame, at its position on the canvas. The
 * result is a deep, JSON-safe copy.
 */
export function copyNodes(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  ids: ReadonlySet<string>,
): CanvasClipboard {
  const byId = nodesById(nodes);
  const copied = nodes.filter(
    (node) =>
      ids.has(node.id) ||
      (node.parentId !== undefined && ids.has(node.parentId)),
  );
  const copiedIds = new Set(copied.map((node) => node.id));
  const clipboard: CanvasClipboard = {
    nodes: copied.map((node) =>
      node.parentId !== undefined && !copiedIds.has(node.parentId)
        ? freedFromFrame(node, absoluteNodePosition(node, byId))
        : node,
    ),
    edges: edges.filter(
      (edge) => copiedIds.has(edge.source) && copiedIds.has(edge.target),
    ),
  };
  return JSON.parse(JSON.stringify(clipboard)) as CanvasClipboard;
}

/**
 * The clipboard as new nodes and edges to add: fresh ids, frame children
 * re-parented to the pasted frame, edges reconnected to the pasted nodes, and
 * top-level nodes moved by `PASTE_OFFSET`. Pasted nodes come back selected.
 *
 * ponytail: every paste of one clipboard lands at the same offset, so a second
 * paste covers the first; offset by paste count if that gets in the way.
 */
export function pasteNodes(
  clipboard: CanvasClipboard,
  stamp: number,
): CanvasClipboard {
  const newIds = new Map(
    clipboard.nodes.map((node, index) => [
      node.id,
      `${node.type ?? "node"}-${stamp}-${index}`,
    ]),
  );
  const renamed = (id: string): string => newIds.get(id) ?? id;

  const nodes = clipboard.nodes.map((node): CanvasNode => {
    const pasted: CanvasNode = {
      ...node,
      id: renamed(node.id),
      selected: true,
      dragging: false,
    };
    if (node.parentId !== undefined) {
      pasted.parentId = renamed(node.parentId);
    } else {
      pasted.position = {
        x: node.position.x + PASTE_OFFSET,
        y: node.position.y + PASTE_OFFSET,
      };
    }
    return pasted;
  });
  const edges = clipboard.edges.map(
    (edge, index): CanvasEdge => ({
      ...edge,
      id: `edge-${stamp}-${index}`,
      source: renamed(edge.source),
      target: renamed(edge.target),
      selected: false,
    }),
  );
  return { nodes: sortFramesFirst(nodes), edges };
}
