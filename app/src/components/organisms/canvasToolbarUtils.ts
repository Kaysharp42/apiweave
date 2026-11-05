import type { EnvironmentOption, ToolbarDensity } from "../../types";

/**
 * Which controls a tier renders inline, and which fold into the overflow menu.
 *
 * Kept as a pure function rather than a pile of `density === ...` checks in the
 * component so the tiers can be tested without a layout: the bar chooses its
 * tier by measuring itself, which jsdom cannot do.
 */
export function toolbarSlots(density: ToolbarDensity) {
  const showLabels = density === "labels";
  return {
    showLabels,
    /** Command palette, JSON and Import share the labelled row's space. */
    showSecondaryInline: showLabels,
    /** Run history survives the first step down, then joins the menu. */
    showHistoryInline: density === "labels" || density === "icons",
    /** Undo/redo and frame/ungroup stay inline until the last step. */
    showStructureInline: density !== "compact",
    /** The environment picker's name fits until the last step. */
    showEnvironmentLabel: density !== "compact",
    /** The menu only exists below the fully labelled row. */
    showOverflow: density !== "labels",
  };
}

/**
 * The next-narrower tier, for a bar that has just measured itself as too wide.
 *
 * There used to be pixel thresholds here ("labels need 860px"), measured off
 * the real bar. They were correct the day they were written and wrong the next
 * time a button was added to the toolbar: the labelled row grew past 980px
 * while the threshold still called 980px roomy, so the Run button hung off the
 * edge of the canvas until a resize. Nothing here knows a width any more —
 * `CanvasToolbar` steps down through these tiers until the bar stops
 * overflowing, which also covers the labels it cannot predict (an agent name,
 * a long environment name).
 *
 * `compact` is the floor: it maps to itself so the step-down terminates.
 */
export function nextToolbarDensity(density: ToolbarDensity): ToolbarDensity {
  switch (density) {
    case "labels":
      return "icons";
    case "icons":
      return "overflow";
    case "overflow":
      return "compact";
    case "compact":
      return "compact";
  }
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
