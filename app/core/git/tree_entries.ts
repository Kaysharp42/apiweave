import { isTreePath } from "@shared/workspace-repo/format"
import { ValidationError } from "../ipc/errors"
import type { GitTreeContents, GitTreeListing } from "./git_types"

/** The three trees of a merge; `base` is null when the copies share no ancestor. */
export interface TreeEntryCopies {
  readonly base: GitTreeContents | null
  readonly ours: GitTreeContents
  readonly theirs: GitTreeContents
}

/** The commits the three trees were read from; `baseCommit` is null when there is no ancestor. */
export interface TreeEntryCommits {
  readonly baseCommit: string | null
  readonly ourCommit: string
  readonly theirCommit: string
}

/** What a merge does with the paths where a tree holds something other than a plain file. */
export interface SettledTreeEntries {
  /** Every such path: the file merge must neither write nor delete any of them. */
  readonly paths: ReadonlySet<string>
  /** The ones the remote copy removed and your copy left as the ancestor had them: the merge removes them too. */
  readonly removals: readonly string[]
}

/** What one copy holds at a path: an entry that is not a plain file, a plain file's text, or nothing. */
type Slot = GitTreeListing | string | undefined

function slotAt(tree: GitTreeContents | null, relative: string): Slot {
  return tree === null ? undefined : tree.otherEntries.get(relative) ?? tree.files.get(relative)
}

/** One path held by something other than a plain file, with the commit a refusal names for it. */
interface NamedEntry {
  readonly entry: GitTreeListing
  readonly rev: string
}

/**
 * Every path any copy holds something other than a plain file at, with the
 * commit a refusal names: the remote copy's first, as the side that changed
 * it, then yours, then the ancestor's when there is one.
 */
function namedEntries(copies: TreeEntryCopies, commits: TreeEntryCommits): Map<string, NamedEntry> {
  const named = new Map<string, NamedEntry>()
  const trees: readonly (readonly [GitTreeContents | null, string | null])[] = [
    [copies.theirs, commits.theirCommit],
    [copies.ours, commits.ourCommit],
    [copies.base, commits.baseCommit],
  ]
  for (const [tree, rev] of trees) {
    if (tree === null || rev === null) continue
    for (const entry of tree.otherEntries.values()) if (!named.has(entry.path)) named.set(entry.path, { entry, rev })
  }
  return named
}

function sameSlot(left: Slot, right: Slot): boolean {
  if (typeof left === "object" && typeof right === "object") return left.mode === right.mode && left.oid === right.oid
  return left === right
}

/** What a tree entry that is not a plain file is, in words. */
function entryKind(entry: GitTreeListing): string {
  if (entry.mode === "120000") return "a symbolic link"
  if (entry.mode === "160000" || entry.type === "commit") return "a submodule"
  return `an entry of mode ${entry.mode}`
}

/**
 * The three-way rule for symbolic links and submodules, which a merge carries
 * as git tree entries and never as text. At each path where any copy holds one:
 *
 * - both copies hold the same thing there, or the remote copy holds what the
 *   ancestor did: your copy's entry stands, and the merge leaves the path out —
 *   the `-s ours` merge commit keeps it from your commit, untouched;
 * - the remote copy removed it and your copy left it as the ancestor had it:
 *   the merge removes it too;
 * - anything else — the remote copy added or changed one, or replaced one with
 *   a file — is refused with {@link ValidationError}, naming the path. Taking
 *   that entry would mean writing its blob into the checkout.
 *
 * With no ancestor (`base` null, a two-way merge) nothing holds what the
 * ancestor did: an entry only your copy has stays, and one the remote copy has
 * is refused unless it is the same entry, since the merge would have to write
 * it into the checkout to keep it.
 *
 * So nothing a merge writes is ever a link, or a link's target written as a
 * file. A path that is not one a repository may hold is refused whichever rule
 * would apply.
 */
export function settleTreeEntries(copies: TreeEntryCopies, commits: TreeEntryCommits): SettledTreeEntries {
  const { base, ours, theirs } = copies
  const named = namedEntries(copies, commits)
  const removals: string[] = []
  for (const [relative, { entry, rev }] of named) {
    if (!isTreePath(relative)) throw new ValidationError(`${relative} at ${rev} is not a path a repository may hold: it leaves the tree or names git's own .git folder`)
    const [b, o, t] = [base, ours, theirs].map((tree) => slotAt(tree, relative))
    if (sameSlot(o, t) || sameSlot(t, b)) continue
    if (t === undefined && sameSlot(o, b)) {
      removals.push(relative)
      continue
    }
    throw new ValidationError(
      `${relative} at ${rev} is ${entryKind(entry)}, not a plain file, and the remote copy changed it; a merge takes the remote copy's link or submodule only when it removed one your copy left as it was`,
    )
  }
  return { paths: new Set(named.keys()), removals }
}

/** `files` without `paths`. */
export function withoutPaths(files: ReadonlyMap<string, string>, paths: ReadonlySet<string>): Map<string, string> {
  return new Map([...files].filter(([relative]) => !paths.has(relative)))
}
