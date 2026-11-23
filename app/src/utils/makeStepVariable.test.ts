import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../types/CanvasNode";
import {
  canMakeStepVariable,
  makeStepVariable,
  stepLiterals,
  stepsSharingLiteral,
  stepVariableDraft,
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

  it.each([
    ["a label", { kind: "label", value: "Password" }],
    ["a CSS id", { kind: "css", value: "#password" }],
    ["a CSS type selector", { kind: "css", value: "input[type=password]" }],
    ["a CSS name attribute", { kind: "css", value: "[name=pwd]" }],
    ["a French label", { kind: "label", value: "Mot de passe" }],
    ["a German label", { kind: "label", value: "Passwort" }],
    ["a Spanish label", { kind: "label", value: "Contraseña" }],
    ["a Spanish label without the tilde", { kind: "label", value: "Contrasena" }],
    ["a Portuguese label", { kind: "label", value: "Senha" }],
    ["a Dutch label", { kind: "label", value: "Wachtwoord" }],
    ["a Swedish label", { kind: "label", value: "Lösenord" }],
    ["a Swedish label without the umlaut", { kind: "label", value: "Losenord" }],
    ["a Polish label", { kind: "label", value: "Hasło" }],
    ["a Polish label without the stroke", { kind: "label", value: "Haslo" }],
    ["an Italian label", { kind: "label", value: "Parola" }],
    ["a Japanese label", { kind: "label", value: "パスワード" }],
    ["a Chinese label", { kind: "label", value: "密码" }],
    ["a role name", { kind: "role", role: "textbox", name: "Password" }],
  ])("never offers a fill into a field that takes a secret: %s", (_what, locator) => {
    expect(stepLiterals(node("b1", { action: "fill", locator, value: "hunter2" })).map((literal) => literal.field)).not.toContain("value");
  });

  it("still offers the locator's own text of a field that takes a secret", () => {
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

  it("names a value field after a nameless role's text filter", () => {
    const alert = node("b1", { action: "expect-text", locator: { kind: "role", role: "alert", hasText: "Payment failed" }, text: "Payment failed" });
    expect(suggestedStepVariableName(alert, "text", {})).toBe("paymentFailed");
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

describe("stepVariableDraft", () => {
  const pick = node("b1", { action: "click", locator: elroy });
  const alsoPick = node("b2", { action: "click", locator: elroy });
  const typed = node("f1", { action: "fill", locator: search, value: "Elroy" });

  it("reports the chosen literal, the trimmed name, its error and the other steps in the same family", () => {
    expect(stepVariableDraft([pick, alsoPick, typed], pick, "locator.name", "  optionName ", {})).toEqual({
      literal: { field: "locator.name", description: "Element name (option)", value: "Elroy" },
      name: "optionName",
      error: undefined,
      others: 1,
      reused: false,
      family: "element text",
    });
    expect(stepVariableDraft([pick, typed], typed, "value", "", {})).toMatchObject({ error: "Give the variable a name.", others: 0, family: "value" });
  });

  it("marks a name already holding the value as reused", () => {
    expect(stepVariableDraft([typed], typed, "value", "searchClient", { searchClient: "Elroy" })).toMatchObject({ reused: true, error: undefined });
  });

  it("holds no literal when there is no step or the field is not one of its literals", () => {
    const empty = { literal: undefined, name: "x", error: undefined, others: 0, reused: false, family: "value" };
    expect(stepVariableDraft([pick], undefined, undefined, "x", {})).toEqual(empty);
    expect(stepVariableDraft([pick], pick, "value", "x", {})).toEqual(empty);
  });
});

describe("makeStepVariable", () => {
  const pick = node("b1", { action: "click", locator: elroy }, recordedStepLabel({ action: "click", locator: elroy }));
  const check = node("b2", { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "Elroy", match: "contains" }, "Who is it");
  const near = node("b3", { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "Elroy Smith", match: "contains" });
  const again = node("b4", { action: "expect-text", locator: { kind: "css", value: "#again" }, text: "Elroy", match: "contains" });
  const nodes = [pick, check, near, again];

  it("counts the other steps holding exactly the same text in the same family", () => {
    expect(stepsSharingLiteral(nodes, "b1", "locator.name", "Elroy")).toBe(0);
    expect(stepsSharingLiteral(nodes, "b2", "text", "Elroy")).toBe(1);
    // b1's role name is a locator field too, so it counts for another locator field.
    expect(stepsSharingLiteral(nodes, "b2", "locator.hasText", "Elroy")).toBe(1);
    expect(stepsSharingLiteral(nodes, "b2", "text", "Nobody")).toBe(0);
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
    const made = makeStepVariable(nodes, "b2", { field: "text", name: "client", everywhere: true });
    expect(made?.steps).toBe(2);
    expect(made?.nodes[1]?.data).toEqual({
      label: "Who is it",
      config: { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "{{variables.client}}", match: "contains" },
    });
    expect(made?.nodes[2]).toBe(near);
    expect(made?.nodes[3]?.data.config).toEqual({ action: "expect-text", locator: { kind: "css", value: "#again" }, text: "{{variables.client}}", match: "contains" });
  });

  it("never replaces an element lookup because a value field holds the same text", () => {
    const typed = node("f1", { action: "fill", locator: { kind: "css", value: "#q" }, value: "Search" });
    const button = node("c1", { action: "click", locator: { kind: "role", role: "button", name: "Search" } });
    const made = makeStepVariable([typed, button], "f1", { field: "value", name: "term", everywhere: true });
    expect(made?.steps).toBe(1);
    expect(made?.nodes[0]?.data.config).toEqual({ action: "fill", locator: { kind: "css", value: "#q" }, value: "{{variables.term}}" });
    expect(made?.nodes[1]).toBe(button);
    expect(stepsSharingLiteral([typed, button], "f1", "value", "Search")).toBe(0);
    expect(stepsSharingLiteral([typed, button], "f1", "locator.name", "Search")).toBe(1);
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
