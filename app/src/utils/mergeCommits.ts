import type { MergeSideCommit } from "@shared/types/MergeSideCommit";

/** What one side's copy of a record or file is missing, in the picker's words. */
export const NOT_PRESENT = "Not present";

/** "Ada Lovelace · 3f9a2c1 · 2026-10-20": who last wrote this side, and when. */
export function describeMergeCommit(commit: MergeSideCommit | null): string {
  if (commit === null) return NOT_PRESENT;
  return `${commit.authorName} · ${commit.sha.slice(0, 7)} · ${commit.authorDate.slice(0, 10)}`;
}

/** The commit's subject, or null where that side has no commit to name. */
export function mergeCommitSubject(
  commit: MergeSideCommit | null,
): string | null {
  return commit === null ? null : commit.subject;
}

/**
 * How many record ids one read of merge commits asks about: the picker reads
 * what it lists, and the rest say their details are unavailable rather than
 * silently showing none.
 */
export const MAX_MERGE_COMMIT_RECORDS = 500;

/** The record ids a read covers, and those it leaves unread: the first in the merge's order. */
export function splitMergeCommitIds(recordIds: readonly string[]): {
  readonly read: readonly string[];
  readonly unread: ReadonlySet<string>;
} {
  const unique = [...new Set(recordIds)];
  return {
    read: unique.slice(0, MAX_MERGE_COMMIT_RECORDS),
    unread: new Set(unique.slice(MAX_MERGE_COMMIT_RECORDS)),
  };
}
