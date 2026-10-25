import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";
import { joinPath, splitPath } from "@shared/workspace-repo/paths";
import type { MergeConflictGroup } from "../types";

/** The key a decision is stored under: its record (or file) and the place in it. */
export function pickKey(recordId: string, path: string): string {
  return `${recordId}\0${path}`;
}

/** A key's record and place again. */
function placeOf(key: string): { readonly recordId: string; readonly path: string } {
  const at = key.indexOf("\0");
  if (at < 0) return { recordId: key, path: "" };
  return { recordId: key.slice(0, at), path: key.slice(at + 1) };
}

/**
 * The decision that settles a conflict now: its own pick, or the copy pick at
 * the nearest place above it — a whole-record pick settles its fields. A value
 * of the user's own names exactly the place it replaces, so it never stands in
 * for a place beneath it. This mirrors the engine's rule; a picker that showed
 * anything else would disagree with the merge it is finishing.
 */
export function resolutionOf(
  picks: ReadonlyMap<string, GitMergePick>,
  conflict: GitMergeConflict,
): GitMergePick | undefined {
  const segments = splitPath(conflict.path);
  for (let length = segments.length; length >= 0; length -= 1) {
    const pick = picks.get(
      pickKey(conflict.recordId, joinPath(segments.slice(0, length))),
    );
    if (pick === undefined) continue;
    if ("value" in pick && length !== segments.length) continue;
    return pick;
  }
  return undefined;
}

/** The decisions with one place settled by a copy. */
export function withSidePick(
  picks: ReadonlyMap<string, GitMergePick>,
  recordId: string,
  path: string,
  side: GitMergeSide,
): ReadonlyMap<string, GitMergePick> {
  const next = new Map(picks);
  next.set(pickKey(recordId, path), { recordId, path, side });
  return next;
}

/** The decisions with one place settled by a value of the user's own. */
export function withValuePick(
  picks: ReadonlyMap<string, GitMergePick>,
  recordId: string,
  path: string,
  value: JsonValue,
): ReadonlyMap<string, GitMergePick> {
  const next = new Map(picks);
  next.set(pickKey(recordId, path), { recordId, path, value });
  return next;
}

/**
 * Choose a copy for a whole record: a pick at `path: ""` settles every field
 * below it. Its fields' own picks go, because the server prefers an exact path
 * over one above it — leaving both would let an old field pick beat the choice
 * the user just made.
 */
export function withWholeRecordPick(
  picks: ReadonlyMap<string, GitMergePick>,
  recordId: string,
  side: GitMergeSide,
): ReadonlyMap<string, GitMergePick> {
  const next = new Map<string, GitMergePick>();
  for (const [key, pick] of picks) {
    if (placeOf(key).recordId !== recordId) next.set(key, pick);
  }
  next.set(pickKey(recordId, ""), { recordId, path: "", side });
  return next;
}

/** Every listed record and file settled by one copy, for Accept all. */
export function acceptAllPicks(
  groups: readonly MergeConflictGroup[],
  side: GitMergeSide,
): ReadonlyMap<string, GitMergePick> {
  return new Map(
    groups.map((group) => [
      pickKey(group.recordId, ""),
      { recordId: group.recordId, path: "", side },
    ]),
  );
}

/** How many of `conflicts` have a decision. */
export function resolvedCount(
  conflicts: readonly GitMergeConflict[],
  picks: ReadonlyMap<string, GitMergePick>,
): number {
  return conflicts.filter(
    (conflict) => resolutionOf(picks, conflict) !== undefined,
  ).length;
}

/** How many of one record's or file's conflicts have a decision. */
export function groupResolvedCount(
  group: MergeConflictGroup,
  picks: ReadonlyMap<string, GitMergePick>,
): number {
  return resolvedCount(group.conflicts, picks);
}

/** Every listed conflict has a decision. */
export function allConflictsResolved(
  conflicts: readonly GitMergeConflict[],
  picks: ReadonlyMap<string, GitMergePick>,
): boolean {
  return conflicts.every(
    (conflict) => resolutionOf(picks, conflict) !== undefined,
  );
}

/**
 * The next (or previous) conflict without a decision, wrapping around, from
 * the one at `from`; undefined when none is left. `from` is a `pickKey`.
 */
export function nextUnresolved(
  conflicts: readonly GitMergeConflict[],
  picks: ReadonlyMap<string, GitMergePick>,
  from: string | null,
  direction: 1 | -1,
): GitMergeConflict | undefined {
  const keys = conflicts.map((conflict) =>
    pickKey(conflict.recordId, conflict.path),
  );
  const start = from === null ? -1 : keys.indexOf(from);
  for (let step = 1; step <= conflicts.length; step += 1) {
    const offset =
      (((start + direction * step) % conflicts.length) + conflicts.length) %
      conflicts.length;
    const conflict = conflicts[offset];
    if (
      conflict !== undefined &&
      resolutionOf(picks, conflict) === undefined
    ) {
      return conflict;
    }
  }
  return undefined;
}

/** The decisions stored with the merge as the map the view works in: the inverse of {@link picksRequest}. */
export function picksFromList(
  picks: readonly GitMergePick[],
): ReadonlyMap<string, GitMergePick> {
  return new Map(
    picks.map((pick) => [pickKey(pick.recordId, pick.path), pick]),
  );
}

/**
 * The complete request for `resolveMerge`: every decision made so far, not only
 * the ones since the last call — the server replaces its stored set each time.
 * Sorted so the same choices always send the same list.
 */
export function picksRequest(
  picks: ReadonlyMap<string, GitMergePick>,
): readonly GitMergePick[] {
  return [...picks.values()].sort(
    (left, right) =>
      compare(left.recordId, right.recordId) || compare(left.path, right.path),
  );
}

/** The conflicts as one entry per record (or file), in the order the merge sorted them. */
export function groupConflicts(
  conflicts: readonly GitMergeConflict[],
): readonly MergeConflictGroup[] {
  const groups: MergeConflictGroup[] = [];
  const byRecord = new Map<string, GitMergeConflict[]>();
  for (const conflict of conflicts) {
    const key = `${conflict.kind}\0${conflict.recordId}`;
    let listed = byRecord.get(key);
    if (listed === undefined) {
      listed = [];
      byRecord.set(key, listed);
      groups.push({
        kind: conflict.kind,
        recordId: conflict.recordId,
        name: conflict.name,
        conflicts: listed,
      });
    }
    listed.push(conflict);
  }
  return groups;
}

function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
