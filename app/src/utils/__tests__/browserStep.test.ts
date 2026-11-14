import { describe, expect, it } from "vitest";
import { BrowserNodeDataSchema } from "@shared/zod-schemas/BrowserNodeDataSchema";
import { browserStepSummary, configFromDraft, draftFromConfig, emptyDraft } from "../browserStep";

const role = { kind: "role", role: "button", name: "Sign in" } as const;

describe("browser step draft", () => {
  it.each([
    { action: "navigate", url: "{{env.BASE_URL}}/login" },
    { action: "fill", locator: { kind: "label", value: "Password" }, value: "{{secrets.TEST_PASSWORD}}" },
    { action: "click", locator: role, clickCount: 2, modifiers: ["Shift"], dialog: "accept" },
    { action: "press", locator: { kind: "testId", value: "search" }, key: "Enter" },
    { action: "press", key: "Escape" },
    { action: "select", locator: { kind: "label", value: "Plan" }, values: ["Pro"] },
    { action: "expect-visible", locator: role, visible: false },
    { action: "expect-text", locator: { kind: "role", role: "heading" }, text: "Welcome", match: "equals", timeoutMs: 5000 },
    { action: "expect-url", url: "/dashboard", match: "contains" },
    { action: "extract", locator: { kind: "css", value: "a.order" }, from: "attribute", attribute: "data-id", variable: "orderId" },
    { action: "extract", from: "title", variable: "pageTitle", description: "Remember the title", continueOnFail: true },
  ])("round-trips %j unchanged", (config) => {
    expect(configFromDraft(draftFromConfig(config))).toEqual(config);
    expect(BrowserNodeDataSchema.safeParse(config).success).toBe(true);
  });

  it("keeps a half-typed locator when the panel reopens", () => {
    const draft = draftFromConfig({ action: "click", locator: { kind: "role", role: "link", name: "" } });
    expect(draft.locator).toEqual({ kind: "role", role: "link", name: "" });
    expect(draftFromConfig({ action: "fill", locator: { kind: "label", value: "" }, value: "" }).locator).toEqual({ kind: "label", value: "" });
  });

  it("keeps the locator when the action changes, and stores only the new action's fields", () => {
    const draft = { ...draftFromConfig({ action: "click", locator: role, dialog: "accept" }), action: "fill" as const, value: "hello" };
    expect(configFromDraft(draft)).toEqual({ action: "fill", locator: role, value: "hello" });
  });

  it("starts a new step from defaults for a missing or unknown config", () => {
    expect(draftFromConfig(undefined)).toEqual(emptyDraft("click"));
    expect(draftFromConfig({ action: "teleport" }).action).toBe("click");
  });
});

describe("browserStepSummary", () => {
  it("describes the step in one line", () => {
    expect(browserStepSummary({ action: "click", locator: role })).toEqual({ operation: "click", argument: "getByRole('button', { name: 'Sign in' })" });
    expect(browserStepSummary({ action: "navigate", url: "{{env.BASE_URL}}/login" })).toEqual({ operation: "open", argument: "{{env.BASE_URL}}/login" });
    expect(browserStepSummary({ action: "extract", from: "url", variable: "next" })).toEqual({ operation: "save", argument: "{{variables.next}}" });
  });

  it("never shows what a fill types", () => {
    const summary = browserStepSummary({ action: "fill", locator: { kind: "label", value: "Password" }, value: "hunter2" });
    expect(JSON.stringify(summary)).not.toContain("hunter2");
  });
});
