import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanvasPrefs } from "../types/CanvasPrefs";

interface CanvasPrefsState extends CanvasPrefs {
  setCanvasPrefs: (patch: Partial<CanvasPrefs>) => void;
}

/**
 * Canvas interaction preferences are UI taste, so the renderer owns them in
 * localStorage rather than routing them through the main process.
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
      tipsEnabled: true,

      setCanvasPrefs: (patch: Partial<CanvasPrefs>) => set(patch),
    }),
    {
      name: "apiweave:v1:canvasPrefs",
      partialize: ({ dragMode, locked, snapToGrid, gridSize, wheelZoom, tipsEnabled }) => ({
        dragMode,
        locked,
        snapToGrid,
        gridSize,
        wheelZoom,
        tipsEnabled,
      }),
    },
  ),
);

export default useCanvasPrefsStore;
