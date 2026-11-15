import type { BrowserAction } from "@shared/types/BrowserAction";
import type { BrowserLocator } from "@shared/types/BrowserLocator";

/**
 * Every field any browser action can have, flat, as the config panel edits
 * them. Switching the action keeps what the user typed (a click turned into a
 * fill keeps its locator); the stored config holds only the fields the chosen
 * action uses (see `configFromDraft`).
 */
export interface BrowserStepDraft {
  action: BrowserAction;
  locator: BrowserLocator;
  url: string;
  value: string;
  text: string;
  key: string;
  values: string[];
  match: "equals" | "contains" | "matches";
  visible: boolean;
  from: "text" | "value" | "attribute" | "url" | "title";
  attribute: string;
  variable: string;
  dialog: "" | "accept" | "dismiss";
  button: "left" | "right" | "middle";
  clickCount: number;
  /** Keys held during a click. No editor yet; kept so an agent-written step survives an edit. */
  modifiers: ("Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift")[];
  /** A key press aimed at an element (focused first) rather than the page. */
  pressOnElement: boolean;
  /** Null: the action's default (10 s, 30 s for navigate). */
  timeoutMs: number | null;
  description: string;
  continueOnFail: boolean;
}
