/**
 * Follow-along companion geometry. The width threshold is deliberately a
 * measured *main-content* width, not a viewport breakpoint: the sidebar and
 * agent dock can leave far less room than the viewport suggests, and the
 * companion must not squeeze the canvas.
 */
export const TUTORIAL_COMPANION_MIN_WIDTH = 832;

/** The floating panel width on wide layouts (20rem). */
export const TUTORIAL_COMPANION_PANEL_WIDTH = 320;
