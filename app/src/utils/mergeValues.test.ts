import { describe, expect, it } from "vitest";
import {
  isLongValue,
  parseValueText,
  resolvedValue,
  valueText,
} from "./mergeValues";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";

function conflict(overrides: Partial<GitMergeConflict> = {}): GitMergeConflict {
  return {
    kind: "workflow",
    recordId: "w1",
    name: "Checkout",
    path: "name",
    ours: "Mine",
    theirs: "Remote",
    ...overrides,
  };
}

describe("valueText", () => {
  it("writes a value as the JSON the editor edits, keeping text quoted", () => {
    expect(valueText("42")).toBe('"42"');
    expect(valueText(42)).toBe("42");
    expect(valueText(null)).toBe("null");
    expect(valueText({ a: [1, true] })).toBe('{"a":[1,true]}');
  });
});

describe("isLongValue", () => {
  it("sends objects, arrays and long or multiline text to Monaco", () => {
    expect(isLongValue({ a: 1 })).toBe(true);
    expect(isLongValue([1, 2])).toBe(true);
    expect(isLongValue("x".repeat(121))).toBe(true);
    expect(isLongValue("two\nlines")).toBe(true);
    expect(isLongValue("Customer name")).toBe(false);
    expect(isLongValue(42)).toBe(false);
    expect(isLongValue(null)).toBe(false);
    expect(isLongValue(undefined)).toBe(false);
  });
});

describe("parseValueText", () => {
  it("parses JSON, and refuses what is not JSON with a sentence", () => {
    expect(parseValueText('"42"')).toEqual({ value: "42" });
    expect(parseValueText("42")).toEqual({ value: 42 });
    expect(parseValueText("true")).toEqual({ value: true });
    expect(parseValueText("null")).toEqual({ value: null });
    expect(parseValueText("{ not json")).toEqual({
      error: "Not JSON. Text needs quotes, and numbers, true, false and null do not.",
    });
  });
});

describe("resolvedValue", () => {
  it("is the picked copy's value, the user's own, or the remote's while nothing is settled", () => {
    const ours: GitMergePick = { recordId: "w1", path: "name", side: "ours" };
    const theirs: GitMergePick = { recordId: "w1", path: "name", side: "theirs" };
    const own: GitMergePick = { recordId: "w1", path: "name", value: "Own" };

    expect(resolvedValue(conflict(), undefined)).toBe("Remote");
    expect(resolvedValue(conflict(), ours)).toBe("Mine");
    expect(resolvedValue(conflict(), theirs)).toBe("Remote");
    expect(resolvedValue(conflict(), own)).toBe("Own");
  });
});
