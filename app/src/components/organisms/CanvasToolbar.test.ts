import { test } from "vitest";
import assert from "node:assert/strict";
import {
  buildEnvironmentOptions,
  resolveToolbarDensity,
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

test("resolveToolbarDensity keeps labels on a roomy canvas", () => {
  assert.equal(resolveToolbarDensity(1400), "labels");
  assert.equal(resolveToolbarDensity(860), "labels");
});

// The default 1280px window leaves the canvas ~870px with the sidebar open.
// That is the size the app opens at, so it has to be a labelled toolbar.
test("resolveToolbarDensity keeps labels in a default-sized window", () => {
  assert.equal(resolveToolbarDensity(870), "labels");
});

test("resolveToolbarDensity drops to icons before it runs out of room", () => {
  assert.equal(resolveToolbarDensity(859), "icons");
  assert.equal(resolveToolbarDensity(640), "icons");
});

test("resolveToolbarDensity sheds actions into the overflow menu when narrow", () => {
  assert.equal(resolveToolbarDensity(639), "overflow");
  assert.equal(resolveToolbarDensity(0), "overflow");
});

// A first paint has nothing measured yet. Guessing the narrowest tier would
// make every normal window flash an overflow menu it is about to discard.
test("resolveToolbarDensity assumes room before the first measurement", () => {
  assert.equal(resolveToolbarDensity(null), "labels");
});
