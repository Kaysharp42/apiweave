import type { CanvasPrefs } from "../types/CanvasPrefs";
import type { CanvasInteractionProps } from "../types/CanvasInteractionProps";

/** Left and middle mouse pan when panning is the drag. */
const PAN_BUTTONS = [0, 1];
/** Middle mouse still pans when a left-drag is box-select. */
const MIDDLE_BUTTON_ONLY = [1];

/**
 * The ReactFlow pan/zoom/selection props for a set of canvas preferences.
 *
 * A pure function rather than an expression in the JSX because `panOnDrag` is
 * the only real logic in the whole feature, and it is the one thing worth a
 * table test over {dragMode, locked, spacePan}.
 */
export function canvasInteractionProps(
  prefs: CanvasPrefs,
  spacePan: boolean,
): CanvasInteractionProps {
  const { dragMode, locked, wheelZoom, snapToGrid, gridSize } = prefs;

  // Space pans whatever the mode is. It is the gesture everyone tries first,
  // and it is what makes the mode setting low-stakes rather than a commitment.
  const panning = spacePan || dragMode === "pan";

  return {
    selectionOnDrag: !panning,
    // The lock is the camera and nothing else — see `CanvasPrefs.locked`.
    panOnDrag: locked ? false : panning ? PAN_BUTTONS : MIDDLE_BUTTON_ONLY,
    panOnScroll: !locked && !wheelZoom,
    zoomOnScroll: !locked && wheelZoom,
    zoomOnPinch: !locked,
    snapToGrid,
    snapGrid: [gridSize, gridSize],
  };
}
