import type { AppliedAriaScope } from "@shared/types/AppliedAriaScope"
import type { AriaScope } from "@shared/types/AriaScope"

/**
 * What {@link scopeAriaSnapshot} produced: the scoped text, the scope that was
 * actually applied (`"auto"` is resolved to one of the three), and an optional
 * note saying what the preview does not show — the requested scope was absent
 * and the whole page was returned, `"auto"` chose a dialog while other content
 * exists, or the stored snapshot was cut before this extraction.
 */
export interface ScopedAriaSnapshot {
  readonly text: string
  readonly applied: AppliedAriaScope
  readonly note?: string
}

/** The line `capturePage` appends to a snapshot it had to cut at its capture cap. */
const TRUNCATION_MARKER = "… (truncated)"

const TRUNCATED_NOTE =
  'The stored ARIA snapshot was truncated when it was captured, so a dialog or later content may be missing; scope "page" shows what was kept.'

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
 * `note` says so. `note` also says what a chosen scope leaves out: when `auto`
 * picks a dialog but another dialog or the main landmark exists outside it, and
 * when the stored snapshot was truncated before the extraction's end. Never
 * throws: anything unparseable reads as "no dialog, no main", which is the
 * whole page — with a note.
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
  const extracted = extract(lines, snapshot, scope, dialog, main)
  const note = scopeNote({ snapshot, lines, requested: scope, dialog, main, extracted })
  return note === undefined ? extracted : { ...extracted, note }
}

/** The extraction itself, before any note about what it left out. */
function extract(
  lines: readonly SnapshotLine[],
  snapshot: string,
  scope: AriaScope,
  dialog: SnapshotLine | undefined,
  main: SnapshotLine | undefined,
): ScopedAriaSnapshot {
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

interface ScopeNoteInput {
  readonly snapshot: string
  readonly lines: readonly SnapshotLine[]
  readonly requested: AriaScope
  readonly dialog: SnapshotLine | undefined
  readonly main: SnapshotLine | undefined
  readonly extracted: ScopedAriaSnapshot
}

/**
 * What the extracted text does not show, in as few words as it takes: an
 * `auto` dialog may be one of several, and a truncated stored snapshot may have
 * lost the dialog (usually at the end of the body) that the scope was looking
 * for. Both notes join the extraction's own fallback note.
 */
function scopeNote(input: ScopeNoteInput): string | undefined {
  const notes: string[] = []
  if (input.extracted.note !== undefined) notes.push(input.extracted.note)
  if (input.requested === "auto" && input.extracted.applied === "dialog" && input.dialog !== undefined) {
    const dialogs = otherDialogs(input.lines, input.dialog)
    const landmark = input.main !== undefined && !insideSubtree(input.lines, input.dialog, input.main)
    if (dialogs > 0 || landmark) notes.push(otherContentNote(dialogs, landmark))
  }
  if (isTruncated(input.snapshot) && !input.extracted.text.includes(TRUNCATION_MARKER)) notes.push(TRUNCATED_NOTE)
  return notes.length === 0 ? undefined : notes.join(" ")
}

function isTruncated(snapshot: string): boolean {
  return snapshot.endsWith(TRUNCATION_MARKER)
}

/** Dialogs outside the chosen one's subtree: the consent banner `auto` skipped, or an ancestor dialog. */
function otherDialogs(lines: readonly SnapshotLine[], chosen: SnapshotLine): number {
  const start = lines.indexOf(chosen)
  const end = subtreeEnd(lines, chosen)
  let count = 0
  lines.forEach((line, index) => {
    if (index >= start && index < end) return
    if (line.item !== null && isDialogRole(roleOf(line.item))) count += 1
  })
  return count
}

function isDialogRole(role: string | null): boolean {
  return role === "dialog" || role === "alertdialog"
}

function otherContentNote(dialogs: number, landmark: boolean): string {
  const parts: string[] = []
  if (dialogs === 1) parts.push("1 other dialog")
  else if (dialogs > 1) parts.push(`${dialogs} other dialogs`)
  if (landmark) parts.push("a main landmark")
  const listed = capitalize(parts.join(" and "))
  if (dialogs === 0) return `${listed} is also on the page; scope "main" or "page" shows it.`
  const single = dialogs === 1 && parts.length === 1
  return `${listed} ${single ? "is" : "are"} also on the page; scope "page" shows ${single ? "it" : "them"}.`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
  const end = subtreeEnd(lines, target)
  for (let index = start + 1; index < end; index += 1) {
    taken.push(lines[index]!.raw)
  }
  const prefix = " ".repeat(target.indent)
  return taken.map((line) => (prefix !== "" && line.startsWith(prefix) ? line.slice(prefix.length) : line)).join("\n")
}

/** The index just past the last line indented under `target`, or -1 when it is not in `lines`. */
function subtreeEnd(lines: readonly SnapshotLine[], target: SnapshotLine): number {
  const start = lines.indexOf(target)
  if (start === -1) return -1
  let end = start + 1
  while (end < lines.length && lines[end]!.indent > target.indent) end += 1
  return end
}

/** Whether `node` is one of the lines indented under `container`. */
function insideSubtree(lines: readonly SnapshotLine[], container: SnapshotLine, node: SnapshotLine): boolean {
  const index = lines.indexOf(node)
  return index > lines.indexOf(container) && index < subtreeEnd(lines, container)
}
