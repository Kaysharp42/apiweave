import { own } from "../conflict-diff/diff"
import type { GitMergeConflict } from "../types/GitMergeConflict"
import type { GitMergeNote } from "../types/GitMergeNote"
import type { GitMergePick } from "../types/GitMergePick"
import type { GitMergeSide } from "../types/GitMergeSide"
import type { JsonValue } from "../types/JsonValue"
import type { WorkspacePendingChangeKind } from "../types/WorkspacePendingChangeKind"
import {
  ATTRIBUTES_FILE,
  ATTRIBUTES_TEXT,
  FORMAT_FILE,
  FormatFileSchema,
  RECORD_FOLDER,
  WORKSPACE_FILE,
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  compare,
  fileText,
  isTreePath,
  issueText,
  recordPath,
} from "../workspace-repo/format"
import { assertNoSecretValues } from "../workspace-repo/secret_storage"
import { mergeRecord, readRecord, recordIdOf, recordNameOf, type RecordDocument } from "./record"
import { conflictsOf, merge3, scopeFor } from "./values"

/** The whole tree, merged. */
export interface GitMergeTreeResult {
  /**
   * The merged tree, path to text in path order: what the merge commit holds.
   * A path of the copies that is not here is one the merge deletes. Records
   * are written exactly as the serializer writes them, so a clean merge's
   * commit is what the next ordinary commit would write. With conflicts left,
   * each holds the remote copy's side for now.
   */
  readonly files: ReadonlyMap<string, string>
  /** What the copies changed differently, in record order: only picks settle these. */
  readonly conflicts: readonly GitMergeConflict[]
  /** What the merge settled by itself, for the merge commit's message. */
  readonly notes: readonly GitMergeNote[]
}

/** A copy of the tree the merge cannot read: which copy, which file, and why. A file APIWeave cannot read is never merged over, so nothing a newer APIWeave wrote is lost. */
export class GitMergeInputError extends Error {
  public constructor(
    public readonly side: GitMergeSide,
    public readonly path: string,
    reason: string,
  ) {
    super(`${side === "ours" ? "your copy's" : "the remote copy's"} ${path} ${reason}`)
    this.name = "GitMergeInputError"
  }
}

const RECORD_KINDS: readonly WorkspacePendingChangeKind[] = ["workspace", "project", "workflow", "environment"]
const CONFLICT_ORDER: readonly GitMergeConflict["kind"][] = [...RECORD_KINDS, "file"]

/** Which copy of the tree is being read: the common ancestor, or one of the two copies. */
type CopyName = "base" | GitMergeSide

/** One copy of the tree, read: its records by kind and id, and the files the format does not own. */
interface TreeCopy {
  readonly records: ReadonlyMap<WorkspacePendingChangeKind, Map<string, RecordDocument>>
  readonly others: Map<string, string>
}

/**
 * Merge a workspace repository's tree three ways: `baseFiles` is the common
 * ancestor's tree, `ourFiles` yours and `theirFiles` the remote's, each path
 * to text as git holds it.
 *
 * `baseFiles` is null when the two copies have no common ancestor: one
 * workspace whose tracking was stopped and started again, or a clone recreated
 * from the database, pushed over a history of its own. Then the merge is two
 * ways — nothing is a change from anything — so a record only one copy holds
 * is kept, and a record both hold merges field by field, every field they
 * differ on a conflict (see {@link mergeRecord}).
 *
 * Records are matched by the id they hold, not by their file's name, so a
 * record renamed in one copy is the same record in the other, and each is
 * merged by {@link mergeRecord}: one only one copy added is added, one deleted
 * in one copy and untouched in the other is deleted, and one deleted in one
 * copy and changed in the other is a conflict on the whole record. A merged
 * record is written where the serializer would write it, under the merged
 * name. What both copies' records together would leave pointing at nothing is
 * then settled across records: a workflow in a project the other copy deleted
 * leaves the project, and one selecting an environment the other copy deleted
 * selects none. `.apiweave/format.json` and `.gitattributes` are always
 * written as the format writes them. A file the format does not own (a README,
 * CI config) is merged whole: one copy's change is taken, and both changing it
 * differently is a conflict on the file.
 *
 * Your copy and the remote copy must each be a tree APIWeave can read: every
 * file of the format's schema-valid and free of secret storage (`ciphertext`,
 * `kek`, ...: what the importer refuses), its records named after their ids, no
 * path outside the tree or inside a `.git` folder, and this format's version; anything less throws
 * {@link GitMergeInputError}. The ancestor's unreadable files are only
 * missing: a record without a readable ancestor merges as one added in both
 * copies.
 *
 * Pure: the caller reads the trees and writes the result.
 */
export function mergeTree(
  baseFiles: ReadonlyMap<string, string> | null,
  ourFiles: ReadonlyMap<string, string>,
  theirFiles: ReadonlyMap<string, string>,
  picks: readonly GitMergePick[] = [],
): GitMergeTreeResult {
  const reads: Reads = new Map()
  const base = baseFiles === null ? null : readCopy(baseFiles, "base", reads)
  const ours = readCopy(ourFiles, "ours", reads)
  const theirs = readCopy(theirFiles, "theirs", reads)
  checkSameWorkspace(base, ours, theirs)
  const conflicts: GitMergeConflict[] = []
  const notes: GitMergeNote[] = []
  const merged = new Map(RECORD_KINDS.map((kind) => [kind, mergeKind(kind, base, ours, theirs, picks, conflicts, notes)] as const))
  detachLostReferences(merged, [ours, theirs], notes)
  const files: [string, string][] = [
    [FORMAT_FILE, fileText({ format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION })],
    [ATTRIBUTES_FILE, ATTRIBUTES_TEXT],
  ]
  for (const [kind, records] of merged) {
    for (const [id, record] of records) files.push([kind === "workspace" ? WORKSPACE_FILE : recordPath(RECORD_FOLDER[kind], id, recordNameOf(record)), fileText(record)])
  }
  files.push(...mergeOthers(base, ours, theirs, picks, conflicts))
  conflicts.sort((left, right) => CONFLICT_ORDER.indexOf(left.kind) - CONFLICT_ORDER.indexOf(right.kind) || compare(left.recordId, right.recordId) || compare(left.path, right.path))
  return { files: new Map(files.sort(([left], [right]) => compare(left, right))), conflicts, notes }
}

function mergeKind(
  kind: WorkspacePendingChangeKind,
  base: TreeCopy | null,
  ours: TreeCopy,
  theirs: TreeCopy,
  picks: readonly GitMergePick[],
  conflicts: GitMergeConflict[],
  notes: GitMergeNote[],
): Map<string, RecordDocument> {
  const [ancestor, mine, remote] = [base?.records.get(kind) ?? new Map<string, RecordDocument>(), ours.records.get(kind)!, theirs.records.get(kind)!]
  const twoWay = base === null
  const merged = new Map<string, RecordDocument>()
  for (const id of [...new Set([...ancestor.keys(), ...mine.keys(), ...remote.keys()])].sort(compare)) {
    const record = mergeRecord(kind, ancestor.get(id), mine.get(id), remote.get(id), picks, twoWay)
    conflicts.push(...record.conflicts)
    notes.push(...record.notes)
    if (record.merged !== undefined) merged.set(id, record.merged)
  }
  return merged
}

/** The workflow fields that name another record, the kind they name, and the note for one cleared because the other copy deleted it. */
const REFERENCES = [
  {
    field: "projectId",
    target: "project",
    note: (recordId: string, name: string, projectId: string): GitMergeNote => ({ type: "leftProject", recordId, name, projectId }),
  },
  {
    field: "selectedEnvironmentId",
    target: "environment",
    note: (recordId: string, name: string, environmentId: string): GitMergeNote => ({ type: "clearedEnvironment", recordId, name, environmentId }),
  },
] as const

/**
 * A merged workflow that names a project or environment the merge deleted —
 * one copy deleted it while the other put the workflow in it, or selected it —
 * names none instead, which is what the app itself does when one is deleted.
 * A reference that already names nothing in your copy or the remote's (a
 * user-scoped environment is never in the tree) is that copy's, and stays.
 */
function detachLostReferences(merged: ReadonlyMap<WorkspacePendingChangeKind, Map<string, RecordDocument>>, sides: readonly TreeCopy[], notes: GitMergeNote[]): void {
  const workflows = merged.get("workflow")!
  for (const [workflowId, workflow] of workflows) {
    let detached = workflow
    for (const reference of REFERENCES) {
      const target = own(detached, reference.field)
      if (typeof target !== "string" || merged.get(reference.target)!.has(target)) continue
      if (sides.some((side) => own(side.records.get("workflow")!.get(workflowId) ?? {}, reference.field) === target && !side.records.get(reference.target)!.has(target))) continue
      detached = { ...detached, [reference.field]: null }
      notes.push(reference.note(workflowId, recordNameOf(workflow), target))
    }
    workflows.set(workflowId, detached)
  }
}

/** The files the format does not own, merged whole: a conflict is on the file, named by its path. */
function mergeOthers(base: TreeCopy | null, ours: TreeCopy, theirs: TreeCopy, picks: readonly GitMergePick[], conflicts: GitMergeConflict[]): [string, string][] {
  const files: [string, string][] = []
  for (const path of [...new Set([...(base?.others.keys() ?? []), ...ours.others.keys(), ...theirs.others.keys()])].sort(compare)) {
    const scope = scopeFor(path, picks)
    const text = merge3({ type: "value" }, [], base?.others.get(path), ours.others.get(path), theirs.others.get(path), scope)
    conflicts.push(...conflictsOf("file", path, path, scope))
    if (typeof text === "string") files.push([path, text])
  }
  return files
}

/** Both copies are this workspace's history: they hold one workspace id. An ancestor holding another has none to offer. */
function checkSameWorkspace(base: TreeCopy | null, ours: TreeCopy, theirs: TreeCopy): void {
  const [mine] = ours.records.get("workspace")!.keys()
  const [remote] = theirs.records.get("workspace")!.keys()
  if (mine !== remote) throw new GitMergeInputError("theirs", WORKSPACE_FILE, `holds workspace ${remote}, but your copy holds ${mine}: it is another workspace's history`)
  const ancestor = base?.records.get("workspace")
  if (ancestor === undefined) return
  for (const id of ancestor.keys()) if (id !== mine) ancestor.delete(id)
}

/** What a record file was read as, by path: a text the copies share is read once, and its copies are one record. */
type Reads = Map<string, { readonly text: string; readonly record: RecordDocument | string }>

/** One copy of the tree, every file read. Your copy and the remote's must read whole; see {@link mergeTree}. */
function readCopy(files: ReadonlyMap<string, string>, copy: CopyName, reads: Reads): TreeCopy {
  const tree: TreeCopy = { records: new Map(RECORD_KINDS.map((kind) => [kind, new Map<string, RecordDocument>()])), others: new Map() }
  const doubled = new Set<string>()
  for (const path of [...files.keys()].sort(compare)) readPath(tree, copy, path, files.get(path)!, doubled, reads)
  if (copy === "base") return tree
  for (const path of [FORMAT_FILE, WORKSPACE_FILE]) {
    if (!files.has(path)) throw new GitMergeInputError(copy, path, "is missing: this is not an APIWeave workspace repository")
  }
  return tree
}

function readPath(tree: TreeCopy, copy: CopyName, path: string, text: string, doubled: Set<string>, reads: Reads): void {
  if (!isTreePath(path)) return refuse(copy, path, "is not a path a repository may hold: it leaves the tree or names git's own .git folder")
  if (path === ATTRIBUTES_FILE) return
  if (path === FORMAT_FILE) return readFormat(copy, path, text)
  const kind = path === WORKSPACE_FILE ? "workspace" : folderKind(path)
  if (kind === undefined) tree.others.set(path, text)
  else readRecordFile(tree, copy, kind, path, text, doubled, reads)
}

function readFormat(copy: CopyName, path: string, text: string): void {
  const value = parseJson(text)
  if (value === undefined) return refuse(copy, path, NOT_JSON)
  const parsed = FormatFileSchema.safeParse(value)
  if (!parsed.success) refuse(copy, path, `cannot be read: ${issueText(parsed.error)}`)
}

const NOT_JSON = "is not valid JSON (an unresolved merge conflict?)"

/** The kind of record a file under a record folder holds; undefined for a path outside them. */
function folderKind(path: string): WorkspacePendingChangeKind | undefined {
  const folder = path.split("/")[0]
  return (["project", "workflow", "environment"] as const).find((kind) => RECORD_FOLDER[kind] === folder)
}

function readRecordFile(tree: TreeCopy, copy: CopyName, kind: WorkspacePendingChangeKind, path: string, text: string, doubled: Set<string>, reads: Reads): void {
  const known = reads.get(path)
  const record = known !== undefined && known.text === text ? known.record : recordInFile(kind, path, text)
  if (known === undefined) reads.set(path, { text, record })
  if (typeof record === "string") return refuse(copy, path, record)
  const id = recordIdOf(kind, record)
  const records = tree.records.get(kind)!
  const key = `${kind}:${id}`
  if (doubled.has(key)) return
  if (!records.has(id)) {
    records.set(id, record)
    return
  }
  refuse(copy, path, `holds ${kind} ${id}, which another file holds too`)
  // An ancestor holding a record twice holds no ancestor for it.
  records.delete(id)
  doubled.add(key)
}

/** The record a file holds — directly in its folder, schema-valid, named `<slug>--<id>.json` after its id — or what is wrong with the file. */
function recordInFile(kind: WorkspacePendingChangeKind, path: string, text: string): RecordDocument | string {
  const folder = kind === "workspace" ? undefined : `${RECORD_FOLDER[kind]}/`
  if (folder !== undefined && !/^[^/]+\.json$/.test(path.slice(folder.length))) return `is not a <name>--<id>.json file directly inside ${folder}`
  const value = parseJson(text)
  if (value === undefined) return NOT_JSON
  const secret = secretStorageIn(value)
  if (secret !== undefined) return secret
  const read = readRecord(kind, value)
  if (!("document" in read)) return `does not hold a valid ${kind}: ${read.invalid}`
  const id = recordIdOf(kind, read.document)
  if (folder !== undefined && !new RegExp(`^${folder}[a-z0-9-]+--${id}\\.json$`).test(path)) return `is not named <name>--${id}.json, after the id it holds`
  return read.document
}

/** Where a file's JSON holds secret storage, which the importer refuses in any repository file; undefined when it holds none. */
function secretStorageIn(value: JsonValue): string | undefined {
  try {
    assertNoSecretValues(value)
    return undefined
  } catch (error) {
    return `holds secret storage, which no repository file may: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** A copy's file that cannot be read: your copy and the remote's throw; the ancestor's is only left out. */
function refuse(copy: CopyName, path: string, reason: string): void {
  if (copy !== "base") throw new GitMergeInputError(copy, path, reason)
}

function parseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return undefined
  }
}
