import { test } from "vitest";
import assert from "node:assert/strict";
import { getNodeModalTypeName } from "./nodeModalMeta.ts";

test("getNodeModalTypeName returns known node display names", () => {
  assert.equal(getNodeModalTypeName("http-request"), "HTTP Request");
  assert.equal(getNodeModalTypeName("assertion"), "Assertion");
  assert.equal(getNodeModalTypeName("merge"), "Merge");
});

test("getNodeModalTypeName falls back to generic label", () => {
  assert.equal(getNodeModalTypeName("custom-type"), "Node");
  assert.equal(getNodeModalTypeName(undefined as never), "Node");
});
