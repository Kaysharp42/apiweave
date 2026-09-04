import type { CanvasDragMode } from "./CanvasDragMode";

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
  /** Contextual hints appear on the canvas until the user turns them off. */
  tipsEnabled: boolean;
}
