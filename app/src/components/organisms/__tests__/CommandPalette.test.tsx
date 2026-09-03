import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../CommandPalette";
import type { CanvasCommand } from "../../../types/CanvasCommand";

const run = vi.fn();
const commands: CanvasCommand[] = [
  {
    id: "workflow.save",
    title: "Save workflow",
    group: "Workflow",
    keywords: ["save", "persist"],
    when: () => true,
    run,
  },
  {
    id: "workflow.run",
    title: "Run workflow",
    group: "Workflow",
    keywords: ["run", "execute"],
    when: () => false,
    run: vi.fn(),
  },
];

describe("CommandPalette", () => {
  it("only shows available commands and runs a selected command", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);

    expect(screen.getByText("Save workflow")).toBeInTheDocument();
    expect(screen.queryByText("Run workflow")).not.toBeInTheDocument();

    await user.click(screen.getByText("Save workflow"));

    expect(run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("filters commands by title and keywords", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open commands={commands} onClose={vi.fn()} />);

    await user.type(screen.getByRole("combobox"), "persist");

    expect(screen.getByText("Save workflow")).toBeInTheDocument();
  });
});
