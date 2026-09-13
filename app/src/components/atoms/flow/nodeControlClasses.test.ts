import { describe, expect, it } from "vitest";
import {
  NODE_SELECT_CLASS,
  NODE_TEXTAREA_CLASS,
  nodeInputClass,
} from "./nodeControlClasses";

describe("nodeControlClasses", () => {
  it("keeps compact textareas vertically resizable at node width", () => {
    expect(NODE_TEXTAREA_CLASS).toContain("resize-y");
    expect(NODE_TEXTAREA_CLASS).toContain("w-full");
    expect(NODE_TEXTAREA_CLASS).toContain("text-xs");
  });

  it("keeps compact sizing on selects and inputs", () => {
    expect(NODE_SELECT_CLASS).toContain("text-xs");
    expect(nodeInputClass()).toContain("text-xs");
  });
});
