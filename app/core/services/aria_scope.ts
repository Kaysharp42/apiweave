import type { AppliedAriaScope } from "@shared/types/AppliedAriaScope"
import type { AriaScope } from "@shared/types/AriaScope"

/**
 * What {@link scopeAriaSnapshot} produced: the scoped text, the scope that was
 * actually applied (`"auto"` is resolved to one of the three), and, when the
 * requested scope was not present, a note saying the whole page was returned.
 */
export interface ScopedAriaSnapshot {
  readonly text: string
  readonly applied: AppliedAriaScope
  readonly note?: string
}

/** One parsed line of an ARIA snapshot: a YAML list item (`INDENT- key…`) or a non-item line. */
interface SnapshotLine {
  /** Leading spaces before the `-`, or the whole indent of a non-item line. */
  readonly indent: number
  /** The content after `- `, or null when the line is not a list item. */
  readonly item: string | null
  readonly raw: string
}

/**
 * Extract one part of an ARIA snapshot — the open dialog, the main landmark,
 * or the whole page — from the snapshot TEXT, by its indentation structure.
 *
 * Scoping is a read-time operation on the stored (already masked) text, so it
 * works identically for stored run evidence and live inspection, and it can
 * never bypass masking: whatever is returned is a substring of what was going
 * to be returned anyway.
 *
 * - `"dialog"` — the LAST `dialog`/`alertdialog` node in document order (the
 *   most recently opened one is usually the last), with its subtree.
 * - `"main"` — the first `main` node, with its subtree.
 * - `"page"` — the snapshot unchanged.
 * - `"auto"` — dialog if any, else main, else page.
 *
 * A requested scope the page does not have falls back to the whole page, and
 * `note` says so. Never throws: anything unparseable reads as "no dialog, no
 * main", which is the whole page — with a note.
 */
export function scopeAriaSnapshot(snapshot: string, scope: AriaScope = "auto"): ScopedAriaSnapshot {
  try {
    return scopeSnapshot(snapshot, scope)
  } catch {
    return { text: snapshot, applied: "page" }
  }
}

function scopeSnapshot(snapshot: string, scope: AriaScope): ScopedAriaSnapshot {
  const lines = parseLines(snapshot)
  const dialog = lastRoleLine(lines, "dialog", "alertdialog")
  const main = firstRoleLine(lines, "main")
  if (scope === "dialog" || (scope === "auto" && dialog !== undefined)) {
    if (dialog === undefined) return withPage(snapshot, "No dialog in this ARIA snapshot; returned the whole page instead.")
    return { text: subtree(lines, dialog), applied: "dialog" }
  }
  if (scope === "main" || scope === "auto") {
    if (main === undefined) {
      return withPage(snapshot, scope === "auto"
        ? "No dialog or main landmark in this ARIA snapshot; returned the whole page."
        : "No main landmark in this ARIA snapshot; returned the whole page instead.")
    }
    return { text: subtree(lines, main), applied: "main" }
  }
  return { text: snapshot, applied: "page" }
}

function withPage(snapshot: string, note: string): ScopedAriaSnapshot {
  return { text: snapshot, applied: "page", note }
}

/** Split on newlines (tolerating CRLF), measuring each line's indent and item content. */
function parseLines(snapshot: string): SnapshotLine[] {
  return snapshot.split("\n").map((raw) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    const match = /^(\s*)- (.*)$/.exec(line)
    return {
      indent: match !== null ? match[1]!.length : leadingSpaces(line),
      item: match !== null ? (match[2] ?? "") : null,
      raw: line,
    }
  })
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length
}

/**
 * The role at the start of an item's key: `main`, `dialog "Title":`,
 * `generic [ref=e3]:`, or a single-quoted key like `'heading "x" [ref=e9]'`.
 * Property entries (`text:`, `/url:`) and quoted scalars starting with `-`
 * match no role and are never scope candidates.
 */
function roleOf(item: string): string | null {
  const content = item.startsWith("'") ? item.slice(1) : item
  const match = /^([a-z][a-z0-9-]*)/.exec(content)
  return match === null ? null : (match[1] ?? null)
}

function firstRoleLine(lines: readonly SnapshotLine[], role: string): SnapshotLine | undefined {
  return lines.find((line) => line.item !== null && roleOf(line.item) === role)
}

function lastRoleLine(lines: readonly SnapshotLine[], ...roles: readonly string[]): SnapshotLine | undefined {
  let found: SnapshotLine | undefined
  for (const line of lines) {
    if (line.item !== null && roles.includes(roleOf(line.item) ?? "")) found = line
  }
  return found
}

/**
 * One node's subtree, dedented to start at column 0 so the fragment reads as
 * its own snapshot: the node's own line plus every following line indented
 * deeper than it. Lines that are not list items still count as content while
 * they are indented under the node; a shallower line ends the subtree.
 */
function subtree(lines: readonly SnapshotLine[], target: SnapshotLine): string {
  const start = lines.indexOf(target)
  if (start === -1) return target.raw
  const taken: string[] = [target.raw]
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.indent <= target.indent) break
    taken.push(line.raw)
  }
  const prefix = " ".repeat(target.indent)
  return taken.map((line) => (prefix !== "" && line.startsWith(prefix) ? line.slice(prefix.length) : line)).join("\n")
}
