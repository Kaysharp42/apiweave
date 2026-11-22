import { describe, expect, it } from "vitest";
import { browserStepFacts } from "./browserStep";

describe("browserStepFacts", () => {
  it("has nothing to say before a run", () => {
    expect(browserStepFacts(undefined)).toEqual([]);
  });

  it("gives a check's address, what it expected and what it found", () => {
    expect(
      browserStepFacts({ action: "expect-text", url: "https://shop.test/", expected: "Dashboard", actual: "Welcome" }),
    ).toEqual([
      ["address", "https://shop.test/"],
      ["expected", "Dashboard"],
      ["found", "Welcome"],
    ]);
  });

  it("says nothing was found when a check's element never appeared", () => {
    expect(browserStepFacts({ action: "expect-visible", expected: "visible" })).toEqual([
      ["expected", "visible"],
      ["found", "nothing: the element was not found"],
    ]);
  });

  it("calls an extract's reading its value", () => {
    expect(browserStepFacts({ action: "extract", actual: "ORD-42" })).toEqual([["value", "ORD-42"]]);
  });
});
