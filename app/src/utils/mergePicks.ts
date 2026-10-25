import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { GitMergeSidePick } from "@shared/types/GitMergeSidePick";
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
 * Choose a copy for a whole record: a pick at `path: ""` settles every field
 * below it. Its fields' own picks go, because the server prefers an exact path
 * over one above it — leaving both would let an old field pick beat the choice
 * the user just made.
 */
export function withWholeRecordPick(
  picks: ReadonlyMap<string, GitMergeSide>,
  recordId: string,
  side: GitMergeSide,
): ReadonlyMap<string, GitMergeSide> {
  const next = new Map<string, GitMergeSide>();
  for (const [key, value] of picks) {
    if (placeOf(key).recordId !== recordId) next.set(key, value);
  }
  next.set(pickKey(recordId, ""), side);
  return next;
}

/**
 * Choose a copy for one field: a field pick is the more specific intent, so it
 * wins that field. The record's whole-record pick stays, because the server
 * settles each field from its own pick first and the nearest pick above it
 * second — so the record's choice remains the fallback for every other field.
 */
export function withPathPick(
  picks: ReadonlyMap<string, GitMergeSide>,
  recordId: string,
  path: string,
  side: GitMergeSide,
): ReadonlyMap<string, GitMergeSide> {
  const next = new Map(picks);
  next.set(pickKey(recordId, path), side);
  return next;
}

/**
 * The decisions stored with the merge as the map the picker works in: the
 * inverse of {@link picksRequest}. A value of the user's own has no control in
 * this picker yet, so it is left out — the next request replaces the stored
 * set, and this dialog only makes copy picks.
 */
export function picksFromList(
  picks: readonly GitMergePick[],
): ReadonlyMap<string, GitMergeSide> {
  return new Map(
    picks.flatMap((pick) =>
      "side" in pick
        ? ([[pickKey(pick.recordId, pick.path), pick.side]] as const)
        : [],
    ),
  );
}

/** The copy settled for a conflict: its own field pick, else its record's whole-record pick. */
export function sideOfConflict(
  picks: ReadonlyMap<string, GitMergeSide>,
  conflict: GitMergeConflict,
): GitMergeSide | undefined {
  return (
    picks.get(pickKey(conflict.recordId, conflict.path)) ??
    picks.get(pickKey(conflict.recordId, ""))
  );
}

/** The conflicts as one card per record (or file), in the order the merge sorted them. */
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

/** Every listed conflict has a decision — its own or its record's whole-record one. */
export function allConflictsPicked(
  conflicts: readonly GitMergeConflict[],
  picks: ReadonlyMap<string, GitMergeSide>,
): boolean {
  return conflicts.every(
    (conflict) => sideOfConflict(picks, conflict) !== undefined,
  );
}

/**
 * The complete request for `resolveMerge`: every decision made so far, not only
 * the ones since the last call — the server replaces its stored set each time.
 * Sorted so the same choices always send the same list.
 */
export function picksRequest(
  picks: ReadonlyMap<string, GitMergeSide>,
): readonly GitMergeSidePick[] {
  return [...picks]
    .map(([key, side]) => ({ ...placeOf(key), side }))
    .sort(
      (left, right) =>
        compare(left.recordId, right.recordId) || compare(left.path, right.path),
    );
}

function compare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
