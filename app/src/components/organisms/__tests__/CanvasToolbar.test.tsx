import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasToolbar } from "../CanvasToolbar";

describe("CanvasToolbar", () => {
  it("stays below the global popup layer", () => {
    render(
      <CanvasToolbar
        onSave={vi.fn()}
        onHistory={vi.fn()}
        onJsonEditor={vi.fn()}
        onImport={vi.fn()}
        onRun={vi.fn()}
        environments={[]}
        onEnvironmentChange={vi.fn()}
      />,
    );

    const toolbar = screen.getByRole("toolbar", {
      name: "Workflow actions",
    });
    expect(toolbar).toHaveClass("z-20");
    expect(toolbar).not.toHaveClass("z-50");
  });
});
