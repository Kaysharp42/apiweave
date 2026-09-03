import { FRAME_NODE_TYPE, isFrameNode } from "@shared/graph/frames";
import {
  NODE_FALLBACK_HEIGHT,
  NODE_FALLBACK_WIDTH,
} from "@shared/layout/dagreLayout";
import type { CanvasNode } from "../types/CanvasNode";

export { FRAME_NODE_TYPE, isFrameNode };

/** Breathing room between the selection's bounding box and the frame edge. */
export const GROUP_PAD = 28;

/** A frame with no size yet — a paste, or a hand-written workflow JSON. */
export const FRAME_FALLBACK_WIDTH = 320;
export const FRAME_FALLBACK_HEIGHT = 220;

export type GroupOutcome =
  | { readonly ok: true; readonly nodes: CanvasNode[]; readonly frameId: string }
  | { readonly ok: false; readonly reason: string };

function nodeSize(node: CanvasNode): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? NODE_FALLBACK_WIDTH,
    height: node.measured?.height ?? node.height ?? NODE_FALLBACK_HEIGHT,
  };
}

/**
 * React Flow requires a parent to precede its children in the array, and
 * paints in array order — so frames first is both the contract and the reason
 * a frame sits *behind* what it holds.
 */
export function sortFramesFirst(nodes: readonly CanvasNode[]): CanvasNode[] {
  const frames = nodes.filter(isFrameNode);
  return frames.length === 0
    ? [...nodes]
    : [...frames, ...nodes.filter((node) => !isFrameNode(node))];
}

/** Where a node actually is on the canvas, frame-relative or not. */
export function absoluteNodePosition(
  node: CanvasNode,
  nodesById: ReadonlyMap<string, CanvasNode>,
): { x: number; y: number } {
  const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  if (!parent) return node.position;
  return {
    x: parent.position.x + node.position.x,
    y: parent.position.y + node.position.y,
  };
}

/**
 * A copy with the frame relationship removed, at the given position.
 *
 * `delete` on a copy rather than rest-destructuring: this repo's lint has no
 * rest-sibling exemption, and the two read the same.
 */
function freedFromFrame(
  node: CanvasNode,
  position: { x: number; y: number },
): CanvasNode {
  const freed: CanvasNode = { ...node, position };
  delete freed.parentId;
  delete freed.extent;
  return freed;
}

export function nodesById(
  nodes: readonly CanvasNode[],
): Map<string, CanvasNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * Draw a frame around the selection.
 *
 * Grouping is explicit, not hit-tested: the frame is the selection's bounding
 * box plus padding, so there is no intersection math and no drop detection to
 * get wrong. Children become frame-relative and gain `extent: "parent"`, which
 * is what makes React Flow move them with the frame — this app owns no drag
 * handler for that.
 *
 * ponytail: flat frames only. A selection that already sits in a frame, or one
 * that contains a frame, is refused rather than nested. Nesting needs an
 * ancestor-chain fit and a container origin, which is about half the logic of
 * the feature and none of the value on a first pass.
 */
export function groupSelection(
  nodes: readonly CanvasNode[],
  selectedIds: ReadonlySet<string>,
  options: { readonly frameId: string; readonly gridSize?: number },
): GroupOutcome {
  const members = nodes.filter((node) => selectedIds.has(node.id));
  if (members.length === 0) {
    return { ok: false, reason: "Select the nodes you want to frame first" };
  }
  if (members.some(isFrameNode)) {
    return { ok: false, reason: "A frame can't hold another frame yet" };
  }
  if (members.some((node) => node.parentId !== undefined)) {
    return { ok: false, reason: "Those nodes are already in a frame" };
  }

  const pad = Math.max(GROUP_PAD, options.gridSize ?? 0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of members) {
    const { width, height } = nodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  }

  const frame: CanvasNode = {
    id: options.frameId,
    type: FRAME_NODE_TYPE,
    position: { x: minX - pad, y: minY - pad },
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
    data: { label: "Group", config: {} },
    selectable: true,
    // The pill is the only grab handle; see `GroupNode`. Without this the
    // whole frame is draggable and a drag inside it moves the frame instead of
    // starting a box-selection.
    dragHandle: ".aw-group-handle",
  };

  const framed = nodes.map((node) =>
    selectedIds.has(node.id)
      ? {
          ...node,
          parentId: frame.id,
          extent: "parent" as const,
          position: {
            x: node.position.x - frame.position.x,
            y: node.position.y - frame.position.y,
          },
        }
      : node,
  );

  return { ok: true, nodes: sortFramesFirst([frame, ...framed]), frameId: frame.id };
}

/**
 * Remove frames and set their children free, keeping every child exactly where
 * it appears on screen.
 *
 * Also the pre-step for *deleting* a frame: freeing the children first is what
 * stops React Flow taking the frame's contents down with it (its own delete
 * pass adds every child of a deleted parent — see `getElementsToRemove`).
 */
export function ungroupFrames(
  nodes: readonly CanvasNode[],
  frameIds: ReadonlySet<string>,
): CanvasNode[] {
  const byId = nodesById(nodes);
  const freed = nodes
    .filter((node) => !frameIds.has(node.id))
    .map((node) => {
      if (node.parentId === undefined || !frameIds.has(node.parentId)) {
        return node;
      }
      return freedFromFrame(node, absoluteNodePosition(node, byId));
    });
  return sortFramesFirst(freed);
}

/**
 * Drop `parentId` values that point at nothing, at load time.
 *
 * Auto-merge diffs by node id, so deleting a frame on one device while another
 * moves a child inside it yields a child whose parent is gone. Its position is
 * frame-relative, and React Flow errors on an unresolvable parent — so the
 * field goes and the relative position becomes an absolute one. The node lands
 * near the origin, which is visible and fixable; the alternative is a canvas
 * that refuses to render.
 */
export function reconcileFrames(nodes: readonly CanvasNode[]): CanvasNode[] {
  const byId = nodesById(nodes);
  const reconciled = nodes.map((node) => {
    if (node.parentId === undefined) return node;
    const parent = byId.get(node.parentId);
    if (parent !== undefined && isFrameNode(parent)) return node;
    return freedFromFrame(node, node.position);
  });
  return sortFramesFirst(reconciled);
}

/** The ids ReactFlow currently has selected. */
export function selectedIds(nodes: readonly CanvasNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) if (node.selected === true) ids.add(node.id);
  return ids;
}

/** Frames in the current selection — what Ctrl+Shift+G acts on. */
export function selectedFrameIds(
  nodes: readonly CanvasNode[],
  selectedIds: ReadonlySet<string>,
): Set<string> {
  const frames = new Set<string>();
  for (const node of nodes) {
    if (isFrameNode(node) && selectedIds.has(node.id)) frames.add(node.id);
    // A member of a frame stands in for it: selecting nodes and pressing
    // ungroup is the same intent as selecting the frame itself.
    if (node.parentId !== undefined && selectedIds.has(node.id)) {
      frames.add(node.parentId);
    }
  }
  return frames;
}

/**
 * The graph as everything that measures distance expects it: no frames, every
 * position absolute.
 *
 * The run camera and the directional focus both read `node.position` as a
 * canvas coordinate, which stops being true the moment a node has a parent.
 * Rather than teach each of them about frames, they are handed this view.
 */
export function withAbsolutePositions(
  nodes: readonly CanvasNode[],
): CanvasNode[] {
  // The overwhelmingly common case is a canvas with no frames at all, and this
  // runs on every drag frame — hand back the same array rather than a copy.
  if (!nodes.some((node) => node.parentId !== undefined || isFrameNode(node))) {
    return nodes as CanvasNode[];
  }
  const byId = nodesById(nodes);
  return nodes
    .filter((node) => !isFrameNode(node))
    .map((node) =>
      node.parentId === undefined
        ? node
        : { ...node, position: absoluteNodePosition(node, byId) },
    );
}
