import { describeLocator } from "@shared/browser/describe_locator";
import { BROWSER_ACTIONS } from "@shared/browser/browser_action_labels";
import { BrowserLocatorSchema } from "@shared/zod-schemas/BrowserLocatorSchema";
import type { BrowserAction } from "@shared/types/BrowserAction";
import type { BrowserLocator } from "@shared/types/BrowserLocator";
import type { BrowserStepResult } from "@shared/types/BrowserStepResult";
import type { BrowserStepDraft } from "../types/BrowserStepDraft";

const MODIFIERS: readonly BrowserStepDraft["modifiers"][number][] = ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"];

/** Actions that act on an element and so need a locator. */
const NEEDS_LOCATOR: ReadonlySet<BrowserAction> = new Set([
  "click", "fill", "check", "uncheck", "select", "hover", "expect-visible", "expect-text", "expect-value",
]);

export function actionNeedsLocator(action: BrowserAction): boolean {
  return NEEDS_LOCATOR.has(action);
}

/** An extract reads an element unless it reads the page's address or title. */
export function extractNeedsLocator(from: BrowserStepDraft["from"]): boolean {
  return from === "text" || from === "value" || from === "attribute";
}

/** The comparison a step uses when its config names none: a field value is compared whole, text and URLs by substring. */
export function defaultMatch(action: BrowserAction): BrowserStepDraft["match"] {
  return action === "expect-value" ? "equals" : "contains";
}

const DEFAULT_LOCATOR: BrowserLocator = { kind: "role", role: "button", name: "" };

export function emptyDraft(action: BrowserAction = "click"): BrowserStepDraft {
  return {
    action,
    locator: DEFAULT_LOCATOR,
    url: "",
    value: "",
    text: "",
    key: "Enter",
    values: [""],
    match: defaultMatch(action),
    visible: true,
    from: "text",
    attribute: "",
    variable: "",
    dialog: "",
    button: "left",
    clickCount: 1,
    modifiers: [],
    pressOnElement: false,
    timeoutMs: null,
    description: "",
    continueOnFail: false,
  };
}

function text(config: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/**
 * A locator as stored, read leniently: a half-typed one (an empty name the
 * schema would refuse) is kept as the user left it, rather than reset.
 */
function readLocator(raw: unknown): BrowserLocator | undefined {
  const strict = BrowserLocatorSchema.safeParse(raw);
  if (strict.success) return strict.data;
  if (typeof raw !== "object" || raw === null) return undefined;
  const loose = raw as Readonly<Record<string, unknown>>;
  if (loose["kind"] === "role" && typeof loose["role"] === "string") {
    const role = BrowserLocatorSchema.safeParse({ kind: "role", role: loose["role"] });
    if (role.success && role.data.kind === "role") return { ...role.data, name: typeof loose["name"] === "string" ? loose["name"] : "" };
  }
  if (typeof loose["kind"] === "string") {
    const filled = BrowserLocatorSchema.safeParse({ kind: loose["kind"], value: "x" });
    if (filled.success && filled.data.kind !== "role") return { ...filled.data, value: typeof loose["value"] === "string" ? loose["value"] : "" };
  }
  return undefined;
}

/** The panel's draft for a stored config, whatever state the config is in. */
export function draftFromConfig(config: Readonly<Record<string, unknown>> | undefined): BrowserStepDraft {
  const stored = config ?? {};
  const action = BROWSER_ACTIONS.find((entry) => entry.value === stored["action"])?.value ?? "click";
  const base = emptyDraft(action);
  const values = stored["values"];
  const modifiers = stored["modifiers"];
  const storedLocator = readLocator(stored["locator"]);
  return {
    ...base,
    locator: storedLocator ?? base.locator,
    pressOnElement: action === "press" && storedLocator !== undefined,
    modifiers: Array.isArray(modifiers) ? modifiers.flatMap((item) => MODIFIERS.filter((modifier) => modifier === item)) : [],
    url: text(stored, "url", base.url),
    value: text(stored, "value", base.value),
    text: text(stored, "text", base.text),
    key: text(stored, "key", base.key),
    values: Array.isArray(values) && values.every((item) => typeof item === "string") ? [...values] : base.values,
    match: oneOf(stored["match"], ["equals", "contains", "matches"] as const, base.match),
    visible: typeof stored["visible"] === "boolean" ? stored["visible"] : base.visible,
    from: oneOf(stored["from"], ["text", "value", "attribute", "url", "title"] as const, base.from),
    attribute: text(stored, "attribute", base.attribute),
    variable: text(stored, "variable", base.variable),
    dialog: stored["dialog"] === "accept" || stored["dialog"] === "dismiss" ? stored["dialog"] : "",
    button: oneOf(stored["button"], ["left", "right", "middle"] as const, base.button),
    clickCount: typeof stored["clickCount"] === "number" ? stored["clickCount"] : base.clickCount,
    timeoutMs: typeof stored["timeoutMs"] === "number" ? stored["timeoutMs"] : null,
    description: text(stored, "description", base.description),
    continueOnFail: stored["continueOnFail"] === true,
  };
}

/**
 * The stored config for a draft: the action's own fields only, optional
 * fields left out at their defaults, so the workflow JSON reads like what an
 * agent would write.
 */
// fallow-ignore-next-line complexity -- one case per browser action: the switch is the action table
export function configFromDraft(draft: BrowserStepDraft): Record<string, unknown> {
  const common: Record<string, unknown> = {
    ...(draft.timeoutMs !== null ? { timeoutMs: draft.timeoutMs } : {}),
    ...(draft.description.trim() !== "" ? { description: draft.description } : {}),
    ...(draft.continueOnFail ? { continueOnFail: true } : {}),
  };
  const dialog = draft.dialog === "" ? {} : { dialog: draft.dialog };
  switch (draft.action) {
    case "navigate":
      return { action: "navigate", url: draft.url, ...common };
    case "click":
      return {
        action: "click",
        locator: draft.locator,
        ...(draft.button !== "left" ? { button: draft.button } : {}),
        ...(draft.clickCount !== 1 ? { clickCount: draft.clickCount } : {}),
        ...(draft.modifiers.length > 0 ? { modifiers: draft.modifiers } : {}),
        ...dialog,
        ...common,
      };
    case "fill":
      return { action: "fill", locator: draft.locator, value: draft.value, ...common };
    case "press":
      return { action: "press", ...(draft.pressOnElement ? { locator: draft.locator } : {}), key: draft.key, ...dialog, ...common };
    case "check":
    case "uncheck":
    case "hover":
      return { action: draft.action, locator: draft.locator, ...common };
    case "select":
      return { action: "select", locator: draft.locator, values: draft.values, ...common };
    case "expect-visible":
      return { action: "expect-visible", locator: draft.locator, ...(draft.visible ? {} : { visible: false }), ...common };
    case "expect-text":
      return { action: "expect-text", locator: draft.locator, text: draft.text, match: draft.match, ...common };
    case "expect-value":
      return {
        action: "expect-value",
        locator: draft.locator,
        value: draft.value,
        ...(draft.match !== "equals" ? { match: draft.match } : {}),
        ...common,
      };
    case "expect-url":
      return { action: "expect-url", url: draft.url, match: draft.match, ...common };
    case "extract":
      return {
        action: "extract",
        ...(extractNeedsLocator(draft.from) ? { locator: draft.locator } : {}),
        from: draft.from,
        ...(draft.from === "attribute" ? { attribute: draft.attribute } : {}),
        variable: draft.variable,
        ...common,
      };
  }
}

function quoted(value: string): string {
  return value.length > 40 ? `"${value.slice(0, 39)}…"` : `"${value}"`;
}

/**
 * One line saying what a step does, for the canvas: `Click getByRole('button',
 * { name: 'Save' })`, `Open /login`, `Check text "Welcome"`. A fill never shows
 * its value: it may be a password typed as a literal.
 */
// fallow-ignore-next-line complexity -- one case per browser action: the switch is the action table
export function browserStepSummary(config: Readonly<Record<string, unknown>> | undefined): { operation: string; argument?: string } {
  const draft = draftFromConfig(config);
  const target = describeLocator(draft.locator);
  switch (draft.action) {
    case "navigate":
      return { operation: "open", ...(draft.url ? { argument: draft.url } : {}) };
    case "click":
      return { operation: draft.clickCount === 2 ? "double-click" : "click", argument: target };
    case "fill":
      return { operation: "type into", argument: target };
    case "press":
      return { operation: "press", argument: draft.key };
    case "select":
      return { operation: "choose", argument: draft.values.join(", ") };
    case "check":
    case "uncheck":
    case "hover":
      return { operation: draft.action, argument: target };
    case "expect-visible":
      return { operation: draft.visible ? "expect visible" : "expect hidden", argument: target };
    case "expect-text":
      return { operation: `expect text ${draft.match}`, argument: quoted(draft.text) };
    case "expect-value":
      return { operation: draft.match === "equals" ? "expect value" : `expect value ${draft.match}`, argument: quoted(draft.value) };
    case "expect-url":
      return { operation: `expect URL ${draft.match}`, argument: draft.url };
    case "extract":
      return { operation: "save", argument: draft.variable ? `{{variables.${draft.variable}}}` : "a value" };
  }
}

/**
 * What a run found on the page, as label/value rows: where it was, and for a
 * check what it expected and found (for `extract`, the value read).
 */
export function browserStepFacts(step: BrowserStepResult | undefined): ReadonlyArray<readonly [string, string]> {
  if (step === undefined) return [];
  const facts: Array<readonly [string, string]> = [];
  if (step.url !== undefined) facts.push(["address", step.url]);
  if (step.expected !== undefined) {
    facts.push(["expected", step.expected], ["found", step.actual ?? "nothing: the element was not found"]);
  } else if (step.actual !== undefined) {
    facts.push(["value", step.actual]);
  }
  return facts;
}
