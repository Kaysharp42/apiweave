import { describe, expect, it } from "vitest";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { JsonValue } from "@shared/types/JsonValue";
import {
  acceptAllPicks,
  allConflictsResolved,
  groupConflicts,
  groupResolvedCount,
  nextUnresolved,
  pickKey,
  picksFromList,
  picksRequest,
  resolutionOf,
  resolvedCount,
  withSidePick,
  withValuePick,
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

const sidePick = (recordId: string, path: string, side: GitMergeSide) => ({
  recordId,
  path,
  side,
});
const valuePick = (recordId: string, path: string, value: JsonValue): GitMergePick => ({
  recordId,
  path,
  value,
});
const mapOf = (...picks: GitMergePick[]): ReadonlyMap<string, GitMergePick> =>
  new Map(picks.map((pick) => [pickKey(pick.recordId, pick.path), pick]));

const groups = groupConflicts([
  conflict({ recordId: "w1", path: "name" }),
  conflict({ recordId: "w1", path: "nodes.n1.label" }),
  conflict({ kind: "file", recordId: "README.md", name: "README.md", path: "" }),
]);

describe("pickKey", () => {
  it("keeps the record and place apart even when either contains the separator's neighbours", () => {
    expect(pickKey("w1", "name")).toBe("w1\0name");
    expect(pickKey("w1", "")).toBe("w1\0");
  });
});

describe("resolutionOf", () => {
  it("takes the pick at the place, or a copy pick above it", () => {
    expect(
      resolutionOf(mapOf(sidePick("w1", "nodes.n1.name", "ours")), conflict()),
    ).toEqual(sidePick("w1", "nodes.n1.name", "ours"));
    expect(
      resolutionOf(mapOf(sidePick("w1", "nodes.n1", "theirs")), conflict()),
    ).toEqual(sidePick("w1", "nodes.n1", "theirs"));
    expect(
      resolutionOf(mapOf(sidePick("w1", "", "theirs")), conflict()),
    ).toEqual(sidePick("w1", "", "theirs"));
  });

  it("applies a value only at the place it names", () => {
    // The engine's rule: a value replaces exactly its place, so it never stands
    // in for a field beneath it.
    expect(
      resolutionOf(mapOf(valuePick("w1", "nodes.n1", "Own")), conflict()),
    ).toBeUndefined();
    expect(
      resolutionOf(
        mapOf(valuePick("w1", "nodes.n1.name", "Own")),
        conflict({ path: "nodes.n1.name" }),
      ),
    ).toEqual(valuePick("w1", "nodes.n1.name", "Own"));
  });

  it("has no answer where nothing was picked", () => {
    expect(resolutionOf(new Map(), conflict())).toBeUndefined();
  });
});

describe("withSidePick and withValuePick", () => {
  it("settle exactly the place they name and keep everything else", () => {
    const before = mapOf(sidePick("w2", "", "ours"));

    const side = withSidePick(before, "w1", "name", "theirs");
    expect(side.get(pickKey("w1", "name"))).toEqual(sidePick("w1", "name", "theirs"));
    expect(side.get(pickKey("w2", ""))).toEqual(sidePick("w2", "", "ours"));

    const own = withValuePick(side, "w1", "name", 42);
    expect(own.get(pickKey("w1", "name"))).toEqual(valuePick("w1", "name", 42));
  });
});

describe("withWholeRecordPick", () => {
  it("settles the whole record and drops that record's field picks, so an old field cannot beat it", () => {
    const before = mapOf(
      sidePick("w1", "name", "ours"),
      sidePick("w1", "description", "theirs"),
      sidePick("w2", "name", "theirs"),
    );

    expect([...withWholeRecordPick(before, "w1", "theirs")]).toEqual([
      [pickKey("w2", "name"), sidePick("w2", "name", "theirs")],
      [pickKey("w1", ""), sidePick("w1", "", "theirs")],
    ]);
  });
});

describe("acceptAllPicks", () => {
  it("settles every listed record and file with one copy", () => {
    const picks = acceptAllPicks(groups, "ours");

    expect([...picks.values()]).toEqual([
      sidePick("w1", "", "ours"),
      sidePick("README.md", "", "ours"),
    ]);
    expect(resolvedCount(groups.flatMap((group) => group.conflicts), picks)).toBe(3);
  });
});

describe("counting what is settled", () => {
  const conflicts = groups.flatMap((group) => group.conflicts);

  it("counts a field's own decision, or its record's, and nothing else", () => {
    expect(resolvedCount(conflicts, new Map())).toBe(0);
    expect(resolvedCount(conflicts, mapOf(sidePick("w1", "name", "ours")))).toBe(1);
    expect(resolvedCount(conflicts, mapOf(sidePick("w1", "", "ours")))).toBe(2);
    expect(
      resolvedCount(
        conflicts,
        mapOf(sidePick("w1", "", "ours"), sidePick("README.md", "", "theirs")),
      ),
    ).toBe(3);
    expect(groupResolvedCount(groups[0]!, mapOf(sidePick("w1", "", "ours")))).toBe(2);
  });

  it("is all resolved only when every listed conflict has one", () => {
    expect(allConflictsResolved(conflicts, mapOf(sidePick("w1", "name", "ours")))).toBe(false);
    expect(
      allConflictsResolved(
        conflicts,
        mapOf(sidePick("w1", "", "ours"), sidePick("README.md", "", "theirs")),
      ),
    ).toBe(true);
  });
});

describe("nextUnresolved", () => {
  const conflicts = [
    conflict({ path: "name" }),
    conflict({ path: "description" }),
    conflict({ path: "method" }),
  ];
  const key = (path: string) => pickKey("w1", path);

  it("moves to the next or previous place still waiting, wrapping around", () => {
    const picks = mapOf(sidePick("w1", "description", "theirs"));

    expect(nextUnresolved(conflicts, picks, key("name"), 1)?.path).toBe("method");
    expect(nextUnresolved(conflicts, picks, key("method"), 1)?.path).toBe("name");
    expect(nextUnresolved(conflicts, picks, key("name"), -1)?.path).toBe("method");
    expect(nextUnresolved(conflicts, picks, key("description"), 1)?.path).toBe("method");
  });

  it("has nothing to offer once every place is settled", () => {
    const picks = mapOf(
      sidePick("w1", "name", "ours"),
      sidePick("w1", "description", "ours"),
      sidePick("w1", "method", "ours"),
    );
    expect(nextUnresolved(conflicts, picks, null, 1)).toBeUndefined();
  });
});

describe("picksFromList and picksRequest", () => {
  it("round-trip copy picks and values of the user's own, sorted", () => {
    const stored: readonly GitMergePick[] = [
      valuePick("w1", "description", "Written by hand"),
      sidePick("w2", "name", "theirs"),
      sidePick("w1", "", "ours"),
    ];

    const picks = picksFromList(stored);

    expect(picks.size).toBe(3);
    expect(picksRequest(picks)).toEqual([
      sidePick("w1", "", "ours"),
      valuePick("w1", "description", "Written by hand"),
      sidePick("w2", "name", "theirs"),
    ]);
  });
});

describe("groupConflicts", () => {
  it("keeps the merge's order and puts each record's fields in one group", () => {
    const listed = [
      conflict({ recordId: "w1", path: "description" }),
      conflict({ kind: "project", recordId: "p1", name: "Shop", path: "name" }),
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
      conflict({ kind: "environment", recordId: "same", name: "Same" }),
    ];
    expect(groupConflicts(listed).map((group) => group.kind)).toEqual([
      "workflow",
      "environment",
    ]);
  });
});

