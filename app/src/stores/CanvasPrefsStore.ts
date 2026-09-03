import { create } from "zustand";
import { persist } from "zustand/middleware";

/** What a left-drag on empty canvas does. */
export type CanvasDragMode = "pan" | "select";

export interface CanvasPrefs {
  dragMode: CanvasDragMode;
  /**
   * The camera is frozen — the map stops sliding under whoever is working on
   * it. Deliberately *only* the camera: nodes stay draggable and connectable,
   * because a lock that disables editing gets turned off and never turned back
   * on.
   */
  locked: boolean;
  snapToGrid: boolean;
  gridSize: number;
  /** Wheel zooms (true, the historical behaviour) or pans (false). */
  wheelZoom: boolean;
}

interface CanvasPrefsState extends CanvasPrefs {
  setCanvasPrefs: (patch: Partial<CanvasPrefs>) => void;
}

/**
 * Canvas interaction preferences. localStorage rather than the IPC settings
 * handler: that one carries the http-safety opt-in, which is a security
 * decision the main process has to enforce — these are UI taste, and the
 * renderer is the only thing that ever reads them.
 */
const useCanvasPrefsStore = create<CanvasPrefsState>()(
  persist(
    (set) => ({
      // Today's behaviour: ReactFlow's default `panOnDrag` pans on left-drag.
      dragMode: "pan",
      locked: false,
      snapToGrid: false,
      // The `Background` dot gap, so a snapped node lands on the dots someone
      // can actually see rather than on an invisible lattice of its own.
      gridSize: 24,
      wheelZoom: true,

      setCanvasPrefs: (patch: Partial<CanvasPrefs>) => set(patch),
    }),
    {
      name: "apiweave:v1:canvasPrefs",
      partialize: ({ dragMode, locked, snapToGrid, gridSize, wheelZoom }) => ({
        dragMode,
        locked,
        snapToGrid,
        gridSize,
        wheelZoom,
      }),
    },
  ),
);

export default useCanvasPrefsStore;
