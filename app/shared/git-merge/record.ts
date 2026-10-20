import { canonicalizeRecord, recordIdOf, recordNameOf, type RecordDocument } from "../conflict-diff/canonicalize"
import { deepEqualJson, isPlainRecord, own } from "../conflict-diff/diff"
import type { GitMergeConflict } from "../types/GitMergeConflict"
import type { GitMergeNote } from "../types/GitMergeNote"
import type { GitMergePick } from "../types/GitMergePick"
import type { JsonValue } from "../types/JsonValue"
import type { WorkspacePendingChangeKind } from "../types/WorkspacePendingChangeKind"
import { compare } from "../workspace-repo/format"
import { keyedArray } from "../workspace-repo/paths"
import { ANY, clash, conflictsOf, merge3, mergeFields, pickFor, scopeFor, type Held, type MergeScope, type Shape } from "./values"

/** A file's JSON as the canonical record it holds, or why it is not one; see `conflict-diff/canonicalize.ts`. */
export const readRecord = canonicalizeRecord
export { recordIdOf, recordNameOf, type RecordDocument }

/** One record, merged. */
export interface GitMergeRecordResult {
  /** The merged record as its file holds it, in the serializer's field order; undefined when the merge deletes it. With conflicts left, each holds the remote copy's side for now. */
  readonly merged: RecordDocument | undefined
  /** What the copies changed differently, by path: only a pick settles these. */
  readonly conflicts: readonly GitMergeConflict[]
  /** What the merge settled by itself in this record. */
  readonly notes: readonly GitMergeNote[]
}

/**
 * Merge one record three ways. `base` is the common ancestor and `ours`/`theirs`
 * the two copies — your copy and the remote copy — each as its file holds it,
 * and undefined where that tree has no such record. Each must be a valid
 * record of `kind`, and all hold the same id.
 *
 * The record merges by the format's rules: a keyed array (nodes, edges, a
 * project's workflow order, tags) item by item, every object key by key, and
 * everything else, an unkeyed array included, as one value. A record only one
 * copy changed is that copy's. A record one copy deleted is deleted if the
 * other left it as it was, and a conflict at `""` (the whole record) if the
 * other changed it; so is a record both copies added differently. A
 * workflow's merge also settles what both copies' changes together would
 * leave broken (see {@link repairWorkflow}). Where every field merged but the
 * result is not a valid record, that is a conflict at `""` too.
 *
 * `picks` settle conflicts; see {@link GitMergePick}.
 */
export function mergeRecord(
  kind: WorkspacePendingChangeKind,
  base: RecordDocument | undefined,
  ours: RecordDocument | undefined,
  theirs: RecordDocument | undefined,
  picks: readonly GitMergePick[] = [],
): GitMergeRecordResult {
  const first = ours ?? theirs ?? base
  if (first === undefined) return { merged: undefined, conflicts: [], notes: [] }
  const recordId = recordIdOf(kind, first)
  for (const copy of [base, ours, theirs]) {
    if (copy !== undefined && recordIdOf(kind, copy) !== recordId) throw new Error(`the copies of ${kind} ${recordId} hold different ids`)
  }
  const copies = { base, ours, theirs }
  const named = { kind, recordId, name: recordNameOf(first) }
  const scope = scopeFor(recordId, picks)
  // Two copies that each added a record under one id are two records, not one to mix field by field.
  const merged = base === undefined && ours !== undefined && theirs !== undefined && !deepEqualJson(ours, theirs)
    ? clash(scope, { at: [], base, ours, theirs })
    : merge3(recordShape(kind), [], base, ours, theirs, scope)
  if (merged === undefined) return resultOf(named, undefined, scope, [])
  const notes: GitMergeNote[] = []
  const repaired = kind === "workflow" ? repairWorkflow(merged, copies, scope, notes, named) : merged
  const written = canonicalizeRecord(kind, repaired)
  if ("document" in written) return resultOf(named, written.document, scope, [...notes, ...settledNotes(named, scope)])
  return wholeCopy(named, copies, scope, written.invalid)
}

interface Named {
  readonly kind: WorkspacePendingChangeKind
  readonly recordId: string
  readonly name: string
}

interface Copies {
  readonly base: RecordDocument | undefined
  readonly ours: RecordDocument | undefined
  readonly theirs: RecordDocument | undefined
}

function resultOf(named: Named, merged: RecordDocument | undefined, scope: MergeScope, notes: readonly GitMergeNote[]): GitMergeRecordResult {
  const conflicts = conflictsOf(named.kind, named.recordId, named.name, scope).sort((left, right) => compare(left.path, right.path))
  return { merged, conflicts, notes }
}

/**
 * A record whose fields merged into something no file may hold: one copy of
 * it whole. With every field settled, a pick at `""` says which; without one
 * that is the conflict, the remote copy standing for now. While fields are
 * still in conflict, their picks may yet make it valid, so the remote copy
 * stands for now and nothing more is asked.
 */
function wholeCopy(named: Named, copies: Copies, scope: MergeScope, invalid: string): GitMergeRecordResult {
  const settled = scope.clashes.length === 0
  const side = settled ? pickFor(scope.picks, []) : undefined
  if (settled && side === undefined) scope.clashes.push({ at: [], base: copies.base, ours: copies.ours, theirs: copies.theirs, invalid })
  const copy = side === "ours" ? copies.ours : copies.theirs
  const written = copy === undefined ? undefined : canonicalizeRecord(named.kind, copy)
  if (written === undefined || !("document" in written)) throw new Error(`${named.kind} ${named.recordId}: a copy that is not a valid record`)
  return resultOf(named, written.document, scope, [])
}

/** The rules each top-level field of a `kind` record merges by: its keyed arrays item by item (a workflow's nodes as nodes), the rest as any JSON. */
function recordShape(kind: WorkspacePendingChangeKind): Shape {
  return {
    type: "fields",
    child: (field) => {
      const array = keyedArray(kind, field)
      if (array === undefined) return ANY
      return { type: "items", keyOf: array.keyOf, ordered: array.ordered, item: kind === "workflow" && field === "nodes" ? NODE : ANY }
    },
  }
}

/** A node both copies changed: key by key, but for its position, which goes with its frame. */
const NODE: Shape = {
  type: "custom",
  merge: (at, base, ours, theirs, scope) => {
    const fields = mergeFields(() => ANY, at, base, ours, theirs, scope, "position")
    const position = mergePosition(at, base, ours, theirs, fields, scope)
    return position === undefined ? fields : { ...fields, position }
  },
}

/**
 * Where a node ends up. A position is relative to the node's frame, so where
 * the copies put the node in different frames, the position is the one from
 * the copy whose frame the merge kept. In the same frame, both copies moving
 * it is no conflict: the remote copy's position stands, settled by rule.
 */
function mergePosition(at: readonly string[], base: Held, ours: RecordDocument, theirs: RecordDocument, merged: RecordDocument, scope: MergeScope): Held {
  const before = isPlainRecord(base) ? own(base, "position") : undefined
  const mine = own(ours, "position")
  const remote = own(theirs, "position")
  if (!deepEqualJson(own(ours, "parentId"), own(theirs, "parentId"))) {
    return deepEqualJson(own(merged, "parentId"), own(ours, "parentId")) ? mine : remote
  }
  if (deepEqualJson(mine, remote) || deepEqualJson(mine, before)) return remote
  if (deepEqualJson(remote, before)) return mine
  scope.settled.push({ at, rule: "position" })
  return remote
}

/** The notes for what this record's rules settled: the positions taken from the remote copy, and a project order merged. */
function settledNotes(named: Named, scope: MergeScope): GitMergeNote[] {
  const { recordId, name } = named
  const nodeIds = scope.settled.filter((entry) => entry.rule === "position").map((entry) => entry.at[1] ?? "")
  const notes: GitMergeNote[] = []
  if (nodeIds.length > 0) notes.push({ type: "positions", recordId, name, nodeIds: nodeIds.sort(compare) })
  if (scope.settled.some((entry) => entry.rule === "order" && entry.at[0] === "workflowOrder")) notes.push({ type: "order", recordId, name })
  return notes
}

/** One copy of a workflow's graph, looked up by id. */
interface Graph {
  readonly nodes: ReadonlyMap<string, RecordDocument>
  readonly edges: ReadonlyMap<string, RecordDocument>
}

function graphOf(workflow: JsonValue | undefined): Graph {
  const byId = (field: string, id: string) => new Map(listOf(workflow, field).flatMap((item) => {
    const key = textOf(item, id)
    return key === undefined || !isPlainRecord(item) ? [] : [[key, item] as const]
  }))
  return { nodes: byId("nodes", "nodeId"), edges: byId("edges", "edgeId") }
}

/**
 * What a workflow's two copies, merged, would leave pointing at nothing: an
 * edge from or to a node the other copy deleted is dropped, and a node in a
 * frame the other copy deleted is freed from it, staying where it was on the
 * canvas. Each is noted. A reference that already points at nothing in one of
 * the copies is that copy's, not the merge's, and is left as it is.
 */
function repairWorkflow(merged: JsonValue, copies: Copies, scope: MergeScope, notes: GitMergeNote[], named: Named): JsonValue {
  if (!isPlainRecord(merged)) return merged
  const sides = [graphOf(copies.ours), graphOf(copies.theirs)]
  const frames = [...sides, graphOf(copies.base)]
  const present = new Set(listOf(merged, "nodes").flatMap((node) => textOf(node, "nodeId") ?? []))
  const nodes = listOf(merged, "nodes").map((node) => freeFromLostFrame(node, present, sides, frames, notes, named))
  const dropped = new Set<string>()
  const edges = listOf(merged, "edges").filter((edge) => keepEdge(edge, present, sides, dropped, notes, named))
  // A conflict inside an edge that is gone is no longer anyone's to settle.
  scope.clashes = scope.clashes.filter((found) => found.at[0] !== "edges" || !dropped.has(found.at[1] ?? ""))
  return { ...merged, nodes, edges }
}

function freeFromLostFrame(node: JsonValue, present: ReadonlySet<string>, sides: readonly Graph[], frames: readonly Graph[], notes: GitMergeNote[], named: Named): JsonValue {
  const nodeId = textOf(node, "nodeId")
  const frameId = textOf(node, "parentId")
  if (!isPlainRecord(node) || nodeId === undefined || frameId === undefined || present.has(frameId)) return node
  if (sides.some((side) => textOf(side.nodes.get(nodeId), "parentId") === frameId && !side.nodes.has(frameId))) return node
  notes.push({ type: "freedNode", recordId: named.recordId, name: named.name, nodeId, frameId })
  const frame = frames.map((graph) => pointOf(own(graph.nodes.get(frameId) ?? {}, "position"))).find((point) => point !== undefined)
  const position = pointOf(own(node, "position"))
  const free = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "parentId"))
  return frame === undefined || position === undefined ? free : { ...free, position: { x: frame.x + position.x, y: frame.y + position.y } }
}

function keepEdge(edge: JsonValue, present: ReadonlySet<string>, sides: readonly Graph[], dropped: Set<string>, notes: GitMergeNote[], named: Named): boolean {
  const edgeId = textOf(edge, "edgeId")
  const missing = missingEnd(edge, present)
  if (edgeId === undefined || missing === undefined) return true
  if (sides.some((side) => side.edges.has(edgeId) && missingEnd(side.edges.get(edgeId)!, new Set(side.nodes.keys())) !== undefined)) return true
  dropped.add(edgeId)
  notes.push({ type: "droppedEdge", recordId: named.recordId, name: named.name, edgeId, ...missing })
  return false
}

/** The first end of an edge that names a node not in `present`. */
function missingEnd(edge: JsonValue, present: ReadonlySet<string>): { readonly end: "source" | "target"; readonly nodeId: string } | undefined {
  for (const end of ["source", "target"] as const) {
    const nodeId = textOf(edge, end)
    if (nodeId !== undefined && !present.has(nodeId)) return { end, nodeId }
  }
  return undefined
}

function listOf(value: JsonValue | undefined, field: string): JsonValue[] {
  const list = isPlainRecord(value) ? own(value, field) : undefined
  return Array.isArray(list) ? list : []
}

function textOf(value: JsonValue | undefined, field: string): string | undefined {
  const text = isPlainRecord(value) ? own(value, field) : undefined
  return typeof text === "string" ? text : undefined
}

function pointOf(value: JsonValue | undefined): { readonly x: number; readonly y: number } | undefined {
  const x = isPlainRecord(value) ? own(value, "x") : undefined
  const y = isPlainRecord(value) ? own(value, "y") : undefined
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined
}
