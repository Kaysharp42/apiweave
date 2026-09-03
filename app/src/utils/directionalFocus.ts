import type { Node } from "@xyflow/react";
import { NODE_FALLBACK_WIDTH, NODE_FALLBACK_HEIGHT } from "./autoLayout";

export type FocusDirection = "up" | "down" | "left" | "right";

/**
 * Off-axis distance costs double. Without the weight, → jumps to a node that is
 * far right *and* far down in preference to the one sitting directly right of
 * you, which is the whole reason plain nearest-neighbour feels broken.
 */
const PERPENDICULAR_WEIGHT = 2;

/** Unit vector per direction. Distance along the axis is the dot product with
 * it; distance off the axis is the dot product with its perpendicular, which
 * for these four is the same vector with its components swapped. */
const AXIS: Record<FocusDirection, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
};

/** Measured size lives on `node.measured` since v12 — see `autoLayout`. */
function centre(node: Node): { x: number; y: number } {
  const width = node.measured?.width ?? node.width ?? NODE_FALLBACK_WIDTH;
  const height = node.measured?.height ?? node.height ?? NODE_FALLBACK_HEIGHT;
  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}

/**
 * Where the arrow keys get into the graph from nothing selected: the left-most
 * node, top-most on a tie — the start of a left-to-right workflow. Direction is
 * deliberately ignored, because the first press has to land somewhere or the
 * canvas stays mouse-only.
 */
function entryNode(nodes: Node[]): string | null {
  let best: Node | null = null;
  let bestKey = [Infinity, Infinity];

  for (const node of nodes) {
    const { x, y } = centre(node);
    if (x < bestKey[0]! || (x === bestKey[0]! && y < bestKey[1]!)) {
      best = node;
      bestKey = [x, y];
    }
  }

  return best?.id ?? null;
}

/**
 * The node to move focus to when `direction` is pressed from `fromId`, or null
 * when nothing lies that way.
 *
 * Computed from the `nodes` array and never the DOM: the canvas runs with
 * `onlyRenderVisibleElements`, so the answer is routinely a node that is not
 * mounted.
 */
export function nearestInDirection(
  nodes: Node[],
  fromId: string | null | undefined,
  direction: FocusDirection,
): string | null {
  const from = nodes.find((n) => n.id === fromId);
  if (!from) return entryNode(nodes);

  const origin = centre(from);
  const axis = AXIS[direction];
  let bestId: string | null = null;
  let bestScore = Infinity;

  for (const node of nodes) {
    const { x, y } = centre(node);
    const dx = x - origin.x;
    const dy = y - origin.y;

    // Only the target half-plane: a node level with or behind the origin is not
    // in that direction at all, however close it is. Catches `from` itself too.
    const along = dx * axis.x + dy * axis.y;
    if (along <= 0) continue;

    const offAxis = Math.abs(dx * axis.y + dy * axis.x);
    const score = along + PERPENDICULAR_WEIGHT * offAxis;
    if (score < bestScore) {
      bestScore = score;
      bestId = node.id;
    }
  }

  return bestId;
}
