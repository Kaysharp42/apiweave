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
