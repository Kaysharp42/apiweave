import { locatorTargetText } from "@shared/browser/browser_action_labels";
import type { CanvasNode } from "../types/CanvasNode";
import type { MakeStepVariableChoice } from "../types/MakeStepVariableChoice";
import type { StepConfig } from "../types/StepConfig";
import type { StepLiteral } from "../types/StepLiteral";
import type { StepLiteralField } from "../types/StepLiteralField";
import type { StepVariableDraft } from "../types/StepVariableDraft";
import type { StepVariables } from "../types/StepVariables";
import { INVALID_VARIABLE_NAME_MESSAGE, isValidVariableName } from "./extractorVariableName";
import { withStepConfig } from "./recordedSteps";

/** A field holding any placeholder is already templated, wholly or in part: it is left alone. */
const PLACEHOLDER_RE = /\{\{[^{}]*\}\}/;

/**
 * A field a fill must never move into a variable: variables are stored, shown
 * and synced in the clear. The recorder already types a password as
 * `{{secrets.NAME}}`; this keeps a hand-typed one out too, whether the locator
 * names the field in words or selects it by CSS, and in the languages a
 * recording is made in. It reads every piece of text a locator holds: a CSS
 * selector like `input[type=password]` names a password field without a label.
 */
const SECRET_FIELD_RE =
  /password|passwd|passcode|secret|token|api[\s_-]?key|\bpin\b|\bpwd\b|mot\s+de\s+passe|passwort|contrase[nñ]a|senha|wachtwoord|l[öo]senord|has[łl]o|parola|パスワード|密码/i;

/** The locator kinds whose `value` is text a reader recognises, with the word for it. */
const LOCATOR_VALUE_WORDS: Readonly<Record<string, string>> = {
  label: "label",
  placeholder: "placeholder",
  text: "text",
  alt: "alt text",
  title: "title",
  testId: "test id",
};

function isRecord(value: unknown): value is StepConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configOf(node: CanvasNode): StepConfig {
  return node.data.config ?? {};
}

function locatorOf(config: StepConfig): StepConfig | undefined {
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

/**
 * What the locator names its element by — the text the step title names it
 * by — any placeholder read as the name it stands for.
 */
function targetName(locator: StepConfig | undefined): string {
  const name = locatorTargetText(locator);
  return name === undefined ? "" : name.replace(/\{\{\s*(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s*\}\}/g, "$1");
}

/** Every piece of text a locator holds, to tell what kind of field it finds. */
function locatorText(locator: StepConfig | undefined): string {
  if (locator === undefined) return "";
  return [locator["name"], locator["value"], locator["hasText"]]
    .filter((text): text is string => typeof text === "string")
    .join(" ");
}

function readField(config: StepConfig, field: StepLiteralField): unknown {
  if (field.startsWith("locator.")) return locatorOf(config)?.[field.slice("locator.".length)];
  if (field.startsWith("values.")) {
    const values = config["values"];
    return Array.isArray(values) ? values[Number(field.slice("values.".length))] : undefined;
  }
  return config[field];
}

function writeField(config: StepConfig, field: StepLiteralField, text: string): Record<string, unknown> {
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
function valueFields(config: StepConfig): ReadonlyArray<readonly [StepLiteralField, string]> {
  switch (config["action"]) {
    case "fill":
      return SECRET_FIELD_RE.test(locatorText(locatorOf(config))) ? [] : [["value", "Typed text"]];
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
function locatorFields(locator: StepConfig | undefined): ReadonlyArray<readonly [StepLiteralField, string]> {
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

/** A literal shortened to fit one line of the dialog. */
export function previewStepLiteral(value: string): string {
  return value.length > 60 ? `${value.slice(0, 59)}…` : value;
}

/** Whether the step menu offers **Make value a variable** for this node. */
export function canMakeStepVariable(node: CanvasNode): boolean {
  return stepLiterals(node).length > 0;
}

function holdsOther(variables: StepVariables, name: string, value: string): boolean {
  return Object.prototype.hasOwnProperty.call(variables, name) && variables[name] !== value;
}

/** The name a value field's variable starts from: what its element is called. */
function valueFieldName(config: StepConfig, field: StepLiteralField): string {
  const fromTarget = camelName(targetName(locatorOf(config)));
  if (fromTarget !== "") return fromTarget;
  return field.startsWith("values.") ? "option" : field === "text" ? "expectedText" : "value";
}

/** The name a locator field's variable starts from: the element's role or kind. */
function locatorFieldName(config: StepConfig, field: StepLiteralField): string {
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
export function suggestedStepVariableName(node: CanvasNode, field: StepLiteralField, variables: StepVariables): string {
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
export function stepVariableNameError(name: string, value: string, variables: StepVariables): string | undefined {
  if (name === "") return "Give the variable a name.";
  if (!isValidVariableName(name)) return INVALID_VARIABLE_NAME_MESSAGE;
  if (holdsOther(variables, name, value)) return `${name} already holds a different value. Pick another name.`;
  return undefined;
}

/** Whether a field is part of the element's locator rather than the action's own value. */
function isLocatorField(field: StepLiteralField): boolean {
  return field.startsWith("locator.");
}

/** The fields of `node` in the same family as `field` holding exactly `value`, whole-field. */
function sameFamilyFields(node: CanvasNode, field: StepLiteralField, value: string): StepLiteralField[] {
  return stepLiterals(node)
    .filter((literal) => literal.value === value && isLocatorField(literal.field) === isLocatorField(field))
    .map((literal) => literal.field);
}

/**
 * The other browser steps with a field of the same family as `field` holding
 * exactly `value`, whole-field. A value field and a locator field are never
 * counted together: the text a fill types and the text that finds a button can
 * be the same word, and only one of them is data.
 */
export function stepsSharingLiteral(nodes: readonly CanvasNode[], nodeId: string, field: StepLiteralField, value: string): number {
  return nodes.filter((node) => node.id !== nodeId && sameFamilyFields(node, field, value).length > 0).length;
}

/** What **Make value a variable** shows for `node`'s literal in `field` and the name typed so far. */
export function stepVariableDraft(
  nodes: readonly CanvasNode[],
  node: CanvasNode | undefined,
  field: StepLiteralField | undefined,
  typed: string,
  variables: StepVariables,
): StepVariableDraft {
  const name = typed.trim();
  const literal = node === undefined ? undefined : stepLiterals(node).find((candidate) => candidate.field === field);
  if (node === undefined || literal === undefined) {
    return { literal: undefined, name, error: undefined, others: 0, reused: false, family: "value" };
  }
  const error = stepVariableNameError(name, literal.value, variables);
  return {
    literal,
    name,
    error,
    others: stepsSharingLiteral(nodes, node.id, literal.field, literal.value),
    reused: error === undefined && variables[name] === literal.value,
    family: isLocatorField(literal.field) ? "element text" : "value",
  };
}

/**
 * The canvas with the chosen literal replaced by `{{variables.<name>}}`: in
 * that field only, or — `everywhere` — in every eligible field of the same
 * family in every browser step holding exactly the same text. A value field
 * (a fill's text, a select's option, an expected text or value) and a locator
 * field (the name, value or `hasText` that finds an element) are different
 * families: a fill typing "Search" must not turn the button named "Search"
 * into a variable, or the lookup breaks when the variable changes. A step
 * whose title is still the generated one is retitled, so the title stops
 * naming the old text. Null when the field holds no literal any more.
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
      ? sameFamilyFields(node, choice.field, value)
      : node.id === nodeId
        ? [choice.field]
        : [];
    if (fields.length === 0) return node;
    steps++;
    return withStepConfig(
      node,
      fields.reduce<Record<string, unknown>>((current, field) => writeField(current, field, placeholder), { ...configOf(node) }),
    );
  });
  return { nodes: next, value, steps };
}
