import { deepEqualJson, isPlainRecord, own } from "../conflict-diff/diff"
import type { GitMergeConflict } from "../types/GitMergeConflict"
import type { GitMergePick } from "../types/GitMergePick"
import type { GitMergeSide } from "../types/GitMergeSide"
import type { JsonValue } from "../types/JsonValue"
import { itemsByKey, joinPath } from "../workspace-repo/paths"

/** A value as one copy holds it; undefined where that copy holds nothing. */
export type Held = JsonValue | undefined

/** A place both copies changed differently, with what the ancestor and each copy hold there. */
export interface Clash {
  readonly at: readonly string[]
  readonly base: Held
  readonly ours: Held
  readonly theirs: Held
  /** Set on a whole record whose merged fields do not make a valid record together. */
  readonly invalid?: string
}

/** A clash the merge settled by its own rule, without asking: where, and which rule. */
export interface Settled {
  readonly at: readonly string[]
  readonly rule: "position" | "order"
}

/** One record's merge as it goes: the picks it may settle conflicts with, and what it could not settle, or settled by itself. */
export interface MergeScope {
  readonly picks: ReadonlyMap<string, GitMergeSide>
  clashes: Clash[]
  readonly settled: Settled[]
}

/** Two objects both copies changed, merged by the caller's own rule. */
type ObjectMerge = (
  at: readonly string[],
  base: Held,
  ours: Record<string, JsonValue>,
  theirs: Record<string, JsonValue>,
  scope: MergeScope,
) => JsonValue

/**
 * How a value merges when both copies changed it, to different things: as one
 * value (a conflict); key by key, each key by the shape `child` gives it; item
 * by item, for an array the format keys; or by a rule of its own. Where the
 * copies hold something the shape does not fit — an object where the other
 * holds a string — it is one value again.
 */
export type Shape =
  | { readonly type: "value" }
  | { readonly type: "fields"; readonly child: (key: string) => Shape }
  | { readonly type: "items"; readonly keyOf: (item: JsonValue) => string | undefined; readonly ordered: boolean; readonly item: Shape }
  | { readonly type: "custom"; readonly merge: ObjectMerge }

/** Any JSON: objects key by key all the way down, everything else one value. */
export const ANY: Shape = { type: "fields", child: () => ANY }

/** A fresh merge of the record `recordId`, with the picks that name it by path; a later pick for the same place replaces an earlier one. */
export function scopeFor(recordId: string, picks: readonly GitMergePick[]): MergeScope {
  return {
    picks: new Map(picks.filter((pick) => pick.recordId === recordId).map((pick) => [pick.path, pick.side])),
    clashes: [],
    settled: [],
  }
}

/** The conflicts a record's merge left, as their place in the record names them. */
export function conflictsOf(kind: GitMergeConflict["kind"], recordId: string, name: string, scope: MergeScope): GitMergeConflict[] {
  return scope.clashes.map((found) => ({
    kind,
    recordId,
    name,
    path: joinPath(found.at),
    ...held("base", found.base),
    ...held("ours", found.ours),
    ...held("theirs", found.theirs),
    ...(found.invalid === undefined ? {} : { invalid: found.invalid }),
  }))
}

function held<K extends "base" | "ours" | "theirs">(key: K, value: Held): Partial<Record<K, JsonValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, JsonValue>)
}

/**
 * The three-way rule at one place, `at`. Both copies agree, or only the remote
 * changed it: the remote's. Only yours changed it: yours. Both changed it,
 * differently: what the shape makes of the two, and a conflict where it can
 * make nothing — settled by a pick, or else the remote's for now. Undefined is
 * a copy that holds nothing there: it deleted it, or never added it.
 */
export function merge3(shape: Shape, at: readonly string[], base: Held, ours: Held, theirs: Held, scope: MergeScope): Held {
  if (deepEqualJson(ours, theirs) || deepEqualJson(ours, base)) return theirs
  if (deepEqualJson(theirs, base)) return ours
  const merged = ours === undefined || theirs === undefined ? undefined : mergeBoth(shape, at, base, ours, theirs, scope)
  return merged !== undefined ? merged : clash(scope, { at, base, ours, theirs })
}

/**
 * A conflict at one place: the pick there or at the nearest place above it
 * settles it; with none, it is recorded and the remote copy's side stands for
 * now.
 */
export function clash(scope: MergeScope, found: Clash): Held {
  const side = pickFor(scope.picks, found.at)
  if (side !== undefined) return side === "ours" ? found.ours : found.theirs
  scope.clashes.push(found)
  return found.theirs
}

/** The pick at `at`, or at the nearest place above it that has one. */
export function pickFor(picks: ReadonlyMap<string, GitMergeSide>, at: readonly string[]): GitMergeSide | undefined {
  if (picks.size === 0) return undefined
  for (let length = at.length; length >= 0; length -= 1) {
    const side = picks.get(joinPath(at.slice(0, length)))
    if (side !== undefined) return side
  }
  return undefined
}

/** Two objects both copies changed, key by key. The caller merges `skip` itself. */
export function mergeFields(
  child: (key: string) => Shape,
  at: readonly string[],
  base: Held,
  ours: Record<string, JsonValue>,
  theirs: Record<string, JsonValue>,
  scope: MergeScope,
  skip?: string,
): Record<string, JsonValue> {
  const ancestor = isPlainRecord(base) ? base : {}
  const entries: [string, JsonValue][] = []
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(ancestor)])) {
    if (key === skip) continue
    const value = merge3(child(key), [...at, key], own(ancestor, key), own(ours, key), own(theirs, key), scope)
    if (value !== undefined) entries.push([key, value])
  }
  // fromEntries defines each key as the object's own, so even a `__proto__` key stays data.
  return Object.fromEntries(entries)
}

/** Both copies' values, merged by `shape`; undefined where it does not fit them, which makes them one conflicting value. */
function mergeBoth(shape: Shape, at: readonly string[], base: Held, ours: JsonValue, theirs: JsonValue, scope: MergeScope): JsonValue | undefined {
  if (shape.type === "items") return Array.isArray(ours) && Array.isArray(theirs) ? mergeItems(shape, at, base, ours, theirs, scope) : undefined
  if (shape.type === "value" || !isPlainRecord(ours) || !isPlainRecord(theirs)) return undefined
  return shape.type === "custom" ? shape.merge(at, base, ours, theirs, scope) : mergeFields(shape.child, at, base, ours, theirs, scope)
}

/** A keyed array both copies changed, item by item; undefined when a copy's items cannot be told apart by key. */
function mergeItems(
  shape: Extract<Shape, { type: "items" }>,
  at: readonly string[],
  base: Held,
  ours: JsonValue[],
  theirs: JsonValue[],
  scope: MergeScope,
): JsonValue[] | undefined {
  const ancestor = itemsByKey(Array.isArray(base) ? base : undefined, shape.keyOf)
  const left = itemsByKey(ours, shape.keyOf)
  const right = itemsByKey(theirs, shape.keyOf)
  if (ancestor === undefined || left === undefined || right === undefined) return undefined
  const merged = new Map<string, JsonValue>()
  for (const key of new Set([...right.keys(), ...left.keys(), ...ancestor.keys()])) {
    const value = merge3(shape.item, [...at, key], ancestor.get(key), left.get(key), right.get(key), scope)
    if (value !== undefined) merged.set(key, value)
  }
  if (!shape.ordered) return [...merged.values()]
  return orderOf(at, [...ancestor.keys()], [...left.keys()], [...right.keys()], merged, scope).map((key) => merged.get(key)!)
}

/**
 * The merged items' order: the order of the one copy that changed it; when
 * both did, the remote copy's, with the items only yours holds after it, in
 * yours. That is recorded as settled when it moved items you had ordered.
 */
function orderOf(at: readonly string[], base: string[], ours: string[], theirs: string[], merged: ReadonlyMap<string, JsonValue>, scope: MergeScope): string[] {
  const oursMoved = !sameOrder(ours, base)
  const theirsMoved = !sameOrder(theirs, base)
  const [first, second] = oursMoved && !theirsMoved ? [ours, theirs] : [theirs, ours]
  const order = [...new Set([...first, ...second])].filter((key) => merged.has(key))
  const yours = new Set(ours)
  const kept = new Set(order)
  if (oursMoved && theirsMoved && !sameOrder(order.filter((key) => yours.has(key)), ours.filter((key) => kept.has(key)))) {
    scope.settled.push({ at, rule: "order" })
  }
  return order
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index])
}
