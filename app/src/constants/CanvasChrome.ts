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

/**
 * Height of the band the floating toolbar covers at the top of the canvas: its
 * `top-3` inset plus a row of 32px controls and their padding.
 *
 * Only the run camera reads this. The toolbar positions itself with Tailwind
 * classes and does not need a number, but anything *centring content* in the
 * canvas does — otherwise it aims at the middle of the container and puts the
 * node it is framing directly underneath the Run button.
 *
 * One row is a guarantee, not an observation: the toolbar is `flex-nowrap` and
 * sheds labels into an overflow menu as it runs out of width (see
 * `nextToolbarDensity`) precisely so this number stays true at every window
 * size. A wrapping toolbar would silently make the camera aim too high.
 */
export const CanvasToolbarBand = 56;

/**
 * Left inset for anything floating in the bottom-left corner beside the
 * ReactFlow control column — currently the tutorial follow-along companion.
 *
 * Clearing the controls sideways rather than upwards is deliberate: the column
 * is one button wide (28px measured in the renderer, borders included) and only
 * ever grows *downwards* as buttons are added, so a horizontal clearance stays
 * true and a vertical one would not. Without it the companion covers zoom,
 * fit-view and auto-layout — the controls several lessons tell the reader to
 * press while the companion is open.
 */
export const CanvasControlsClearance = CanvasCornerGutter * 2 + 28;
