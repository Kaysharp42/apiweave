import { fireEvent, render, screen } from "@testing-library/react";
import type { CanvasToolbarProps } from "../../../types/CanvasToolbarProps";
import { describe, expect, it, vi } from "vitest";
import { CanvasToolbar } from "../CanvasToolbar";

function renderToolbar(props: Partial<CanvasToolbarProps> = {}) {
  render(
    <CanvasToolbar
      onSave={vi.fn()}
      onUndo={vi.fn()}
      onRedo={vi.fn()}
      canUndo={false}
      canRedo={false}
      onGroup={vi.fn()}
      onUngroup={vi.fn()}
      canGroup={false}
      canUngroup={false}
      onHistory={vi.fn()}
      onJsonEditor={vi.fn()}
      onImport={vi.fn()}
      onCommandPalette={vi.fn()}
      onRun={vi.fn()}
      environments={[]}
      onEnvironmentChange={vi.fn()}
      {...props}
    />,
  );

  return screen.getByRole("toolbar", { name: "Workflow actions" });
}

describe("CanvasToolbar", () => {
  it("stays below the global popup layer", () => {
    // The stacking layer lives on the track the bar centres in, not on the bar
    // itself — the track is the positioned element.
    const track = renderToolbar().parentElement;

    expect(track).toHaveClass("z-20");
    expect(track).not.toHaveClass("z-50");
  });

  // `CanvasToolbarBand` tells the run camera how tall this bar is, and it only
  // ever describes one row. A `flex-wrap` here would make the camera frame
  // running nodes underneath the toolbar without anything failing loudly.
  it("never wraps to a second row", () => {
    const toolbar = renderToolbar();

    expect(toolbar).toHaveClass("flex-nowrap");
    expect(toolbar).not.toHaveClass("flex-wrap");
  });

  it("runs with the data file the user picks", () => {
    const onRunWithData = vi.fn();
    renderToolbar({ onRunWithData });
    const file = new File(["user\nann\n"], "users.csv", { type: "text/csv" });

    fireEvent.change(screen.getByLabelText("Data file to run with"), { target: { files: [file] } });

    expect(onRunWithData).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Run with data" })).toBeEnabled();
  });

  it("shows which iteration of a data-driven run is running", () => {
    renderToolbar({ onRunWithData: vi.fn(), isRunning: true, iteration: { groupId: "g", index: 3, count: 10 } });

    expect(screen.getByText("Iteration 3/10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run with data" })).toBeDisabled();
  });
});
