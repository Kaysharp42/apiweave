import type { GitAheadBehind, GitLogEntry, GitStatus, GitStatusEntry, GitStatusEntryKind, GitVersion } from "./git_types"

export function parseVersion(output: string): GitVersion | undefined {
  const match = /^git version ((\d+)\.(\d+)(?:\.(\d+))?.*)$/m.exec(output)
  if (match === null) {
    return undefined
  }
  const [, raw = "", major = "0", minor = "0", patch = "0"] = match
  return { raw: raw.trim(), major: Number(major), minor: Number(minor), patch: Number(patch) }
}

// `1 XY sub mH mI mW hH hI path` / `2 XY sub mH mI mW hH hI Xscore path` / `u XY sub m1 m2 m3 mW h1 h2 h3 path`.
// Paths are the last field, taken whole: with -z they are verbatim and may hold spaces or newlines.
const CHANGED = /^1 (\S)(\S) \S+ \d+ \d+ \d+ \w+ \w+ ([\s\S]*)$/
const RENAMED = /^2 (\S)(\S) \S+ \d+ \d+ \d+ \w+ \w+ \S+ ([\s\S]*)$/
const UNMERGED = /^u (\S)(\S) \S+ \d+ \d+ \d+ \d+ \w+ \w+ \w+ ([\s\S]*)$/

interface StatusBuilder {
  branch: string | undefined
  oid: string | undefined
  upstream: string | undefined
  ahead: number
  behind: number
  entries: GitStatusEntry[]
}

function entryFrom(
  kind: GitStatusEntryKind,
  match: RegExpExecArray,
  origPath: string | undefined,
): GitStatusEntry {
  const [, index = ".", worktree = ".", path = ""] = match
  return { kind, path, origPath, index, worktree }
}

/** A rename's original path is the record after it, which the caller then skips. */
function parseEntry(record: string, next: string | undefined): GitStatusEntry | undefined {
  const changed = CHANGED.exec(record)
  if (changed !== null) {
    return entryFrom("changed", changed, undefined)
  }
  const renamed = RENAMED.exec(record)
  if (renamed !== null) {
    return entryFrom("renamed", renamed, next ?? "")
  }
  const unmerged = UNMERGED.exec(record)
  if (unmerged !== null) {
    return entryFrom("unmerged", unmerged, undefined)
  }
  if (record.startsWith("? ")) {
    return { kind: "untracked", path: record.slice(2), origPath: undefined, index: "?", worktree: "?" }
  }
  return undefined
}

function unlessPlaceholder(value: string, placeholder: string): string | undefined {
  return value === placeholder ? undefined : value
}

function applyAheadBehind(status: StatusBuilder, value: string): void {
  const [, ahead = "0", behind = "0"] = /^\+(\d+) -(\d+)$/.exec(value) ?? []
  status.ahead = Number(ahead)
  status.behind = Number(behind)
}

type HeaderReader = (status: StatusBuilder, value: string) => void

const HEADER_READERS: ReadonlyMap<string, HeaderReader> = new Map<string, HeaderReader>([
  [
    "branch.oid",
    (status, value) => {
      status.oid = unlessPlaceholder(value, "(initial)")
    },
  ],
  [
    "branch.head",
    (status, value) => {
      status.branch = unlessPlaceholder(value, "(detached)")
    },
  ],
  [
    "branch.upstream",
    (status, value) => {
      status.upstream = value
    },
  ],
  ["branch.ab", applyAheadBehind],
])

function applyHeader(status: StatusBuilder, line: string): void {
  const [key = "", ...rest] = line.split(" ")
  HEADER_READERS.get(key)?.(status, rest.join(" "))
}

/** Parse `git status --porcelain=v2 --branch -z`. */
export function parseStatus(output: string): GitStatus {
  const status: StatusBuilder = {
    branch: undefined,
    oid: undefined,
    upstream: undefined,
    ahead: 0,
    behind: 0,
    entries: [],
  }
  const records = output.split("\0")
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? ""
    if (record.startsWith("# ")) {
      applyHeader(status, record.slice(2))
      continue
    }
    const entry = parseEntry(record, records[i + 1])
    if (entry !== undefined) {
      status.entries.push(entry)
      i += entry.kind === "renamed" ? 1 : 0
    }
  }
  return { ...status, clean: status.entries.length === 0 }
}

/**
 * Parse `git rev-list --left-right --count <a>...<b>`: git prints the left
 * count and the right count, tab-separated, on one line.
 */
export function parseAheadBehind(output: string): GitAheadBehind | undefined {
  const match = /^(\d+)\t(\d+)\s*$/.exec(output)
  return match === null ? undefined : { ahead: Number(match[1]), behind: Number(match[2]) }
}

/** Parse `git rev-list --count <rev>`: one decimal number on one line. */
export function parseCommitCount(output: string): number | undefined {
  const match = /^(\d+)\s*$/.exec(output)
  return match === null ? undefined : Number(match[1])
}

/**
 * NUL-separated fields inside one commit. NUL is the only byte git refuses to
 * store in a commit message, so no subject, author or body can shift a field.
 * The commit records themselves are NUL-terminated by `-z`, so the output is
 * read as fixed-size groups of {@link LOG_FIELD_COUNT}.
 */
export const LOG_FORMAT = ["%H", "%P", "%an", "%ae", "%aI", "%s", "%b"].join("%x00")

const LOG_FIELD_COUNT = 7

function parseLogRecord(fields: readonly string[], start: number): GitLogEntry {
  const [sha = "", parents = "", authorName = "", authorEmail = "", authorDate = "", subject = "", body = ""] =
    fields.slice(start, start + LOG_FIELD_COUNT)
  return {
    sha,
    parents: parents.length === 0 ? [] : parents.split(" "),
    authorName,
    authorEmail,
    authorDate,
    subject,
    // Verbatim: git's own trailing newline stays, and so do a body's blank lines.
    body,
  }
}

/** Parse `git log -z --format=<LOG_FORMAT>`. */
export function parseLog(output: string): GitLogEntry[] {
  const fields = output.split("\0")
  const entries: GitLogEntry[] = []
  for (let start = 0; start + LOG_FIELD_COUNT <= fields.length; start += LOG_FIELD_COUNT) {
    entries.push(parseLogRecord(fields, start))
  }
  return entries
}
