import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../types/CanvasNode";
import { canTurnIntoExtract, suggestedVariableName, turnIntoExtract } from "./turnIntoExtract";

const node = (config: Record<string, unknown>, label?: string): CanvasNode => ({
  id: "b1",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { ...(label === undefined ? {} : { label }), config },
});

const heading = { kind: "role", role: "heading", name: "Order number" };

describe("canTurnIntoExtract", () => {
  it.each([
    ["a check on an element", node({ action: "expect-text", locator: heading, text: "x", match: "contains" }), true],
    ["a click", node({ action: "click", locator: { kind: "css", value: "#total" } }), true],
    ["a navigate", node({ action: "navigate", url: "https://x.test/" }), false],
    ["a key press with no element", node({ action: "press", key: "Enter" }), false],
    ["an extract already", node({ action: "extract", locator: heading, from: "text", variable: "n" }), false],
    ["a half-typed locator", node({ action: "click", locator: { kind: "role", role: "button", name: "" } }), false],
    ["another node type", { ...node({ action: "click", locator: heading }), type: "http-request" }, false],
  ])("%s → %s", (_what, candidate, expected) => {
    expect(canTurnIntoExtract(candidate)).toBe(expected);
  });
});

describe("turnIntoExtract", () => {
  it("keeps the element and the shared fields, reads text, and retitles the step", () => {
    const before = node(
      { action: "expect-text", locator: heading, text: "A-1", match: "contains", timeoutMs: 5_000, description: "Order id" },
      "Check text",
    );
    const after = turnIntoExtract(before, "orderNumber");
    expect(after.data).toEqual({
      label: "Save a value",
      config: { action: "extract", locator: heading, from: "text", variable: "orderNumber", timeoutMs: 5_000, description: "Order id" },
    });
    expect(after.data).not.toBe(before.data);
  });

  it("reads a form field's value, drops the click-only fields, and keeps a title the user wrote", () => {
    const field = { kind: "role", role: "textbox", name: "Reference" };
    expect(turnIntoExtract(node({ action: "fill", locator: field, value: "x" }, "Reference field"), "ref").data).toEqual({
      label: "Reference field",
      config: { action: "extract", locator: field, from: "value", variable: "ref" },
    });
    expect(turnIntoExtract(node({ action: "click", locator: field, dialog: "accept", clickCount: 2 }), "ref").data.config).toEqual({
      action: "extract",
      locator: field,
      from: "text",
      variable: "ref",
    });
  });
});

describe("suggestedVariableName", () => {
  it.each([
    [heading, "orderNumber"],
    [{ kind: "css", value: "#total" }, "total"],
    [{ kind: "text", value: "42 items" }, "items"],
    [{ kind: "role", role: "heading" }, "value"],
  ])("%j → %s", (locator, expected) => {
    expect(suggestedVariableName(node({ action: "click", locator }))).toBe(expected);
  });
});
