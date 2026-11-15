import type { BrowserLocator } from "@shared/types/BrowserLocator"
import { BrowserAriaRoleSchema, BrowserLocatorSchema } from "@shared/zod-schemas/BrowserLocatorSchema"

/** The chain part Playwright puts between an iframe and what is inside it. */
const ENTER_FRAME = "internal:control=enter-frame"

/** One element part of a chain, before `within` and `frame` are attached. */
type ElementLocator = Exclude<BrowserLocator, { kind: "selector" }>

/** A quoted value and the flag after it: `i` is a case-insensitive substring, `s` the exact string. */
interface Quoted {
  readonly value: string
  readonly exact: boolean
}

/**
 * Split a selector on its top-level `>>`, never inside a quoted string. Null
 * when a quote is left open or a part is empty: such a selector is kept whole.
 */
function splitChain(selector: string): string[] | null {
  const parts: string[] = []
  let start = 0
  let quote: string | null = null
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index]
    if (quote !== null) {
      if (char === "\\") index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === ">" && selector[index + 1] === ">") {
      parts.push(selector.slice(start, index).trim())
      start = index + 2
      index++
    }
  }
  if (quote !== null) return null
  parts.push(selector.slice(start).trim())
  return parts.every((part) => part !== "") ? parts : null
}

/** The flag after a quoted value: `i` or `s`. Anything else (a regular expression's flags) is not a string match. */
function flag(text: string, index: number): boolean | null {
  const rest = text.slice(index)
  if (rest === "i") return false
  if (rest === "s") return true
  return null
}

/** A `"…"i` written by `escapeForTextSelector` (`JSON.stringify` plus the flag). */
function readJsonQuoted(text: string): Quoted | null {
  const end = text.lastIndexOf('"')
  if (!text.startsWith('"') || end <= 0) return null
  const exact = flag(text, end + 1)
  if (exact === null) return null
  try {
    const value: unknown = JSON.parse(text.slice(0, end + 1))
    return typeof value === "string" ? { value, exact } : null
  } catch {
    return null
  }
}

/** A `"…"i` written by `escapeForAttributeSelector`, which escapes only `\` and `"`. */
function readAttributeQuoted(text: string): Quoted | null {
  const match = /^"((?:[^"\\]|\\.)*)"(.*)$/s.exec(text)
  if (match === null) return null
  const exact = flag(match[2] ?? "", 0)
  if (exact === null) return null
  return { value: (match[1] ?? "").replace(/\\(.)/gs, "$1"), exact }
}

function exactField(exact: boolean): { exact?: true } {
  return exact ? { exact: true } : {}
}

/** `internal:role=button[name="Sign in"i]`. Any property other than `name` (level, checked…) has no field here. */
function readRole(body: string): ElementLocator | null {
  const match = /^([a-z]+)(.*)$/s.exec(body)
  if (match === null) return null
  const role = BrowserAriaRoleSchema.safeParse(match[1])
  if (!role.success) return null
  const props = match[2] ?? ""
  if (props === "") return { kind: "role", role: role.data }
  const name = /^\[name=(.*)\]$/s.exec(props)
  const quoted = name === null ? null : readAttributeQuoted(name[1] ?? "")
  if (quoted === null) return null
  return { kind: "role", role: role.data, name: quoted.value, ...exactField(quoted.exact) }
}

/** `internal:attr=[placeholder="Search"i]`, and likewise `alt` and `title`. */
function readAttribute(body: string): ElementLocator | null {
  const match = /^\[(placeholder|alt|title)=(.*)\]$/s.exec(body)
  if (match === null) return null
  const quoted = readAttributeQuoted(match[2] ?? "")
  if (quoted === null) return null
  const kind = match[1] as "placeholder" | "alt" | "title"
  return { kind, value: quoted.value, ...exactField(quoted.exact) }
}

/** `internal:testid=[data-testid="result"s]`. Another attribute name is not what `getByTestId` reads by default. */
function readTestId(body: string): ElementLocator | null {
  const match = /^\[data-testid=(.*)\]$/s.exec(body)
  const quoted = match === null ? null : readAttributeQuoted(match[1] ?? "")
  return quoted === null ? null : { kind: "testId", value: quoted.value }
}

/** One element part of a chain, or null when no locator kind says the same thing. */
function readElement(part: string): ElementLocator | null {
  const engine = /^([a-zA-Z_:-]+)=(.*)$/s.exec(part)
  if (engine === null) {
    // No engine prefix: Playwright reads it as CSS, unless it is an XPath.
    return part.startsWith("/") || part.startsWith("(") || part.startsWith("..") ? null : { kind: "css", value: part }
  }
  const body = engine[2] ?? ""
  switch (engine[1]) {
    case "internal:role":
      return readRole(body)
    case "internal:label": {
      const quoted = readJsonQuoted(body)
      return quoted === null ? null : { kind: "label", value: quoted.value, ...exactField(quoted.exact) }
    }
    case "internal:text": {
      const quoted = readJsonQuoted(body)
      return quoted === null ? null : { kind: "text", value: quoted.value, ...exactField(quoted.exact) }
    }
    case "internal:attr":
      return readAttribute(body)
    case "internal:testid":
      return readTestId(body)
    case "css":
      return body === "" ? null : { kind: "css", value: body }
    default:
      return null
  }
}

/** `nth=2`, within the range the schema accepts. */
function readNth(part: string): number | null {
  const match = /^nth=(-?\d+)$/.exec(part)
  if (match === null) return null
  const nth = Number(match[1])
  return nth >= -1 && nth <= 1_000 ? nth : null
}

/** The chain as one structured locator, or null when any part has no structured equivalent. */
function readChain(parts: readonly string[]): BrowserLocator | null {
  let frame: string | undefined
  let current: BrowserLocator | undefined
  for (const part of parts) {
    if (part === ENTER_FRAME) {
      // One iframe, named by plain CSS. Nested frames have no field here.
      if (frame !== undefined || current?.kind !== "css") return null
      if (current.within !== undefined || current.hasText !== undefined || current.nth !== undefined) return null
      frame = current.value
      current = undefined
      continue
    }
    if (part.startsWith("internal:has-text=")) {
      const quoted = readJsonQuoted(part.slice("internal:has-text=".length))
      // `hasText` is a case-insensitive substring and is applied before `nth`.
      if (quoted === null || quoted.exact || current === undefined || current.hasText !== undefined || current.nth !== undefined) return null
      current = { ...current, hasText: quoted.value }
      continue
    }
    if (part.startsWith("nth=")) {
      const nth = readNth(part)
      if (nth === null || current === undefined || current.nth !== undefined) return null
      current = { ...current, nth }
      continue
    }
    const element = readElement(part)
    if (element === null) return null
    current = current === undefined ? element : { ...element, within: current }
  }
  if (current === undefined) return null
  return frame === undefined ? current : { ...current, frame }
}

/**
 * Turn a selector Playwright's recorder wrote (`internal:role=button[name="Sign in"i]`,
 * `… >> internal:control=enter-frame >> …`) into a structured locator: the
 * fields an agent or a user edits, and the public Playwright calls a run makes.
 * A part with no structured equivalent (a role's `level`, an exact `has-text`,
 * a nested frame, XPath) keeps the whole selector as `{ kind: "selector" }`,
 * which a run hands to `page.locator()` unchanged. Null only when even that
 * does not fit the schema (a selector over its length limit).
 */
export function parseRecordedSelector(selector: string): BrowserLocator | null {
  const parts = splitChain(selector)
  const structured = parts === null ? null : readChain(parts)
  if (structured !== null && BrowserLocatorSchema.safeParse(structured).success) return structured
  const fallback: BrowserLocator = { kind: "selector", value: selector }
  return BrowserLocatorSchema.safeParse(fallback).success ? fallback : null
}
