import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasHistoryEntry } from "../types/CanvasHistoryEntry";
import type { CanvasNode } from "../types/CanvasNode";

/** Fifty edits back is further than anyone reaches, and it is 50 pointers. */
export const CANVAS_HISTORY_DEPTH = 50;

/**
 * Snapshot the *persisted* graph — exactly the fields `canvasToWorkflow`
 * writes, and nothing else.
 *
 * That narrowing is the whole guard against a run filling history. Run status,
 * results, branch counts, the swagger warning and the measured dimensions all
 * live outside this shape, so the forty node updates a run writes produce a
 * snapshot byte-identical to the one before it and record nothing. Selection
 * is outside it too, for the same reason: clicking a node is not an edit.
 */
export function captureCanvasHistory(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  variables: Record<string, JsonValue>,
): CanvasHistoryEntry {
  const persistedNodes: CanvasNode[] = nodes.map((node) => ({
    id: node.id,
    ...(node.type === undefined ? {} : { type: node.type }),
    position: node.position,
    // `parentId`/`extent` and an explicit `width`/`height` are the group-frame
    // half of the persisted shape: which frame a node sits in, and the size a
    // user dragged a frame to. `measured` is deliberately absent — that is
    // ReactFlow's measurement of a node, not anything the user did.
    ...(node.parentId === undefined
      ? {}
      : { parentId: node.parentId, extent: "parent" as const }),
    ...(node.width === undefined ? {} : { width: node.width }),
    ...(node.height === undefined ? {} : { height: node.height }),
    ...(node.dragHandle === undefined ? {} : { dragHandle: node.dragHandle }),
    data: {
      ...(node.data.label === undefined ? {} : { label: node.data.label }),
      config: node.data.config ?? {},
    },
  }));

  const persistedEdges: CanvasEdge[] = edges.map((edge) => {
    // Only string labels are persisted; `label` is a ReactNode on the type and
    // a React element would not survive `JSON.stringify` below.
    const label =
      typeof edge.label === "string" || edge.label === null
        ? edge.label
        : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      ...(label === undefined ? {} : { label }),
      type: edge.type ?? "custom",
    };
  });

  return {
    nodes: persistedNodes,
    edges: persistedEdges,
    variables,
    sig: JSON.stringify({
      nodes: persistedNodes,
      edges: persistedEdges,
      variables,
    }),
  };
}

/**
 * Add an entry to the ring, or don't.
 *
 * Returns the *same* array reference when the graph has not changed, so the
 * caller can skip the re-render on identity alone. A record after an undo
 * drops the redo tail — the future you didn't take is gone the moment you
 * edit — and the front is trimmed to `depth` in the same slice.
 */
export function recordCanvasHistory(
  entries: readonly CanvasHistoryEntry[],
  index: number,
  entry: CanvasHistoryEntry,
  depth: number = CANVAS_HISTORY_DEPTH,
): { entries: readonly CanvasHistoryEntry[]; index: number } {
  if (entries[index]?.sig === entry.sig) return { entries, index };

  const kept = entries.slice(Math.max(0, index + 2 - depth), index + 1);
  kept.push(entry);
  return { entries: kept, index: kept.length - 1 };
}
