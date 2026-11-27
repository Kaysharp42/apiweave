import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import VariablesPanel from "../VariablesPanel";

const workflow = vi.hoisted(() => ({
  updateVariable: vi.fn(),
  deleteVariablesWithCleanup: vi.fn(),
}));

vi.mock("../../contexts/WorkflowContext", () => ({
  useWorkflow: () => ({
    variables: { stored: "kept" },
    availableVariables: { stored: "kept", extracted: "from an extractor" },
    updateVariable: workflow.updateVariable,
    deleteVariablesWithCleanup: workflow.deleteVariablesWithCleanup,
  }),
}));

describe("VariablesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not offer Edit for a name that only an extractor produces", () => {
    render(
      <MemoryRouter>
        <VariablesPanel />
      </MemoryRouter>,
    );

    expect(screen.getByText("extracted")).toBeInTheDocument();
    // Only the stored variable can be edited; the extractor's name is shown,
    // and its Delete stays where it always was.
    expect(screen.getAllByRole("button", { name: "Edit variable" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete variable" })).toHaveLength(2);
  });
});
