import { expect, test } from "vitest";
import type { WorkflowNode } from "@shared/types/WorkflowNode";
import { revisionDiff, revisionSourceLabel } from "./revisionDiff";

const node = (nodeId: string, duration = 1): WorkflowNode =>
  ({ nodeId, type: "delay", position: { x: 0, y: 0 }, config: { duration } }) as WorkflowNode;

test("counts the nodes a restore adds back, removes and changes", () => {
  expect(
    revisionDiff([node("a"), node("b", 2), node("new")], [node("a"), node("b", 5), node("gone")]),
  ).toEqual({ added: 1, removed: 1, changed: 1 });
  expect(revisionDiff([node("a")], [node("a")])).toEqual({ added: 0, removed: 0, changed: 0 });
});

test("names the writer a revision was kept before", () => {
  expect(revisionSourceLabel("agent:Claude Code")).toBe("agent Claude Code");
  expect(revisionSourceLabel("canvas")).toBe("canvas edits");
  expect(revisionSourceLabel("cloud")).toBe("cloud sync");
  expect(revisionSourceLabel("git")).toBe("git sync");
});
