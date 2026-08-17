import type { EnvironmentOption } from "../../types";

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

/**
 * Measured off the real bar rather than guessed: the labelled row is ~855px
 * wide and the icon row ~505px, both with a short environment name. The
 * thresholds sit just above those, not above the worst case, because the
 * environment select is allowed to shrink — a long name gives up characters
 * before anything else gives up a whole tier.
 *
 * The labels floor is deliberately under the canvas width of a default 1280px
 * window with the sidebar open (~870px). That is the size the app ships at, so
 * it is the one that should look finished.
 */
const LABELS_MIN_WIDTH = 860;
const ICONS_MIN_WIDTH = 640;

/**
 * `null` means "not measured yet" and resolves to the roomiest tier, matching
 * what a first paint at a normal window size is about to become anyway.
 */
export function resolveToolbarDensity(
  availableWidth: number | null,
): ToolbarDensity {
  if (availableWidth === null || availableWidth >= LABELS_MIN_WIDTH) {
    return "labels";
  }
  return availableWidth >= ICONS_MIN_WIDTH ? "icons" : "overflow";
}

export function buildEnvironmentOptions(
  environments: Array<{ environmentId: string; name: string }>,
): EnvironmentOption[] {
  return [
    { value: "", label: "No Environment" },
    ...environments.map((env) => ({
      value: env.environmentId,
      label: env.name,
    })),
  ];
}
