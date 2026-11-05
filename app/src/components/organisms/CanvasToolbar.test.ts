import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildEnvironmentOptions,
  nextToolbarDensity,
  toolbarSlots,
} from "./canvasToolbarUtils";

test("buildEnvironmentOptions includes fallback environment first", () => {
  const options = buildEnvironmentOptions([
    { environmentId: "env-dev", name: "Development" },
    { environmentId: "env-prod", name: "Production" },
  ]);

  assert.deepEqual(options, [
    { value: "", label: "No Environment" },
    { value: "env-dev", label: "Development" },
    { value: "env-prod", label: "Production" },
  ]);
});

test("buildEnvironmentOptions returns only fallback for empty list", () => {
  const options = buildEnvironmentOptions([]);

  assert.deepEqual(options, [{ value: "", label: "No Environment" }]);
});

// The tiers only ever step down, one at a time, from whatever the bar is
// currently rendering. `compact` maps to itself so the measure/step-down loop
// in CanvasToolbar terminates on a bar that cannot fit even at its narrowest.
test("nextToolbarDensity steps down one tier and stops at compact", () => {
  assert.equal(nextToolbarDensity("labels"), "icons");
  assert.equal(nextToolbarDensity("icons"), "overflow");
  assert.equal(nextToolbarDensity("overflow"), "compact");
  assert.equal(nextToolbarDensity("compact"), "compact");
});

test("labels and icons keep the structure controls and the environment name inline", () => {
  for (const density of ["labels", "icons"] as const) {
    const slots = toolbarSlots(density);
    assert.equal(slots.showStructureInline, true, density);
    assert.equal(slots.showEnvironmentLabel, true, density);
  }
});

test("overflow folds secondary actions, not the structure controls or environment name", () => {
  const slots = toolbarSlots("overflow");

  assert.equal(slots.showSecondaryInline, false);
  assert.equal(slots.showHistoryInline, false);
  assert.equal(slots.showStructureInline, true);
  assert.equal(slots.showEnvironmentLabel, true);
  assert.equal(slots.showOverflow, true);
});

// The last step exists so a narrow canvas keeps Save and Run: the environment
// picker loses its text and the structure controls move into the menu.
test("compact collapses the environment picker and folds the structure controls", () => {
  const slots = toolbarSlots("compact");

  assert.equal(slots.showEnvironmentLabel, false);
  assert.equal(slots.showStructureInline, false);
  assert.equal(slots.showOverflow, true);
});

test("only the fully labelled row hides the overflow menu", () => {
  assert.equal(toolbarSlots("labels").showOverflow, false);
  for (const density of ["icons", "overflow", "compact"] as const) {
    assert.equal(toolbarSlots(density).showOverflow, true, density);
  }
});
