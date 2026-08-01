import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Motion on the connection layer reports state; it is never decoration
 * (DESIGN.md §7).
 *
 * ReactFlow's `animated` edge flag renders a dashed stroke marching from source
 * to target forever, independent of whether a run is happening. Two code paths
 * used to set it — the assertion pass/fail hydration in `workflowCanvas.ts` and
 * the parallel-branch handler in `WorkflowCanvas.tsx`'s `onConnect` — which left
 * the canvas in perpetual motion on a workflow that had never been run.
 *
 * Fixing one path and not the other was also a visual inconsistency: an edge
 * marched while you drew it and went still on reload. This scans the source
 * because the second path lives inside a `setEdges` callback in a 900-line
 * component, where the cheapest honest guard is the one that reads the file.
 *
 * The travelling dot in `CustomEdge` is the sanctioned way to show an edge
 * carrying control, and it is mounted only while the source node is running.
 */

const SCAN_DIRS = [join("src", "components"), join("src", "adapters")];
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function findSourceFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findSourceFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

/** `animated: true` on an object literal, ignoring comment lines. */
const ANIMATED_FLAG = /^\s*animated:\s*true\b/;

describe("connection layer motion", () => {
  it("never marks an edge permanently animated", () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of findSourceFiles(dir)) {
        const lines = readFileSync(file, "utf-8").split("\n");

        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
          if (ANIMATED_FLAG.test(line)) {
            violations.push(`${file}:${index + 1} — ${trimmed}`);
          }
        });
      }
    }

    expect(
      violations,
      "ReactFlow's `animated` flag dashes an edge forever, whether or not a run " +
        "is happening. Use CustomEdge's travelling dot, which is mounted from the " +
        "source node's live status:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("keeps the travelling dot gated on the source node's run state", () => {
    const source = readFileSync(join("src", "components", "CustomEdge.tsx"), "utf-8");

    // The dot mounts only when the presentation for the *source node's* status
    // says control is passing through — not from a flag stored on the edge.
    expect(source).toMatch(/const flowing = presentation\.flowing;/);
    expect(source).toMatch(/\{flowing && \(/);
    // And it disappears entirely under reduced motion, rather than parking on
    // the target handle and claiming control arrived.
    expect(source).toMatch(/aw-edge-flow-dot[^"]*motion-reduce:hidden/);
  });
});
