import { useCallback, useEffect, useRef, useState } from "react";
import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasEdge } from "../types/CanvasEdge";
import type { CanvasNode } from "../types/CanvasNode";
import {
  captureCanvasHistory,
  recordCanvasHistory,
  type CanvasHistoryEntry,
} from "../utils/canvasHistory";

/**
 * Trailing edge, like `useAutoSave`'s. A drag emits a position change per
 * frame and a typed field one per keystroke; recording each would make a
 * single gesture forty undo steps deep. Shorter than the 700ms autosave debounce
 * so the entry exists before the save it describes.
 */
const RECORD_DEBOUNCE_MS = 500;

interface UseCanvasHistoryParams {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  variables: Record<string, JsonValue>;
  /**
   * Bumped when a server snapshot replaces the live canvas. History rebases
   * onto it instead of recording it: the edits before a cloud pull belong to a
   * graph that is no longer on screen, and undoing into them would push a
   * merge the user never made.
   */
  resetKey: number;
  /** Off until hydration, so the seed canvas is never an undo target. */
  enabled: boolean;
  apply: (entry: CanvasHistoryEntry) => void;
}

export interface CanvasHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Undo/redo for the canvas: a bounded ring of persisted-shape snapshots.
 *
 * Version history and undo are not the same feature — history recovers a save,
 * undo recovers a keystroke — so this deliberately knows nothing about the
 * server. It watches the live arrays, and `captureCanvasHistory` is what keeps
 * everything that is not a user edit (run status, selection, measurement) from
 * reaching the ring at all.
 */
export default function useCanvasHistory({
  nodes,
  edges,
  variables,
  resetKey,
  enabled,
  apply,
}: UseCanvasHistoryParams): CanvasHistoryControls {
  const entriesRef = useRef<readonly CanvasHistoryEntry[]>([]);
  const indexRef = useRef(-1);
  const [reach, setReach] = useState({ canUndo: false, canRedo: false });

  const liveRef = useRef({ nodes, edges, variables });
  liveRef.current = { nodes, edges, variables };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const sync = useCallback(() => {
    const canUndo = indexRef.current > 0;
    const canRedo = indexRef.current < entriesRef.current.length - 1;
    setReach((prev) =>
      prev.canUndo === canUndo && prev.canRedo === canRedo
        ? prev
        : { canUndo, canRedo },
    );
  }, []);

  // Rebase. Also how the first baseline gets in, once hydration has run.
  useEffect(() => {
    if (!enabled) return;
    const { nodes: n, edges: e, variables: v } = liveRef.current;
    entriesRef.current = [captureCanvasHistory(n, e, v)];
    indexRef.current = 0;
    sync();
  }, [resetKey, enabled, sync]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const { nodes: n, edges: e, variables: v } = liveRef.current;
      const next = recordCanvasHistory(
        entriesRef.current,
        indexRef.current,
        captureCanvasHistory(n, e, v),
      );
      if (next.entries === entriesRef.current) return;
      entriesRef.current = next.entries;
      indexRef.current = next.index;
      sync();
    }, RECORD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [nodes, edges, variables, enabled, sync]);

  const step = useCallback(
    (delta: -1 | 1) => {
      const target = indexRef.current + delta;
      const entry = entriesRef.current[target];
      if (!entry) return;
      indexRef.current = target;
      // Applying moves the cursor first, so the record timer this triggers
      // finds the entry it just restored and stays quiet.
      applyRef.current(entry);
      sync();
    },
    [sync],
  );

  const undo = useCallback(() => step(-1), [step]);
  const redo = useCallback(() => step(1), [step]);

  return { undo, redo, canUndo: reach.canUndo, canRedo: reach.canRedo };
}
