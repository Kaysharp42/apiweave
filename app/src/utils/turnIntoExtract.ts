import { BrowserLocatorSchema } from "@shared/zod-schemas/BrowserLocatorSchema";
import type { BrowserStepDraft } from "../types/BrowserStepDraft";
import type { CanvasNode } from "../types/CanvasNode";
import { configFromDraft, draftFromConfig } from "./browserStep";
import { recordedStepLabel } from "./recordedSteps";

/** Steps on a form field read its value; any other element is read for its text. */
const READS_VALUE: ReadonlySet<string> = new Set(["fill", "select", "expect-value"]);

function configOf(node: CanvasNode): Readonly<Record<string, unknown>> {
  return node.data.config ?? {};
}

/** A browser step that acts on an element and is not already an extract. */
export function canTurnIntoExtract(node: CanvasNode): boolean {
  const config = configOf(node);
  return node.type === "browser" && config["action"] !== "extract" && BrowserLocatorSchema.safeParse(config["locator"]).success;
}

/** A variable name drawn from what the locator names: `Order number` → `orderNumber`, `#total` → `total`. */
export function suggestedVariableName(node: CanvasNode): string {
  const { locator } = draftFromConfig(configOf(node));
  const source = locator.kind === "role" ? (locator.name ?? "") : locator.value;
  // A name may not start with a digit: begin at the first letter.
  const words = source.replace(/^[^A-Za-z]+/, "").match(/[A-Za-z0-9]+/g) ?? [];
  const name = words
    .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join("")
    .slice(0, 40);
  return name === "" ? "value" : name;
}

/**
 * The same step reading its element into `{{variables.<variable>}}` instead:
 * the element stays, the action's own fields go. A form field is read for its
 * value, anything else for its text. The title follows the action unless the
 * user renamed the step.
 */
export function turnIntoExtract(node: CanvasNode, variable: string): CanvasNode {
  const draft = draftFromConfig(configOf(node));
  const from: BrowserStepDraft["from"] = READS_VALUE.has(draft.action) ? "value" : "text";
  const config = configFromDraft({ ...draft, action: "extract", from, variable, attribute: "" });
  const label = node.data.label;
  const renamed = typeof label === "string" && label !== "" && label !== recordedStepLabel(draft.action);
  return {
    ...node,
    // A new `data` object: auto-save tells edits apart by its identity.
    data: { ...node.data, config, ...(renamed ? {} : { label: recordedStepLabel("extract") }) },
  };
}
