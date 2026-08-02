import { describe, it, expect } from "vitest";
import { presentationFor } from "./CustomEdge";
import type { NodeStatus } from "../types/NodeStatus";

/**
 * The edge state table (plan §5.2). An edge takes its state from the node it
 * leaves, so these are the only five appearances an edge can have.
 */
describe("edge presentation by source status", () => {
  it("draws an idle edge as a hairline with no colour on it", () => {
    const idle = presentationFor("idle");
    expect(idle.strokeWidth).toBe(1);
    expect(idle.stroke).toBe("var(--aw-border)");
    expect(idle.phase).toBe("resting");
    expect(idle.dash).toBeUndefined();
  });

  it("arms the edge while the source works, and fills it once control leaves", () => {
    // A running node has not handed anything on yet. The stub says the edge is
    // next, not that it has been taken.
    expect(presentationFor("running").phase).toBe("armed");

    // Control has passed through: the fill covers the whole path and stays.
    for (const status of ["success", "error", "warning"] as const) {
      expect(
        presentationFor(status).phase,
        `${status} is a finished traversal — the edge must end up filled`,
      ).toBe("traversed");
    }

    // Nothing ever went down these.
    for (const status of ["idle", "skipped"] as const) {
      expect(presentationFor(status).phase).toBe("resting");
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

  it("never puts a status the run reached behind an unfilled edge", () => {
    // The guard against the defect this table replaced: an edge that reports a
    // terminal status but leaves the overlay hidden would show the source's
    // colour on the node and nothing on the path leaving it.
    const terminal: NodeStatus[] = ["success", "error", "warning"];
    for (const status of terminal) {
      expect(presentationFor(status).phase).not.toBe("resting");
    }
  });
});
