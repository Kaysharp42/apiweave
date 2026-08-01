import { describe, it, expect } from "vitest";
import { presentationFor } from "./CustomEdge";
import type { NodeStatus } from "../types/NodeStatus";

/**
 * The edge state table (plan §5.2). An edge takes its state from the node it
 * leaves, so these are the only five appearances an edge can have.
 */
describe("edge presentation by source status", () => {
  it("draws an idle edge as a hairline with no motion", () => {
    const idle = presentationFor("idle");
    expect(idle.strokeWidth).toBe(1);
    expect(idle.stroke).toBe("var(--aw-border)");
    expect(idle.flowing).toBe(false);
    expect(idle.dash).toBeUndefined();
  });

  it("flows only while the source is running", () => {
    expect(presentationFor("running").flowing).toBe(true);

    const settled: NodeStatus[] = [
      "idle",
      "success",
      "error",
      "warning",
      "skipped",
    ];
    for (const status of settled) {
      expect(
        presentationFor(status).flowing,
        `${status} must not animate — motion means control is passing through`,
      ).toBe(false);
    }
  });

  it("thickens every traversed edge above the idle hairline", () => {
    for (const status of ["running", "success", "error", "warning"] as const) {
      expect(presentationFor(status).strokeWidth).toBeGreaterThan(
        presentationFor("idle").strokeWidth,
      );
    }
  });

  it("dashes a skipped edge and keeps it at hairline weight", () => {
    const skipped = presentationFor("skipped");
    expect(skipped.dash).toBe("2 6");
    expect(skipped.strokeWidth).toBe(1);
  });

  it("colours each state from its own status token", () => {
    expect(presentationFor("running").stroke).toContain("--aw-status-running");
    expect(presentationFor("success").stroke).toContain("--aw-status-success");
    expect(presentationFor("error").stroke).toContain("--aw-status-error");
    expect(presentationFor("warning").stroke).toContain("--aw-status-warning");
  });

  it("softens a traversed success edge rather than leaving it at full strength", () => {
    // A finished canvas should read as calm; only failure stays loud.
    expect(presentationFor("success").stroke).toContain("color-mix");
    expect(presentationFor("error").stroke).not.toContain("color-mix");
  });
});
