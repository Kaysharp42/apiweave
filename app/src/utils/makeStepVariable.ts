import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasNode } from "../types/CanvasNode";
import type { MakeStepVariableChoice } from "../types/MakeStepVariableChoice";
import type { StepLiteral } from "../types/StepLiteral";
import type { StepLiteralField } from "../types/StepLiteralField";
import { INVALID_VARIABLE_NAME_MESSAGE, isValidVariableName } from "./extractorVariableName";
import { hasGeneratedLabel, recordedStepLabel } from "./recordedSteps";

type Config = Readonly<Record<string, unknown>>;
type Variables = Readonly<Record<string, JsonValue>>;

/** A field holding any placeholder is already templated, wholly or in part: it is left alone. */
const PLACEHOLDER_RE = /\{\{[^{}]*\}\}/;

/**
 * A field a fill must never move into a variable: variables are stored, shown
 * and synced in the clear. The recorder already types a password as
 * `{{secrets.NAME}}`; this keeps a hand-typed one out too.
 */
const SECRET_FIELD_RE = /password|passwd|passcode|secret|token|api[\s_-]?key|\bpin\b/i;

/** The locator kinds whose `value` is text a reader recognises, with the word for it. */
const LOCATOR_VALUE_WORDS: Readonly<Record<string, string>> = {
  label: "label",
  placeholder: "placeholder",
  text: "text",
  alt: "alt text",
  title: "title",
  testId: "test id",
};

function isRecord(value: unknown): value is Config {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configOf(node: CanvasNode): Config {
  return node.data.config ?? {};
}

function locatorOf(config: Config): Config | undefined {
  const locator = config["locator"];
  return isRecord(locator) ? locator : undefined;
}

/** `Search client` → `searchClient`; "" when the text has no letter to start a name with. */
export function camelName(text: string): string {
  const words = text.replace(/^[^A-Za-z]+/, "").match(/[A-Za-z0-9]+/g) ?? [];
  return words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join("")
    .slice(0, 40);
}

/** What the locator names its element by, a placeholder read as the name it stands for. */
function targetName(locator: Config | undefined): string {
  if (locator === undefined) return "";
  const kind = locator["kind"];
  const field = kind === "role" ? "name" : kind === "css" || kind === "selector" ? "hasText" : "value";
  const name = locator[field];
  return typeof name === "string" ? name.replace(/\{\{\s*(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*\}\}/g, "$1") : "";
}

function readField(config: Config, field: StepLiteralField): unknown {
  if (field.startsWith("locator.")) return locatorOf(config)?.[field.slice("locator.".length)];
  if (field.startsWith("values.")) {
    const values = config["values"];
    return Array.isArray(values) ? values[Number(field.slice("values.".length))] : undefined;
  }
  return config[field];
}

function writeField(config: Config, field: StepLiteralField, text: string): Record<string, unknown> {
  if (field.startsWith("locator.")) {
    return { ...config, locator: { ...locatorOf(config), [field.slice("locator.".length)]: text } };
  }
  if (field.startsWith("values.")) {
    const index = Number(field.slice("values.".length));
    const values = config["values"];
    return { ...config, values: Array.isArray(values) ? values.map((value: unknown, at) => (at === index ? text : value)) : values };
  }
  return { ...config, [field]: text };
}

/** The action's own value fields, with the words for each. */
function valueFields(config: Config): ReadonlyArray<readonly [StepLiteralField, string]> {
  switch (config["action"]) {
    case "fill":
      return SECRET_FIELD_RE.test(targetName(locatorOf(config))) ? [] : [["value", "Typed text"]];
    case "select": {
      const values = config["values"];
      if (!Array.isArray(values)) return [];
      return values.map((_value: unknown, index) => [`values.${index}`, values.length > 1 ? `Option ${index + 1}` : "Option"] as const);
    }
    case "expect-text":
      return [["text", "Expected text"]];
    case "expect-value":
      return [["value", "Expected value"]];
    default:
      return [];
  }
}

/** The locator's text fields, with the words for each. `within` and `frame` are left as they are. */
function locatorFields(locator: Config | undefined): ReadonlyArray<readonly [StepLiteralField, string]> {
  if (locator === undefined) return [];
  const kind = locator["kind"];
  const fields: Array<readonly [StepLiteralField, string]> = [];
  if (kind === "role") fields.push(["locator.name", `Element name (${String(locator["role"])})`]);
  const word = typeof kind === "string" ? LOCATOR_VALUE_WORDS[kind] : undefined;
  if (word !== undefined) fields.push(["locator.value", `Element ${word}`]);
  fields.push(["locator.hasText", "Element text filter"]);
  return fields;
}

/**
 * The literals in a browser step that can become a workflow variable: the
 * action's value fields (a fill's text, a select's options, an expected text
 * or value) and the text its locator finds the element by. A field that is
 * empty or already holds a placeholder is not one; nor is a fill into a
 * field that looks like it takes a secret.
 */
export function stepLiterals(node: CanvasNode): StepLiteral[] {
  if (node.type !== "browser") return [];
  const config = configOf(node);
  return [...valueFields(config), ...locatorFields(locatorOf(config))].flatMap(([field, description]) => {
    const value = readField(config, field);
    return typeof value === "string" && value.trim() !== "" && !PLACEHOLDER_RE.test(value) ? [{ field, description, value }] : [];
  });
}

/** Whether the step menu offers **Make value a variable** for this node. */
export function canMakeStepVariable(node: CanvasNode): boolean {
  return stepLiterals(node).length > 0;
}

function holdsOther(variables: Variables, name: string, value: string): boolean {
  return Object.prototype.hasOwnProperty.call(variables, name) && variables[name] !== value;
}

/** The name a value field's variable starts from: what its element is called. */
function valueFieldName(config: Config, field: StepLiteralField): string {
  const fromTarget = camelName(targetName(locatorOf(config)));
  if (fromTarget !== "") return fromTarget;
  return field.startsWith("values.") ? "option" : field === "text" ? "expectedText" : "value";
}

/** The name a locator field's variable starts from: the element's role or kind. */
function locatorFieldName(config: Config, field: StepLiteralField): string {
  const locator = locatorOf(config);
  if (field === "locator.hasText") return "filterText";
  if (field === "locator.name") return `${camelName(String(locator?.["role"] ?? "element")) || "element"}Name`;
  const word = LOCATOR_VALUE_WORDS[String(locator?.["kind"])] ?? "value";
  return camelName(`element ${word}`);
}

/**
 * A name for the variable `field` becomes: the element's name for a value
 * field (`Search client` → `searchClient`), `<role>Name` for a role's name.
 * A name already holding the same value is reused; one holding another value
 * gets a numeric suffix.
 */
export function suggestedStepVariableName(node: CanvasNode, field: StepLiteralField, variables: Variables): string {
  const config = configOf(node);
  const value = readField(config, field);
  const literal = typeof value === "string" ? value : "";
  const base = field.startsWith("locator.") ? locatorFieldName(config, field) : valueFieldName(config, field);
  if (!holdsOther(variables, base, literal)) return base;
  let suffix = 2;
  while (holdsOther(variables, `${base}${suffix}`, literal)) suffix++;
  return `${base}${suffix}`;
}

/** Why `name` cannot hold `value`, or undefined when it can: a variable with the same value is reused. */
export function stepVariableNameError(name: string, value: string, variables: Variables): string | undefined {
  if (name === "") return "Give the variable a name.";
  if (!isValidVariableName(name)) return INVALID_VARIABLE_NAME_MESSAGE;
  if (holdsOther(variables, name, value)) return `${name} already holds a different value. Pick another name.`;
  return undefined;
}

/** The other browser steps with a field holding exactly `value`, whole-field. */
export function stepsSharingLiteral(nodes: readonly CanvasNode[], nodeId: string, value: string): number {
  return nodes.filter((node) => node.id !== nodeId && stepLiterals(node).some((literal) => literal.value === value)).length;
}

/**
 * The canvas with the chosen literal replaced by `{{variables.<name>}}`: in
 * that field only, or — `everywhere` — in every eligible field of every
 * browser step holding exactly the same text. A step whose title is still the
 * generated one is retitled, so the title stops naming the old text. Null when
 * the field holds no literal any more.
 */
export function makeStepVariable(
  nodes: readonly CanvasNode[],
  nodeId: string,
  choice: MakeStepVariableChoice,
): { readonly nodes: CanvasNode[]; readonly value: string; readonly steps: number } | null {
  const source = nodes.find((node) => node.id === nodeId);
  const value = source === undefined ? undefined : stepLiterals(source).find((literal) => literal.field === choice.field)?.value;
  if (value === undefined) return null;
  const placeholder = `{{variables.${choice.name}}}`;
  let steps = 0;
  const next = nodes.map((node) => {
    const fields = choice.everywhere
      ? stepLiterals(node).filter((literal) => literal.value === value).map((literal) => literal.field)
      : node.id === nodeId
        ? [choice.field]
        : [];
    if (fields.length === 0) return node;
    steps++;
    const config = fields.reduce<Record<string, unknown>>((current, field) => writeField(current, field, placeholder), { ...configOf(node) });
    const generated = hasGeneratedLabel(node.data.label, node.data.config);
    // A new `data` object: auto-save tells edits apart by its identity.
    return { ...node, data: { ...node.data, config, ...(generated ? { label: recordedStepLabel(config) } : {}) } };
  });
  return { nodes: next, value, steps };
}
