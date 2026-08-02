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
 * The sanctioned way to show an edge carrying control is `CustomEdge`'s
 * one-shot fill: the state colour is revealed source→target and a head rides
 * that reveal. It is mounted for exactly one traversal and is driven by the
 * source node's live status, never by a flag stored on the edge.
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
        "is happening. Use CustomEdge's one-shot fill, which is driven by the " +
        "source node's live status:\n" +
        violations.join("\n"),
    ).toEqual([]);
  });

  it("mounts the fill head for one traversal and no longer", () => {
    const source = readFileSync(join("src", "components", "CustomEdge.tsx"), "utf-8");

    // The head rides a fill that is in flight — not a per-edge flag, and not a
    // loop. `filling` is set when the phase *becomes* traversed...
    expect(source).toMatch(/\{filling && \(/);
    // ...and cleared by the reveal's own transitionend, which is what keeps the
    // head's lifetime tied to the reveal instead of to a duration copied into
    // JS that can drift from the CSS one.
    expect(source).toMatch(/onTransitionEnd/);
    expect(source).toMatch(/stroke-dashoffset["']\)?\s*\)?\s*setFilling\(false\)/);
    // And it disappears entirely under reduced motion, rather than parking on
    // the target handle and claiming control is still arriving.
    expect(source).toMatch(/aw-edge-flow-dot[^"]*motion-reduce:hidden/);
  });

  it("never loops the edge fill", () => {
    const config = readFileSync("tailwind.config.js", "utf-8");
    // The declaration, not the comment above it that names the same keyframe.
    const fill = config
      .split("\n")
      .find((line) => /^\s*"edge-fill":/.test(line));

    expect(fill, "the edge fill animation must be registered").toBeDefined();
    // A traversal happens once. `infinite` here would put the canvas back into
    // perpetual motion by a different route than the `animated` flag above.
    expect(fill).not.toContain("infinite");
    expect(fill).toContain("forwards");
  });

  it("reveals the fill rather than snapping the edge to its final colour", () => {
    const css = readFileSync(join("src", "styles", "node-motion.css"), "utf-8");

    // The instant flip this replaced: the edge took its end colour the moment
    // the source settled. The reveal has to be a transition on the overlay, and
    // the colour crossfade has to be there too, or a status change still snaps.
    expect(css).toMatch(/\.aw-edge-fill\s*\{[^}]*stroke-dashoffset\s+var\(--aw-dur-edge-fill\)/);
    expect(css).toMatch(/\.aw-edge-fill\s*\{[^}]*stroke\s+var\(--aw-dur-fast\)/);
  });
});
