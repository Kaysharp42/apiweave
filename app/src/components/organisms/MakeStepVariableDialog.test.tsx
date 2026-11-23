import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CanvasNode } from "../../types/CanvasNode";
import { MakeStepVariableDialog } from "./MakeStepVariableDialog";

const pick: CanvasNode = {
  id: "b1",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { config: { action: "click", locator: { kind: "role", role: "option", name: "Elroy" } } },
};
const check: CanvasNode = {
  id: "b2",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { config: { action: "expect-text", locator: { kind: "css", value: "#who" }, text: "Elroy", match: "contains" } },
};

function renderDialog(variables: Record<string, string> = {}) {
  const onSubmit = vi.fn();
  render(<MakeStepVariableDialog open node={pick} nodes={[pick, check]} variables={variables} onClose={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
}

describe("MakeStepVariableDialog", () => {
  it("preselects the only literal, suggests a name, and offers the other step", () => {
    const onSubmit = renderDialog();
    expect(screen.getByText("Elroy")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Variable name").value).toBe("optionName");
    const others = screen.getByLabelText<HTMLInputElement>("Also replace in 1 other step with the same value");
    expect(others.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Make variable" }));
    expect(onSubmit).toHaveBeenCalledWith({ field: "locator.name", name: "optionName", everywhere: true });
  });

  it("refuses a name that already holds a different value", () => {
    const onSubmit = renderDialog({ client: "Ada" });
    fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: "client" } });
    expect(screen.getByText("client already holds a different value. Pick another name.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Make variable" }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Variable name"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
