import type { GitMergeNote } from "@shared/types/GitMergeNote";

/**
 * How many things the merge settled without asking, as the view's summary
 * counts them: a note about positions counts each node it moved, every other
 * note is one change.
 */
export function countMergeNotes(notes: readonly GitMergeNote[]): number {
  return notes.reduce(
    (count, note) => count + (note.type === "positions" ? note.nodeIds.length : 1),
    0,
  );
}

/** "12 changes merged automatically", or one for one. */
export function describeAutomaticMerge(count: number): string {
  return count === 1
    ? "1 change merged automatically"
    : `${count} changes merged automatically`;
}
