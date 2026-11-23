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

/** A chain read so far: the iframe it entered, and the locator built up to here. */
interface Chain {
  readonly frame?: string
  readonly current?: BrowserLocator
}

const HAS_TEXT = "internal:has-text="

/** `… >> internal:control=enter-frame`: one iframe, named by plain CSS. Nested frames have no field here. */
function enterFrame(chain: Chain): Chain | null {
  const { frame, current } = chain
  if (frame !== undefined || current?.kind !== "css") return null
  if (current.within !== undefined || current.hasText !== undefined || current.nth !== undefined) return null
  return { frame: current.value }
}

/** `… >> internal:has-text="…"i`: a case-insensitive substring, applied before `nth`. */
function addHasText(chain: Chain, part: string): Chain | null {
  const quoted = readJsonQuoted(part.slice(HAS_TEXT.length))
  const { current } = chain
  if (quoted === null || quoted.exact || current === undefined || current.hasText !== undefined || current.nth !== undefined) return null
  return { ...chain, current: { ...current, hasText: quoted.value } }
}

function addNth(chain: Chain, part: string): Chain | null {
  const nth = readNth(part)
  const { current } = chain
  if (nth === null || current === undefined || current.nth !== undefined) return null
  return { ...chain, current: { ...current, nth } }
}

/** `A >> B`: B searched inside A. */
function addElement(chain: Chain, part: string): Chain | null {
  const element = readElement(part)
  if (element === null) return null
  return { ...chain, current: chain.current === undefined ? element : { ...element, within: chain.current } }
}

function readPart(chain: Chain, part: string): Chain | null {
  if (part === ENTER_FRAME) return enterFrame(chain)
  if (part.startsWith(HAS_TEXT)) return addHasText(chain, part)
  if (part.startsWith("nth=")) return addNth(chain, part)
  return addElement(chain, part)
}

/** The chain as one structured locator, or null when any part has no structured equivalent. */
function readChain(parts: readonly string[]): BrowserLocator | null {
  let chain: Chain | null = {}
  for (const part of parts) {
    chain = readPart(chain, part)
    if (chain === null) return null
  }
  const { frame, current } = chain
  if (current === undefined) return null
  return frame === undefined ? current : { ...current, frame }
}

/** The longest accessible name worth turning into a locator; a whole page's text is not one. */
const ROLE_NAME_MAX_CHARS = 200

/**
 * `internal:role=heading` with the element's accessible name added:
 * `internal:role=heading[name="Mechanical keyboard"i]`. Null unless the
 * selector is exactly a bare role, and the name is short enough to be one.
 *
 * Playwright's recorder writes a bare role whenever that role is unique on the
 * page at pick time, dropping the name the element has. The next page the run
 * sees can hold a dozen headings — a client-side route change leaves the old
 * page up for a moment — and the step then fails on strict mode or checks the
 * wrong element. The name is how the accessibility tree already identifies
 * what the user picked, so a recorded step keeps it.
 */
export function roleSelectorWithName(selector: string, name: string): string | null {
  const match = /^internal:role=([a-z]+)$/.exec(selector)
  if (match === null) return null
  return roleSelector(match[1] ?? "", name, false)
}

/** `"…"i` or `"…"s` the way Playwright's `escapeForAttributeSelector` writes it. */
function attributeQuoted(value: string, exact: boolean): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"${exact ? "s" : "i"}`
}

/** A usable name or text for a selector: trimmed, and short enough to be a name rather than a page's text. */
function usable(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === "" || trimmed.length > ROLE_NAME_MAX_CHARS ? null : trimmed
}

/** `page.getByRole(role, { name, exact })` as a selector, or null for a name that cannot be one. */
export function roleSelector(role: string, name: string, exact: boolean): string | null {
  const value = usable(name)
  return value === null ? null : `internal:role=${role}[name=${attributeQuoted(value, exact)}]`
}

/** `page.getByLabel(value, { exact })` as a selector. */
export function labelSelector(text: string, exact: boolean): string | null {
  const value = usable(text)
  return value === null ? null : `internal:label=${JSON.stringify(value)}${exact ? "s" : "i"}`
}

/** `page.getByPlaceholder(value, { exact })` as a selector. */
export function placeholderSelector(text: string, exact: boolean): string | null {
  const value = usable(text)
  return value === null ? null : `internal:attr=[placeholder=${attributeQuoted(value, exact)}]`
}

/** `page.getByText(value, { exact: true })` as a selector. */
export function exactTextSelector(text: string): string | null {
  const value = usable(text)
  return value === null ? null : `internal:text=${JSON.stringify(value)}s`
}

/** Regular-expression syntax: a regex using any of these unescaped matches more than one string. */
const REGEX_SYNTAX = new Set([..."\\^$.*+?()[]{}|/"])

/**
 * The text X of a `internal:has-text=/^X$/` part: the whole-text match
 * Playwright's recorder writes for an element whose text is not unique as a
 * substring. Null for any other pattern — flags, or regex syntax that is not
 * an escaped literal character — because only a literal is an exact text.
 */
export function exactHasText(selector: string): string | null {
  // Not through `splitChain`: a regex escapes a quote as `\"` outside any string,
  // which the chain splitter would read as a string left open.
  const match = /(?:^|>>\s*)internal:has-text=\/\^((?:[^\\]|\\.)*?)\$\/\s*(?:>>|$)/s.exec(selector)
  if (match === null) return null
  let text = ""
  const body = match[1] ?? ""
  for (let index = 0; index < body.length; index++) {
    const char = body[index] ?? ""
    if (char === "\\") {
      index++
      // `\d`, `\s`… are classes, not the escaped letter.
      const next = body[index]
      if (next === undefined || /[A-Za-z0-9]/.test(next)) return null
      text += next
    } else if (REGEX_SYNTAX.has(char)) {
      return null
    } else {
      text += char
    }
  }
  return usable(text)
}

/**
 * Whether a recorded selector is one a small change to the page breaks: one
 * kept whole as `{ kind: "selector" }`, or CSS that relies on a position or a
 * text filter (`div >> internal:has-text="Plan" >> nth=4`). Selectors inside
 * an iframe are left alone: a replacement would be searched in the wrong
 * document.
 */
export function isFragileSelector(selector: string): boolean {
  if (selector.includes(ENTER_FRAME)) return false
  const locator = parseRecordedSelector(selector)
  if (locator === null) return false
  return locator.kind === "selector" || (locator.kind === "css" && (locator.nth !== undefined || locator.hasText !== undefined))
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
