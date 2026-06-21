import { test } from "vitest";
import assert from "node:assert/strict";
import { buildEnvironmentOptions } from "./canvasToolbarUtils";

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
