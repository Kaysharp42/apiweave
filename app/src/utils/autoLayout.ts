import type { Node, Edge } from "@xyflow/react";
import { dagreLayoutPositions, NODE_FALLBACK_WIDTH, NODE_FALLBACK_HEIGHT } from "@shared/layout/dagreLayout";
import { FRAME_MIN_HEIGHT, FRAME_MIN_WIDTH, GROUP_PAD } from "./canvasGroups";

export { NODE_FALLBACK_WIDTH, NODE_FALLBACK_HEIGHT };

/**
 * Repositions nodes into a clean layered layout based on their edge connections.
 * `LR` = left-to-right (default, best for request chains); `TB` = top-to-bottom.
 * Measured node sizes are used when available so spacing fits real node footprints.
 *
 * Measured size lives on `node.measured` since React Flow v12; `node.width` is
 * now only what the caller set explicitly, and is undefined for every node the
 * app creates. Reading it alone would lay the whole graph out at
 * NODE_FALLBACK_WIDTH and overlap every real node.
 */
export function autoLayout<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  direction: "LR" | "TB" = "LR",
): N[] {
  const positions = dagreLayoutPositions(
    nodes.map((n) => ({ id: n.id, ...layoutSize(n) })),
    edges.map((e) => ({ source: e.source, target: e.target })),
    direction,
  );
  return nodes.map((n) => ({ ...n, position: positions.get(n.id)! }));
}

/**
 * The size a node contributes to a layout.
 *
 * Measured size lives on `node.measured` since React Flow v12; reading
 * `node.width` alone would size every node the app creates at the fallback.
 */
function layoutSize<N extends Node>(node: N): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? NODE_FALLBACK_WIDTH,
    height: node.measured?.height ?? node.height ?? NODE_FALLBACK_HEIGHT,
  };
}

/**
 * Lay out one frame's members in the frame's own coordinate space, and refit
 * the frame around the result.
 *
 * Returns the nodes it changed, keyed by id — the members at their new
 * frame-relative positions, plus the resized frame. `measured` is rewritten
 * alongside `width`/`height` so the outer placement pass sizes the frame by
 * what it now holds rather than by what React Flow last measured; React Flow
 * re-measures from the DOM on the next render either way.
 *
 * Note children keep their positions (a note is deliberate placement wherever
 * it sits) but still count towards the frame's new size, so refitting cannot
 * clip one out of view.
 */
function tidyFrame<N extends Node, E extends Edge>(
  frame: N,
  children: readonly N[],
  edges: readonly E[],
  direction: "LR" | "TB",
): Map<string, N> {
  const laidOut = children.filter((child) => child.type !== "note");
  if (laidOut.length === 0) return new Map();

  const memberIds = new Set(laidOut.map((child) => child.id));
  const positions = dagreLayoutPositions(
    laidOut.map((child) => ({ id: child.id, ...layoutSize(child) })),
    edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target)),
    direction,
  );

  // dagre's origin is arbitrary and can be negative; slide the block so its
  // top-left corner sits one pad inside the frame.
  let minX = Infinity;
  let minY = Infinity;
  for (const { x, y } of positions.values()) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }
  const offsetX = GROUP_PAD - minX;
  const offsetY = GROUP_PAD - minY;

  const changed = new Map<string, N>();
  let width = FRAME_MIN_WIDTH;
  let height = FRAME_MIN_HEIGHT;
  for (const child of children) {
    const laid = positions.get(child.id);
    const position =
      laid === undefined
        ? child.position
        : { x: laid.x + offsetX, y: laid.y + offsetY };
    const size = layoutSize(child);
    width = Math.max(width, position.x + size.width + GROUP_PAD);
    height = Math.max(height, position.y + size.height + GROUP_PAD);
    if (laid !== undefined) changed.set(child.id, { ...child, position });
  }
  changed.set(frame.id, {
    ...frame,
    width,
    height,
    measured: { width, height },
  });
  return changed;
}

function frameChildren<N extends Node>(nodes: readonly N[]): Map<string, N[]> {
  const childrenByFrame = new Map<string, N[]>();
  for (const node of nodes) {
    if (node.parentId === undefined) continue;
    const siblings = childrenByFrame.get(node.parentId);
    if (siblings === undefined) childrenByFrame.set(node.parentId, [node]);
    else siblings.push(node);
  }
  return childrenByFrame;
}

/**
 * Auto-layout that respects frames.
 *
 * Two passes, because dagre lays out a flat graph and a framed node's position
 * is relative to its frame:
 *
 * 1. Each frame's members are laid out in the frame's coordinate space, using
 *    only the edges between them, and the frame is refitted around them.
 * 2. Frames go into the outer graph as single boxes at their refitted size,
 *    and every edge touching a member is redirected to its frame so the chain
 *    still constrains where the frame lands.
 *
 * Notes are intentional placement and never move.
 */
export function autoLayoutRootNodes<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  direction: "LR" | "TB" = "LR",
): N[] {
  const movable = nodes.filter(
    (node) => node.parentId === undefined && node.type !== "note",
  );
  if (movable.length === nodes.length) return autoLayout(nodes, edges, direction);

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByFrame = frameChildren(nodes);

  const tidied = new Map<string, N>();
  for (const [frameId, children] of childrenByFrame) {
    const frame = byId.get(frameId);
    // A dangling parentId is `reconcileFrames`' job, not this one's.
    if (frame === undefined) continue;
    for (const [id, node] of tidyFrame(frame, children, edges, direction)) {
      tidied.set(id, node);
    }
  }

  const movableIds = new Set(movable.map((node) => node.id));
  // A framed node has no box of its own in the outer graph — its frame stands
  // in for it. Anything else off that graph (a note) drops the edge, rather
  // than have dagre invent the node it cannot see and lay the graph out around
  // a phantom.
  const boxFor = (id: string): string | undefined => {
    const owner = byId.get(id)?.parentId ?? id;
    return movableIds.has(owner) ? owner : undefined;
  };

  const collapsed: { source: string; target: string }[] = [];
  for (const edge of edges) {
    const source = boxFor(edge.source);
    const target = boxFor(edge.target);
    // Two members of the same frame collapse to a self-edge, which says
    // nothing about where the frame goes.
    if (source !== undefined && target !== undefined && source !== target) {
      collapsed.push({ source, target });
    }
  }

  const positions = dagreLayoutPositions(
    movable.map((node) => {
      const refitted = tidied.get(node.id) ?? node;
      return { id: node.id, ...layoutSize(refitted) };
    }),
    collapsed,
    direction,
  );
  return nodes.map((node) => {
    const tidiedNode = tidied.get(node.id) ?? node;
    const position = positions.get(node.id);
    return position === undefined ? tidiedNode : { ...tidiedNode, position };
  });
}
