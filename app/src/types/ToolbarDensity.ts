/**
 * How much of itself the canvas toolbar can afford to show.
 *
 * - `labels` — every control inline with its text label.
 * - `icons` — the same controls, text dropped to icons and tooltips.
 * - `overflow` — the secondary actions move into a `⋯` menu.
 *
 * The bar never wraps: a second row shifts the canvas content under it and
 * makes `CanvasToolbarBand` (which the run camera trusts) a lie.
 */
export type ToolbarDensity = "labels" | "icons" | "overflow";
