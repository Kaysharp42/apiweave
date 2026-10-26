import { describe, expect, it } from "vitest";
import {
  MAX_MERGE_COMMIT_RECORDS,
  describeMergeCommit,
  mergeCommitSubject,
  splitMergeCommitIds,
} from "./mergeCommits";

describe("describeMergeCommit", () => {
  it("names who wrote the copy, and says so when there is no commit", () => {
    expect(describeMergeCommit(null)).toBe("Not present");
    expect(
      describeMergeCommit({
        sha: "3f9a2c1d8e7b",
        authorName: "Ada",
        authorDate: "2026-10-20T10:00:00Z",
        subject: "Rename",
      }),
    ).toBe("Ada · 3f9a2c1 · 2026-10-20");
  });
});

describe("mergeCommitSubject", () => {
  it("is the subject, or nothing where that side has no commit", () => {
    expect(mergeCommitSubject(null)).toBeNull();
    expect(
      mergeCommitSubject({
        sha: "a",
        authorName: "Ada",
        authorDate: "2026-10-20T10:00:00Z",
        subject: "Rename",
      }),
    ).toBe("Rename");
  });
});

describe("splitMergeCommitIds", () => {
  it("reads the first records in the merge's order and reports the rest unread", () => {
    const ids = ["w1", "w2", "w1", ...Array.from({ length: MAX_MERGE_COMMIT_RECORDS }, (_, index) => `x${index}`)];

    const { read, unread } = splitMergeCommitIds(ids);

    expect(read).toHaveLength(MAX_MERGE_COMMIT_RECORDS);
    expect(new Set(read).size).toBe(MAX_MERGE_COMMIT_RECORDS);
    expect(unread.size).toBe(2);
    expect(unread.has("x499")).toBe(true);
    expect(unread.has("x498")).toBe(true);
  });
});
