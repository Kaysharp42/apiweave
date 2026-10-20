import { describe, expect, it } from "vitest";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import {
  allConflictsPicked,
  groupConflicts,
  keepListedPicks,
  pickKey,
  picksRequest,
  sideOfConflict,
  withPathPick,
  withWholeRecordPick,
} from "./mergePicks";

function conflict(overrides: Partial<GitMergeConflict> = {}): GitMergeConflict {
  return {
    kind: "workflow",
    recordId: "w1",
    name: "Checkout",
    path: "nodes.n1.name",
    base: "Base",
    ours: "Mine",
    theirs: "Remote",
    ...overrides,
  };
}

const picks = (
  entries: readonly (readonly [string, string, GitMergeSide])[],
): ReadonlyMap<string, GitMergeSide> =>
  new Map(entries.map(([recordId, path, side]) => [pickKey(recordId, path), side]));

describe("pickKey", () => {
  it("keeps the record and place apart even when either contains the separator's neighbours", () => {
    expect(pickKey("w1", "name")).toBe("w1\0name");
    expect(pickKey("w1", "")).toBe("w1\0");
  });
});

describe("withWholeRecordPick", () => {
  it("settles the whole record and drops that record's field picks, so an old field cannot beat it", () => {
    const before = picks([
      ["w1", "name", "ours"],
      ["w1", "description", "theirs"],
      ["w2", "name", "theirs"],
    ]);

    expect([...withWholeRecordPick(before, "w1", "theirs")]).toEqual([
      [pickKey("w2", "name"), "theirs"],
      [pickKey("w1", ""), "theirs"],
    ]);
  });

  it("replaces an earlier whole-record choice", () => {
    const before = picks([["w1", "", "ours"]]);

    expect([...withWholeRecordPick(before, "w1", "theirs")]).toEqual([
      [pickKey("w1", ""), "theirs"],
    ]);
  });
});

describe("withPathPick", () => {
  it("drops the record's whole-record choice and keeps its other field choices", () => {
    const before = picks([
      ["w1", "", "theirs"],
      ["w1", "description", "ours"],
      ["w2", "", "ours"],
    ]);

    expect([...withPathPick(before, "w1", "name", "theirs")]).toEqual([
      [pickKey("w1", "description"), "ours"],
      [pickKey("w2", ""), "ours"],
      [pickKey("w1", "name"), "theirs"],
    ]);
  });
});

describe("sideOfConflict", () => {
  it("prefers the field's own pick over the whole-record one", () => {
    const chosen = picks([
      ["w1", "", "theirs"],
      ["w1", "name", "ours"],
    ]);

    expect(sideOfConflict(chosen, conflict({ path: "name" }))).toBe("ours");
    expect(sideOfConflict(chosen, conflict({ path: "description" }))).toBe("theirs");
  });

  it("has no answer where nothing was picked", () => {
    expect(sideOfConflict(new Map(), conflict())).toBeUndefined();
  });
});

describe("groupConflicts", () => {
  it("keeps the merge's order and puts each record's fields in one group", () => {
    const listed = [
      conflict({ recordId: "w1", path: "description" }),
      conflict({ kind: "project", recordId: "p1", path: "name" }),
      conflict({ recordId: "w1", path: "name" }),
    ];

    expect(
      groupConflicts(listed).map((group) => ({
        kind: group.kind,
        recordId: group.recordId,
        paths: group.conflicts.map((entry) => entry.path),
      })),
    ).toEqual([
      { kind: "workflow", recordId: "w1", paths: ["description", "name"] },
      { kind: "project", recordId: "p1", paths: ["name"] },
    ]);
  });

  it("keeps records of different kinds apart even when their ids collide", () => {
    const listed = [
      conflict({ kind: "workflow", recordId: "same" }),
      conflict({ kind: "environment", recordId: "same" }),
    ];

    expect(groupConflicts(listed).map((group) => group.kind)).toEqual([
      "workflow",
      "environment",
    ]);
  });
});

describe("allConflictsPicked", () => {
  it("accepts a field's own pick or its record's whole-record pick", () => {
    const listed = [conflict({ path: "name" }), conflict({ path: "description" })];

    expect(allConflictsPicked(listed, new Map())).toBe(false);
    expect(allConflictsPicked(listed, picks([["w1", "", "ours"]]))).toBe(true);
    expect(
      allConflictsPicked(
        listed,
        picks([
          ["w1", "name", "ours"],
          ["w1", "description", "theirs"],
        ]),
      ),
    ).toBe(true);
    expect(allConflictsPicked(listed, picks([["w1", "name", "ours"]]))).toBe(false);
  });

  it("is settled when nothing is waiting", () => {
    expect(allConflictsPicked([], new Map())).toBe(true);
  });
});

describe("picksRequest", () => {
  it("sends every decision made so far, sorted so the same choices give the same request", () => {
    const chosen = picks([
      ["w2", "name", "theirs"],
      ["w1", "", "ours"],
      ["w1", "description", "theirs"],
    ]);

    expect(picksRequest(chosen)).toEqual([
      { recordId: "w1", path: "", side: "ours" },
      { recordId: "w1", path: "description", side: "theirs" },
      { recordId: "w2", path: "name", side: "theirs" },
    ]);
  });
});

describe("keepListedPicks", () => {
  it("keeps decisions on listed places and whole-record decisions for a listed record, and drops the rest", () => {
    const before = picks([
      ["w1", "name", "ours"],
      ["w1", "gone", "theirs"],
      ["w1", "", "ours"],
      ["w2", "", "theirs"],
      ["w3", "name", "ours"],
    ]);
    const remaining = [conflict({ recordId: "w1", path: "name" }), conflict({ recordId: "w3", path: "description" })];

    expect([...keepListedPicks(remaining, before)]).toEqual([
      [pickKey("w1", "name"), "ours"],
      [pickKey("w1", ""), "ours"],
    ]);
  });
});
