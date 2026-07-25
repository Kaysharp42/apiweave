import { describe, expect, it } from "vitest";
import type { Run } from "@shared/types/Run";
import { buildTimeline, formatTimelineDuration, timelineBadgeStatus } from "../runTimeline";

function run(overrides: Partial<Run> & { results?: Run["results"] } = {}): Run {
  return {
    runId: "r1",
    workspaceId: "ws",
    workflowId: "wf",
    status: "completed",
    trigger: "manual",
    variables: {},
    results: [],
    nodeStatuses: {},
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as unknown as Run;
}

describe("buildTimeline", () => {
  it("positions bars by per-node startedAt and computes width from completedAt", () => {
    const r = run({
      startedAt: "2026-01-01T00:00:00.000Z",
      duration: 1500,
      results: [
        {
          nodeId: "n1",
          status: "passed",
          duration: 500,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.500Z",
        },
        {
          nodeId: "n2",
          status: "failed",
          duration: 1000,
          startedAt: "2026-01-01T00:00:00.500Z",
          completedAt: "2026-01-01T00:00:01.500Z",
          error: "boom",
        },
      ] as unknown as Run["results"],
    });
    const data = buildTimeline(r);
    expect(data.startEpoch).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toMatchObject({ nodeId: "n1", offsetMs: 0, widthMs: 500, hasTiming: true });
    expect(data.rows[1]).toMatchObject({ nodeId: "n2", offsetMs: 500, widthMs: 1000, hasTiming: true });
    expect(data.totalMs).toBe(1500);
  });

  it("falls back to duration-only bars when timestamps are absent (legacy run)", () => {
    const r = run({
      startedAt: null,
      results: [
        { nodeId: "n1", status: "passed", duration: 250 },
      ] as unknown as Run["results"],
    });
    const data = buildTimeline(r);
    expect(data.rows[0]).toMatchObject({ nodeId: "n1", offsetMs: null, widthMs: 250, hasTiming: false });
  });

  it("records secretRefs per row", () => {
    const r = run({
      results: [
        { nodeId: "n1", status: "passed", duration: 1, secretRefs: ["API_KEY", "TOKEN"] },
      ] as unknown as Run["results"],
    });
    const data = buildTimeline(r);
    expect(data.rows[0]?.secretRefs).toEqual(["API_KEY", "TOKEN"]);
  });
});

describe("formatTimelineDuration", () => {
  it("formats ms and seconds", () => {
    expect(formatTimelineDuration(0)).toBe("0ms");
    expect(formatTimelineDuration(450)).toBe("450ms");
    expect(formatTimelineDuration(1500)).toBe("1.50s");
  });
});

describe("timelineBadgeStatus", () => {
  it("maps runner statuses", () => {
    expect(timelineBadgeStatus("passed")).toBe("success");
    expect(timelineBadgeStatus("failed")).toBe("error");
    expect(timelineBadgeStatus("skipped")).toBe("idle");
    expect(timelineBadgeStatus("running")).toBe("info");
  });
});