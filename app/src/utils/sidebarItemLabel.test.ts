import { test } from "vitest";
import assert from "node:assert/strict";
import { getSidebarItemLabel } from "./sidebarItemLabel.ts";

test("getSidebarItemLabel keeps a name whole, however long", () => {
  const name = "A very long workflow name that the row's CSS truncates";

  assert.equal(getSidebarItemLabel(name), name);
});

test("getSidebarItemLabel trims surrounding whitespace", () => {
  assert.equal(getSidebarItemLabel("  Checkout API  "), "Checkout API");
});

test("getSidebarItemLabel falls back for blank and non-string values", () => {
  assert.equal(getSidebarItemLabel("   ", "Untitled workflow"), "Untitled workflow");
  assert.equal(getSidebarItemLabel(null, "Untitled workflow"), "Untitled workflow");
  assert.equal(getSidebarItemLabel(undefined), "Untitled");
});
