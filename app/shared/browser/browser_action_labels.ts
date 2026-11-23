import type { BrowserAction } from "../types/BrowserAction"

/**
 * The browser actions in the order the panel offers them, with the words a
 * user reads. Shared so every path that names a step agrees: the recorder
 * names a placed step with `browserStepLabel`, and the write path gives an
 * agent-authored browser node without a label the same name.
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
 * The action's own words ("Open a page", "Click", …), or "Browser step" for a
 * config whose action is missing or unknown: a step's title when its target
 * names nothing.
 */
export function browserActionLabel(action: string): string {
  return BROWSER_ACTIONS.find((entry) => entry.value === action)?.label ?? "Browser step"
}

/** The longest target name a generated label carries before it is cut with an ellipsis. */
const NAME_MAX = 32

const PLACEHOLDER_NAME_RE = /\{\{\s*(?:variables|env)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function shortened(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > NAME_MAX ? `${flat.slice(0, NAME_MAX - 1).trimEnd()}…` : flat
}

/**
 * What a locator names the element by: a role's accessible name, the text of a
 * label/placeholder/text/alt/title/test-id locator, or the `hasText` filter of
 * a CSS selector or of a nameless role — an alert is known by its message.
 * "" when the locator names nothing a reader would recognise. A placeholder
 * reads as the name it stands for, `{{variables.client}}` as `client`: the
 * title names the variable, never its value.
 */
function targetName(locator: unknown): string {
  if (!isRecord(locator)) return ""
  const kind = locator["kind"]
  const field = kind === "role" ? (locator["name"] === undefined ? "hasText" : "name") : kind === "css" || kind === "selector" ? "hasText" : "value"
  const name = locator[field]
  return typeof name === "string" ? shortened(name.replace(PLACEHOLDER_NAME_RE, "$1")) : ""
}

/**
 * A page address as a reader recognises it: its path, or its host when the
 * path is the root. The query, fragment and any `user:password@` are dropped,
 * because those are where a URL carries tokens.
 */
function pageName(url: unknown): string {
  if (typeof url !== "string") return ""
  const bare = url.split(/[?#]/, 1)[0]!.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^@/]*@/, "")
  const slash = bare.indexOf("/")
  const path = slash === -1 ? "" : bare.slice(slash)
  return shortened(path === "" || path === "/" ? bare.slice(0, slash === -1 ? undefined : slash) : path)
}

/**
 * A browser step's generated title: a short verb and the name of what it acts
 * on, e.g. "Fill Email", "Click Continuer", "Choose Plan", "Open /login",
 * "Press Enter", "Expect Total visible". A step whose target names nothing
 * falls back to the action's own words.
 *
 * Only the target is ever named. A fill's text, a chosen option and an
 * expected text or value stay out: any of them can be a secret, and a label is
 * shown, stored and synced everywhere.
 */
// fallow-ignore-next-line complexity -- one case per browser action: the switch is the action table
export function browserStepLabel(config: unknown): string {
  const action = isRecord(config) && typeof config["action"] === "string" ? config["action"] : ""
  const fallback = browserActionLabel(action)
  if (!isRecord(config)) return fallback
  const name = targetName(config["locator"])
  const named = (text: string): string => (name === "" ? fallback : text)
  switch (action) {
    case "navigate": {
      const page = pageName(config["url"])
      return page === "" ? fallback : `Open ${page}`
    }
    case "click":
      return named(`${config["clickCount"] === 2 ? "Double-click" : "Click"} ${name}`)
    case "fill":
      return named(`Fill ${name}`)
    case "press":
      return typeof config["key"] === "string" && config["key"] !== "" ? `Press ${shortened(config["key"])}` : fallback
    case "select":
      return named(`Choose ${name}`)
    case "check":
      return named(`Tick ${name}`)
    case "uncheck":
      return named(`Untick ${name}`)
    case "hover":
      return named(`Hover ${name}`)
    case "expect-visible":
      return named(`Expect ${name} ${config["visible"] === false ? "hidden" : "visible"}`)
    case "expect-text":
      return named(`Expect ${name} text`)
    case "expect-value":
      return named(`Expect ${name} value`)
    case "expect-url": {
      // A pattern is not an address: "Expect URL ^/orders/\d+$" reads worse than the action's words.
      const page = config["match"] === "matches" ? "" : pageName(config["url"])
      return page === "" ? fallback : `Expect URL ${page}`
    }
    case "extract":
      return named(`Save ${name}`)
    default:
      return fallback
  }
}
