import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../types/CanvasNode";
import {
  canMakeStepVariable,
  makeStepVariable,
  stepLiterals,
  stepsSharingLiteral,
  stepVariableNameError,
  suggestedStepVariableName,
} from "./makeStepVariable";
import { recordedStepLabel } from "./recordedSteps";

const node = (id: string, config: Record<string, unknown>, label?: string): CanvasNode => ({
  id,
  type: "browser",
  position: { x: 0, y: 0 },
  data: { ...(label === undefined ? {} : { label }), config },
});

const search = { kind: "label", value: "Search client" };
const elroy = { kind: "role", role: "option", name: "Elroy" };

describe("stepLiterals", () => {
  it.each([
    [
      "a fill: its text and its label",
      { action: "fill", locator: search, value: "ahm" },
      [
        ["value", "Typed text", "ahm"],
        ["locator.value", "Element label", "Search client"],
      ],
    ],
    ["a click on a named option", { action: "click", locator: elroy }, [["locator.name", "Element name (option)", "Elroy"]]],
    [
      "a select: each option",
      { action: "select", locator: { kind: "testId", value: "plan" }, values: ["Gold", "Silver"] },
      [
        ["values.0", "Option 1", "Gold"],
        ["values.1", "Option 2", "Silver"],
        ["locator.value", "Element test id", "plan"],
      ],
    ],
    [
      "an expect-text on a css element: the text and the filter, never the selector",
      { action: "expect-text", locator: { kind: "css", value: ".row", hasText: "Ada" }, text: "Paid", match: "contains" },
      [
        ["text", "Expected text", "Paid"],
        ["locator.hasText", "Element text filter", "Ada"],
      ],
    ],
    ["an expect-value", { action: "expect-value", locator: { kind: "placeholder", value: "Total" }, value: "42" }, [
      ["value", "Expected value", "42"],
      ["locator.value", "Element placeholder", "Total"],
    ]],
    ["a navigate: its url is out of scope", { action: "navigate", url: "https://x.test/login" }, []],
    ["a key press with no element", { action: "press", key: "Enter" }, []],
  ])("%s", (_what, config, expected) => {
    expect(stepLiterals(node("b1", config)).map((literal) => [literal.field, literal.description, literal.value])).toEqual(expected);
  });

  it("leaves out empty fields and any field holding a placeholder", () => {
    const config = {
      action: "fill",
      locator: { kind: "role", role: "textbox", name: "{{variables.field}}", hasText: "x {{env.Y}}" },
      value: "{{secrets.TOKEN}}",
    };
    expect(stepLiterals(node("b1", config))).toEqual([]);
    expect(stepLiterals(node("b1", { action: "fill", locator: search, value: "" })).map((literal) => literal.field)).toEqual(["locator.value"]);
  });

  it("never offers a fill into a field that takes a secret", () => {
    const password = { action: "fill", locator: { kind: "label", value: "Password" }, value: "hunter2" };
    expect(stepLiterals(node("b1", password)).map((literal) => literal.field)).toEqual(["locator.value"]);
  });

  it("offers nothing on another node type", () => {
    const http: CanvasNode = { ...node("h1", { action: "fill", locator: search, value: "ahm" }), type: "http-request" };
    expect(canMakeStepVariable(http)).toBe(false);
    expect(canMakeStepVariable(node("b1", { action: "click", locator: elroy }))).toBe(true);
    expect(canMakeStepVariable(node("b2", { action: "navigate", url: "https://x.test/" }))).toBe(false);
  });
});

describe("suggestedStepVariableName", () => {
  it("names a value field after its element, and a role's name after the role", () => {
    expect(suggestedStepVariableName(node("b1", { action: "fill", locator: search, value: "ahm" }), "value", {})).toBe("searchClient");
    expect(suggestedStepVariableName(node("b1", { action: "click", locator: elroy }), "locator.name", {})).toBe("optionName");
    expect(suggestedStepVariableName(node("b1", { action: "select", locator: { kind: "css", value: "#s" }, values: ["a"] }), "values.0", {})).toBe("option");
  });

  it("reuses a name holding the same value and numbers past one holding another", () => {
    const fill = node("b1", { action: "fill", locator: search, value: "ahm" });
    expect(suggestedStepVariableName(fill, "value", { searchClient: "ahm" })).toBe("searchClient");
    expect(suggestedStepVariableName(fill, "value", { searchClient: "zed", searchClient2: "x" })).toBe("searchClient3");
    expect(suggestedStepVariableName(fill, "value", { searchClient: "zed", searchClient2: "ahm" })).toBe("searchClient2");
  });
});

describe("stepVariableNameError", () => {
  it("accepts a new name or one already holding the same value, refuses one holding another", () => {
    expect(stepVariableNameError("client", "Elroy", {})).toBeUndefined();
    expect(stepVariableNameError("client", "Elroy", { client: "Elroy" })).toBeUndefined();
    expect(stepVariableNameError("client", "Elroy", { client: "Ada" })).toBe("client already holds a different value. Pick another name.");
  });

  it("refuses an empty name and one the placeholder syntax cannot name", () => {
    expect(stepVariableNameError("", "x", {})).toBe("Give the variable a name.");
    expect(stepVariableNameError("2fa", "x", {})).toBe("Use letters, digits and underscores, starting with a letter.");
    expect(stepVariableNameError("constructor", "x", {})).toBeUndefined();
  });
});

describe("makeStepVariable", () => {
  const pick = node("b1", { action: "click", locator: elroy }, recordedStepLabel({ action: "click", locator: elroy }));
  const check = node("b2", { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "Elroy", match: "contains" }, "Who is it");
  const near = node("b3", { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "Elroy Smith", match: "contains" });
  const nodes = [pick, check, near];

  it("counts the other steps holding exactly the same text", () => {
    expect(stepsSharingLiteral(nodes, "b1", "Elroy")).toBe(1);
    expect(stepsSharingLiteral(nodes, "b1", "Nobody")).toBe(0);
  });

  it("replaces the chosen field only, and retitles a step whose title was generated", () => {
    const made = makeStepVariable(nodes, "b1", { field: "locator.name", name: "client", everywhere: false });
    expect(made?.value).toBe("Elroy");
    expect(made?.steps).toBe(1);
    expect(made?.nodes[0]?.data).toEqual({
      label: "Click client",
      config: { action: "click", locator: { kind: "role", role: "option", name: "{{variables.client}}" } },
    });
    expect(made?.nodes[1]).toBe(check);
    expect(made?.nodes[2]).toBe(near);
  });

  it("replaces the same whole-field text in the other steps, keeping a title the user wrote", () => {
    const made = makeStepVariable(nodes, "b1", { field: "locator.name", name: "client", everywhere: true });
    expect(made?.steps).toBe(2);
    expect(made?.nodes[1]?.data).toEqual({
      label: "Who is it",
      config: { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "{{variables.client}}", match: "contains" },
    });
    expect(made?.nodes[2]).toBe(near);
  });

  it("replaces one option of a select and keeps the others", () => {
    const select = node("s1", { action: "select", locator: { kind: "css", value: "#s" }, values: ["Gold", "Silver"] });
    const made = makeStepVariable([select], "s1", { field: "values.1", name: "tier", everywhere: false });
    expect(made?.nodes[0]?.data.config).toEqual({ action: "select", locator: { kind: "css", value: "#s" }, values: ["Gold", "{{variables.tier}}"] });
  });

  it("does nothing for a field that holds no literal", () => {
    expect(makeStepVariable(nodes, "b1", { field: "value", name: "x", everywhere: true })).toBeNull();
    expect(makeStepVariable(nodes, "missing", { field: "value", name: "x", everywhere: true })).toBeNull();
  });
});
