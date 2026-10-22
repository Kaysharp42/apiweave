import { createHash } from "node:crypto"
import type { WorkspacePendingChange } from "@shared/types/WorkspacePendingChange"
import type { WorkspacePendingChangeKind } from "@shared/types/WorkspacePendingChangeKind"
import { describeRecordFile, type RecordFileSummary } from "../services/workspace_repo_format"
import type { GitTreeEntry } from "./git_types"

const KIND_ORDER: readonly WorkspacePendingChangeKind[] = ["workspace", "project", "workflow", "environment"]

const FOLDER_KINDS: Readonly<Record<string, WorkspacePendingChangeKind>> = {
  projects: "project",
  workflows: "workflow",
  environments: "environment",
}

/** The files a commit would delete when no record maps to them: `writeWorkspaceTree` removes exactly these. */
const DELETABLE_PATH = /^(?:projects|workflows|environments)\/[^/]+\.json$/

/** One path a commit would touch: the blob the last commit holds there (none: it would be added) and whether the tree to commit still has it. */
export interface PathChange {
  readonly path: string
  readonly headOid: string | undefined
  readonly inTree: boolean
}

/** The id git gives a file's bytes: the hash of `blob <size>\0` and the bytes, in the repository's own hash. */
export function blobId(text: string, algorithm: "sha1" | "sha256"): string {
  const body = Buffer.from(text, "utf8")
  return createHash(algorithm).update(`blob ${body.length}\0`).update(body).digest("hex")
}

/**
 * What committing `tree` would change against the files the last commit holds
 * (`head`, as `ls-tree` lists them), without writing anything: a path only in
 * the tree is added, a path in both whose blob id differs is changed, and a
 * record file only in the last commit is deleted. The tree's files are hashed
 * as git would, so nothing is read back from the repository — an unchanged
 * file costs one hash, not one read. No `head` is a repository with no commit:
 * everything is added.
 */
export function diffTrees(tree: ReadonlyMap<string, string>, head: readonly GitTreeEntry[]): PathChange[] {
  const committed = new Map(head.map((entry) => [entry.path, entry.oid]))
  // The hash is the repository's: 64 hex digits is SHA-256.
  const algorithm = head[0]?.oid.length === 64 ? "sha256" : "sha1"
  const changes: PathChange[] = []
  for (const [path, text] of tree) {
    const headOid = committed.get(path)
    if (headOid === undefined || blobId(text, algorithm) !== headOid) changes.push({ path, headOid, inTree: true })
  }
  for (const [path, headOid] of committed) {
    if (!tree.has(path) && DELETABLE_PATH.test(path)) changes.push({ path, headOid, inTree: false })
  }
  return changes
}

/** The record a file holds, or — for a record file that does not parse, which only an older or hand-edited commit can hold — the file itself. */
function summarize(path: string, text: string | undefined): RecordFileSummary | undefined {
  if (text !== undefined) {
    try {
      return describeRecordFile(path, text)
    } catch {
      // Falls through: a record file that does not read is still a change to name.
    }
  }
  const kind = path === "workspace.json" ? "workspace" : FOLDER_KINDS[path.split("/")[0] ?? ""]
  return kind === undefined ? undefined : { kind, id: path, name: path }
}

interface RecordChange {
  readonly kind: WorkspacePendingChangeKind
  name: string
  path: string
  inHead: boolean
  inTree: boolean
}

/**
 * What the next commit would do, as records rather than files. `tree` is the
 * workspace as it would be committed — the database's names for what is added
 * or changed — and `readBlobs` reads the last commit's files by id, all at
 * once, where a deleted record's name still is. A record is one change however
 * many paths it touches, so a record whose slug changed along with its name is
 * `changed`, not a deletion and an addition. Paths that are not records'
 * (`.gitattributes`, the format file) are ignored.
 */
export async function describePendingChanges(
  tree: ReadonlyMap<string, string>,
  head: readonly GitTreeEntry[],
  readBlobs: (oids: readonly string[]) => Promise<ReadonlyMap<string, string | undefined>>,
): Promise<WorkspacePendingChange[]> {
  const changes = diffTrees(tree, head)
  const deleted = changes.flatMap((change) => (change.inTree || change.headOid === undefined ? [] : [change.headOid]))
  const blobs = deleted.length === 0 ? new Map<string, string | undefined>() : await readBlobs(deleted)
  const records = new Map<string, RecordChange>()
  for (const { path, headOid, inTree } of changes) {
    const summary = summarize(path, inTree ? tree.get(path) : blobs.get(headOid ?? ""))
    if (summary === undefined) continue
    const key = `${summary.kind}:${summary.id}`
    const known = records.get(key)
    const inHead = headOid !== undefined
    if (known === undefined) {
      records.set(key, { kind: summary.kind, name: summary.name, path, inHead, inTree })
      continue
    }
    known.inHead ||= inHead
    // The record's name and file are the ones it has now, when it still has any.
    if (inTree) {
      known.inTree = true
      known.name = summary.name
      known.path = path
    }
  }
  return [...records.values()]
    .map(({ kind, name, path, inHead, inTree }) => ({
      kind,
      change: inHead ? (inTree ? ("changed" as const) : ("deleted" as const)) : ("added" as const),
      name,
      path,
    }))
    .sort((left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) || left.name.localeCompare(right.name) || left.path.localeCompare(right.path))
}
