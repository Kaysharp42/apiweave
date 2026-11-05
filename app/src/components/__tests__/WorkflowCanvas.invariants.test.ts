import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const canvasSource = readFileSync(
  join(process.cwd(), "src/components/WorkflowCanvas.tsx"),
  "utf8",
);

describe("WorkflowCanvas", () => {
  it("changes environment without announcing it in a toast", () => {
    expect(canvasSource).not.toMatch(/toast\.success\(`Environment:/);
    expect(canvasSource).toMatch(/setSelectedEnv\(wfId, processed\)/);
  });

  it("only mounts the minimap when the canvas preference is on", () => {
    expect(canvasSource).toMatch(/canvasPrefs\.minimapVisible && \(\s*<RunMiniMap/);
  });

  it("keeps the canvas tip off the canvas during a run", () => {
    expect(canvasSource).toMatch(
      /canvasPrefs\.tipsEnabled && canvasTip && !isRunning/,
    );
  });
});
