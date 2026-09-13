import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildEnvironmentOptions,
  nextToolbarDensity,
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
// currently rendering. `overflow` maps to itself so the measure/step-down loop
// in CanvasToolbar terminates on a bar that cannot fit even at its narrowest.
test("nextToolbarDensity steps down one tier and stops at overflow", () => {
  assert.equal(nextToolbarDensity("labels"), "icons");
  assert.equal(nextToolbarDensity("icons"), "overflow");
  assert.equal(nextToolbarDensity("overflow"), "overflow");
});
