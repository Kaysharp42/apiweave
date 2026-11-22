import type { BrowserAction } from "../types/BrowserAction"

/**
 * The browser actions in the order the panel offers them, with the words a
 * user reads. Shared so every path that names a step agrees: the recorder
 * names a placed step with it, and the write path gives an agent-authored
 * browser node without a label the same name.
 */
export const BROWSER_ACTIONS: readonly { readonly value: BrowserAction; readonly label: string }[] = [
  { value: "navigate", label: "Open a page" },
  { value: "click", label: "Click" },
  { value: "fill", label: "Type into a field" },
  { value: "press", label: "Press a key" },
  { value: "select", label: "Choose an option" },
  { value: "check", label: "Tick a checkbox" },
  { value: "uncheck", label: "Untick a checkbox" },
  { value: "hover", label: "Hover" },
  { value: "expect-visible", label: "Check it is visible" },
  { value: "expect-text", label: "Check text" },
  { value: "expect-value", label: "Check a field's value" },
  { value: "expect-url", label: "Check the page address" },
  { value: "extract", label: "Save a value" },
]

/**
 * A browser step's name when the author did not set one: the action's own
 * words ("Open a page", "Click", …), or "Browser step" for a config whose
 * action is missing or unknown.
 */
export function browserActionLabel(action: string): string {
  return BROWSER_ACTIONS.find((entry) => entry.value === action)?.label ?? "Browser step"
}
