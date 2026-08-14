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
 */
export const CanvasToolbarBand = 56;
