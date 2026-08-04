/**
 * Geometry for the fixtures that float in the canvas corners.
 *
 * The minimap and the floating action stack share the bottom-right corner but
 * are rendered by different components, so neither could see the other's size
 * and they overlapped. The measurements live together here instead: the stack
 * derives its offset from the minimap rather than guessing at one.
 */

/** Inset from the canvas edges, shared by every corner fixture. */
export const CanvasCornerGutter = 12;

export const MiniMapSize = { width: 220, height: 150 } as const;

/**
 * Bottom offset for the action stack — one gutter above the minimap, which in
 * turn sits one gutter above the canvas floor.
 */
export const CanvasActionsBottom = CanvasCornerGutter * 2 + MiniMapSize.height;
