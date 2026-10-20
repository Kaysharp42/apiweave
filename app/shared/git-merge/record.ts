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
 * and undefined where that tree has no such record. Each must be a record of
 * `kind` as {@link readRecord} reads it, canonical, and all hold the same id.
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
  // Only one copy changed it, or both alike: that copy, which leaves nothing broken that it did not hold already.
  if (deepEqualJson(ours, theirs) || deepEqualJson(ours, base)) return { merged: theirs, conflicts: [], notes: [] }
  if (deepEqualJson(theirs, base)) return { merged: ours, conflicts: [], notes: [] }
  const copies = { base, ours, theirs }
  const named = { kind, recordId, name: recordNameOf(first) }
  const scope = scopeFor(recordId, picks)
  // Two copies that each added a record under one id are two records, not one to mix field by field.
  const merged = base === undefined && ours !== undefined && theirs !== undefined
    ? clash(scope, { at: [], base, ours, theirs })
    : merge3(recordShape(kind), [], base, ours, theirs, scope)
  if (merged === undefined) return resultOf(named, undefined, scope, [])
  const notes: GitMergeNote[] = []
  const repaired = kind === "workflow" ? repairWorkflow(merged, copies, scope, notes, named) : merged
  const copy = [theirs, ours].find((candidate) => deepEqualJson(candidate, repaired))
  const written = copy === undefined ? canonicalizeRecord(kind, repaired) : { document: copy }
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
 * canvas, in the nearest frame around it that is left. Each is noted. A
 * reference that already points at nothing in one of the copies is that
 * copy's, not the merge's, and is left as it is.
 */
function repairWorkflow(merged: JsonValue, copies: Copies, scope: MergeScope, notes: GitMergeNote[], named: Named): JsonValue {
  if (!isPlainRecord(merged)) return merged
  const sides = [graphOf(copies.ours), graphOf(copies.theirs)]
  const frames = [...sides, graphOf(copies.base)]
  const present = new Set(listOf(merged, "nodes").flatMap((node) => textOf(node, "nodeId") ?? []))
  const nodes = listOf(merged, "nodes").map((node) => freeFromLostFrame(node, present, sides, frames, notes, named))
  const dropped = new Map<string, MissingEnd>()
  const edges = listOf(merged, "edges").filter((edge) => {
    const edgeId = textOf(edge, "edgeId")
    const missing = edgeId === undefined ? undefined : dropReason(edgeId, edge, present, sides)
    if (edgeId !== undefined && missing !== undefined) dropped.set(edgeId, missing)
    return missing === undefined
  })
  dropSettledEdgeClashes(scope, new Set(edges.flatMap((edge) => textOf(edge, "edgeId") ?? [])), dropped, present, sides)
  for (const [edgeId, missing] of dropped) notes.push({ type: "droppedEdge", recordId: named.recordId, name: named.name, edgeId, ...missing })
  return { ...merged, nodes, edges }
}

/**
 * A conflict inside an edge that is gone whichever copy is picked is no longer
 * anyone's to settle: the edge is dropped, whichever copy deleted it, and the
 * conflict with it. An edge one copy deleted alone, and the other changed, is
 * still a question: picking the change brings it back. So is an edge to a
 * node still in conflict, which a pick may bring back too.
 */
function dropSettledEdgeClashes(scope: MergeScope, kept: ReadonlySet<string>, dropped: Map<string, MissingEnd>, present: ReadonlySet<string>, sides: readonly Graph[]): void {
  const open = scope.clashes.flatMap(({ at }) => (at.length === 2 && at[0] === "nodes" ? at.slice(1) : []))
  const mayStay = new Set([...present, ...open])
  for (const found of scope.clashes) {
    const edgeId = found.at[0] === "edges" ? found.at[1] : undefined
    if (edgeId === undefined || kept.has(edgeId) || dropped.has(edgeId)) continue
    const reasons = sides.flatMap((side) => side.edges.get(edgeId) ?? []).map((copy) => dropReason(edgeId, copy, mayStay, sides))
    const missing = reasons[0]
    if (missing !== undefined && reasons.every((reason) => reason !== undefined)) dropped.set(edgeId, missing)
  }
  scope.clashes = scope.clashes.filter((found) => found.at[0] !== "edges" || !dropped.has(found.at[1] ?? ""))
}

/**
 * A node whose frame the merge deleted, taken out of it: into the nearest
 * frame around that one that is left, or out of every frame, its position
 * shifted by each deleted frame's so it stays where it was on the canvas.
 */
function freeFromLostFrame(node: JsonValue, present: ReadonlySet<string>, sides: readonly Graph[], frames: readonly Graph[], notes: GitMergeNote[], named: Named): JsonValue {
  const nodeId = textOf(node, "nodeId")
  const frameId = textOf(node, "parentId")
  if (!isPlainRecord(node) || nodeId === undefined || frameId === undefined || present.has(frameId)) return node
  if (sides.some((side) => textOf(side.nodes.get(nodeId), "parentId") === frameId && !side.nodes.has(frameId))) return node
  notes.push({ type: "freedNode", recordId: named.recordId, name: named.name, nodeId, frameId })
  const { parentId, offset } = frameLeft(frameId, present, frames)
  const position = pointOf(own(node, "position"))
  const free = Object.fromEntries(Object.entries(node).filter(([key]) => key !== "parentId"))
  const placed = parentId === undefined ? free : { ...free, parentId }
  return position === undefined ? placed : { ...placed, position: { x: offset.x + position.x, y: offset.y + position.y } }
}

interface Point {
  readonly x: number
  readonly y: number
}

const ORIGIN: Point = { x: 0, y: 0 }

/** Where a node in `frameId` goes: the nearest frame from there out that the merge kept, if any, and how far the deleted frames on the way offset it. */
function frameLeft(frameId: string, present: ReadonlySet<string>, frames: readonly Graph[], visited = new Set<string>()): { readonly parentId: string | undefined; readonly offset: Point } {
  if (present.has(frameId)) return { parentId: frameId, offset: ORIGIN }
  if (visited.has(frameId)) return { parentId: undefined, offset: ORIGIN }
  visited.add(frameId)
  const frame = frames.map((graph) => graph.nodes.get(frameId)).find((copy) => copy !== undefined) ?? {}
  const at = pointOf(own(frame, "position")) ?? ORIGIN
  const around = textOf(frame, "parentId")
  const outer = around === undefined ? { parentId: undefined, offset: ORIGIN } : frameLeft(around, present, frames, visited)
  return { parentId: outer.parentId, offset: { x: at.x + outer.offset.x, y: at.y + outer.offset.y } }
}

/** Why the merge drops this copy of an edge: the end it names that the merge deleted. Undefined to keep it, as well as one a copy already has pointing at nothing. */
function dropReason(edgeId: string, edge: JsonValue, present: ReadonlySet<string>, sides: readonly Graph[]): MissingEnd | undefined {
  const missing = missingEnd(edge, present)
  if (missing === undefined) return undefined
  if (sides.some((side) => side.edges.has(edgeId) && missingEnd(side.edges.get(edgeId)!, new Set(side.nodes.keys())) !== undefined)) return undefined
  return missing
}

interface MissingEnd {
  readonly end: "source" | "target"
  readonly nodeId: string
}

/** The first end of an edge that names a node not in `present`. */
function missingEnd(edge: JsonValue, present: ReadonlySet<string>): MissingEnd | undefined {
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

function pointOf(value: JsonValue | undefined): Point | undefined {
  const x = isPlainRecord(value) ? own(value, "x") : undefined
  const y = isPlainRecord(value) ? own(value, "y") : undefined
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined
}
