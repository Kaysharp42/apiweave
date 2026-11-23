import { parse as parseYaml } from "yaml"
import type { BrowserLocator } from "@shared/types/BrowserLocator"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import { MIN_MASKED_SECRET_LENGTH } from "../secret_masker"
import { templateCheck, templateUrl, type RecordingValues } from "./recording_values"

/** The roles whose appearance says a click or key press did something: a message, a modal, a new step's title. */
type LandmarkRole = "alert" | "status" | "alertdialog" | "dialog" | "heading"

const LANDMARK_ROLES: ReadonlySet<string> = new Set<LandmarkRole>(["alert", "status", "alertdialog", "dialog", "heading"])

/** The longest name or text a check is built from; a whole panel's text is not one. */
const NAME_MAX_CHARS = 200

/** One landmark of the page, as its ARIA snapshot names it. */
export interface Landmark {
  readonly role: LandmarkRole
  readonly name: string
  /** An alert's or a status's text, which is what tells one message from the next: they rarely have a name. Empty for the other roles. */
  readonly text: string
  /** A heading's level, 1 to 6. */
  readonly level?: number
}

/** The page as the user acted, or after. Held in memory for one comparison, never sent. */
export interface PageState {
  /** The address's path, without query or fragment. Null for a page that is not http(s), or not known. */
  readonly path: string | null
  readonly landmarks: readonly Landmark[]
}

/** The check a click or key press earned, and the locator to confirm on the page before it is kept. */
export interface OutcomeCheck {
  readonly config: BrowserNodeData
  /** The locator with the page's own text, before templating: the recording keeps the check only when it finds one element. Null for an address check. */
  readonly probe: BrowserLocator | null
}

/** The path of `url`, or null when it is not an http(s) page. */
export function pathOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.pathname : null
  } catch {
    return null
  }
}

/** One key of an ARIA snapshot: `heading "Step 2" [level=2] [ref=e3]`. */
interface SnapshotKey {
  readonly role: string
  readonly name: string
  readonly level?: number
}

function readKey(key: string): SnapshotKey | null {
  const match = /^([a-z]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]*\])*)$/.exec(key)
  if (match === null) return null
  let name = ""
  try {
    const parsed: unknown = JSON.parse(`"${match[2] ?? ""}"`)
    if (typeof parsed === "string") name = parsed
  } catch {
    return null
  }
  const level = /\[level=(\d+)\]/.exec(match[3] ?? "")
  return { role: match[1] ?? "", name, ...(level === null ? {} : { level: Number(level[1]) }) }
}

/**
 * The text under one snapshot entry, joined: a `text:` entry, an element's
 * inline text, and a named element's name, which for a link or a button is
 * its text. A property such as a link's `/url` is no text.
 */
function textUnder(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value
    .map((item: unknown): string => {
      if (typeof item === "string") return readKey(item)?.name ?? ""
      if (typeof item !== "object" || item === null) return ""
      return Object.entries(item as Record<string, unknown>)
        .map(([key, child]) => {
          if (key === "text") return textUnder(child)
          if (key.startsWith("/")) return ""
          const name = readKey(key)?.name ?? ""
          return name !== "" ? name : textUnder(child)
        })
        .join(" ")
    })
    .join(" ")
}

/**
 * The landmarks of an ARIA snapshot in YAML, in document order, or null when
 * it cannot be read. Both sides of a comparison are `mode: "ai"` snapshots of
 * the body: the one Playwright's recorder takes as the user acts, and the one
 * the recording takes after. Nothing but the landmarks is kept: the rest
 * holds every value typed into the page, the password included.
 */
export function readLandmarks(snapshot: string): Landmark[] | null {
  let tree: unknown
  try {
    tree = parseYaml(snapshot)
  } catch {
    return null
  }
  const landmarks: Landmark[] = []
  const visit = (key: string, value: unknown): void => {
    const read = readKey(key)
    if (read !== null && LANDMARK_ROLES.has(read.role)) {
      const role = read.role as LandmarkRole
      const text = role === "alert" || role === "status" ? textUnder(value).replace(/\s+/g, " ").trim() : ""
      landmarks.push({ role, name: read.name, text, ...(read.level === undefined ? {} : { level: read.level }) })
    }
    if (Array.isArray(value)) visitList(value)
  }
  const visitList = (items: readonly unknown[]): void => {
    for (const item of items) {
      if (typeof item === "string") visit(item, undefined)
      else if (typeof item === "object" && item !== null) for (const [key, value] of Object.entries(item as Record<string, unknown>)) visit(key, value)
    }
  }
  if (!Array.isArray(tree)) return tree === null || tree === undefined ? [] : null
  visitList(tree)
  return landmarks
}

/** The landmarks in the snapshot Playwright's recorder took of the page as the user acted, the rest of a raw recorder action dropped unread. */
export function readActionLandmarks(raw: unknown): Landmark[] | null {
  if (typeof raw !== "object" || raw === null) return null
  const snapshot = (raw as Record<string, unknown>)["ariaSnapshot"]
  return typeof snapshot === "string" ? readLandmarks(snapshot) : null
}

/** Lower is a better proof of an outcome: a message, then a modal, then a heading by level. */
function rank(landmark: Landmark): number {
  if (landmark.role === "alert" || landmark.role === "status") return 0
  if (landmark.role === "alertdialog" || landmark.role === "dialog") return 1
  return 2 + (landmark.level ?? 6)
}

function identity(landmark: Landmark): string {
  return `${landmark.role}\u0000${landmark.name}\u0000${landmark.text}`
}

/** The landmarks of `after` that `before` did not have, counting repeats: a second identical heading is new. */
function appeared(before: readonly Landmark[], after: readonly Landmark[]): Landmark[] {
  const left = new Map<string, number>()
  for (const landmark of before) left.set(identity(landmark), (left.get(identity(landmark)) ?? 0) + 1)
  return after.filter((landmark) => {
    const key = identity(landmark)
    const remaining = left.get(key) ?? 0
    left.set(key, remaining - 1)
    return remaining <= 0
  })
}

/**
 * Whether `text` is test data rather than the page's own words: it is a value
 * the user typed or chose, or holds one of four characters or more. A check on
 * it would pass only with this recording's data.
 */
function isTypedValue(text: string, typed: readonly string[]): boolean {
  const lower = text.toLowerCase()
  return typed.some((value) => {
    const needle = value.trim().toLowerCase()
    if (needle === "") return false
    return lower === needle || (needle.length >= MIN_MASKED_SECRET_LENGTH && lower.includes(needle))
  })
}

/** What a locator for `landmark` matches on: its name exactly, an alert's text as a substring, or the role alone for a nameless modal. */
type Match = { readonly by: "name"; readonly value: string } | { readonly by: "text"; readonly value: string } | { readonly by: "role" }

function matchFor(landmark: Landmark): Match | null {
  if (landmark.name !== "") return { by: "name", value: landmark.name }
  if (landmark.text !== "") return { by: "text", value: landmark.text }
  return landmark.role === "dialog" || landmark.role === "alertdialog" ? { by: "role" } : null
}

function matches(match: Match, role: LandmarkRole, landmark: Landmark): boolean {
  if (landmark.role !== role) return false
  if (match.by === "name") return landmark.name === match.value
  if (match.by === "text") return `${landmark.name} ${landmark.text}`.toLowerCase().includes(match.value.toLowerCase())
  return true
}

function locatorFor(role: LandmarkRole, match: Match, value: string): BrowserLocator {
  if (match.by === "name") return { kind: "role", role, name: value, exact: true }
  if (match.by === "text") return { kind: "role", role, hasText: value }
  return { kind: "role", role }
}

/** A visibility check on `landmark`, unless the page has others it cannot be told from or its text is a secret or test data. */
function visibleCheck(landmark: Landmark, after: readonly Landmark[], typed: readonly string[], values: RecordingValues): OutcomeCheck | null {
  const match = matchFor(landmark)
  if (match === null) return null
  if (after.filter((other) => matches(match, landmark.role, other)).length !== 1) return null
  if (match.by === "role") return { config: { action: "expect-visible", locator: { kind: "role", role: landmark.role } }, probe: { kind: "role", role: landmark.role } }
  if (match.value.length > NAME_MAX_CHARS || isTypedValue(match.value, typed)) return null
  const templated = templateCheck(match.value, values)
  if (templated === null) return null
  return {
    config: { action: "expect-visible", locator: locatorFor(landmark.role, match, templated) },
    probe: locatorFor(landmark.role, match, match.value),
  }
}

/** An address check on the new path, unless it is the root, which every address contains, or carries test data or a secret. */
function urlCheck(path: string, typed: readonly string[], values: RecordingValues): OutcomeCheck | null {
  if (path === "/" || isTypedValue(path, typed)) return null
  const url = templateUrl(path, values)
  return url === null ? null : { config: { action: "expect-url", url, match: "contains" }, probe: null }
}

/**
 * The one check that proves a click or key press did what it did, from the
 * page before and after it, or null when nothing visible changed.
 *
 * A new path is checked with `expect-url`. Otherwise the best landmark that
 * appeared is checked with `expect-visible` — an alert or status message
 * first, then a dialog, then the highest-level heading, the first in document
 * order on a tie — skipping one the page cannot tell apart from another of
 * its kind, and one whose text is a secret or a value typed in this
 * recording: such a check would hold test data, or pass only with it.
 */
export function outcomeCheck(before: PageState, after: PageState, typed: readonly string[], values: RecordingValues): OutcomeCheck | null {
  if (before.path !== null && after.path !== null && after.path !== before.path) {
    const check = urlCheck(after.path, typed, values)
    if (check !== null) return check
  }
  const candidates = appeared(before.landmarks, after.landmarks)
    .map((landmark, order) => ({ landmark, order }))
    .sort((left, right) => rank(left.landmark) - rank(right.landmark) || left.order - right.order)
  for (const { landmark } of candidates) {
    const check = visibleCheck(landmark, after.landmarks, typed, values)
    if (check !== null) return check
  }
  return null
}
