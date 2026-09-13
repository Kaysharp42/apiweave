import type { EnvironmentOption, ToolbarDensity } from "../../types";

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
 * `overflow` is the floor: it maps to itself so the step-down terminates.
 */
export function nextToolbarDensity(density: ToolbarDensity): ToolbarDensity {
  return density === "labels" ? "icons" : "overflow";
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
