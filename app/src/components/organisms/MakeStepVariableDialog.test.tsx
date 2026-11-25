import { describe, expect, it, vi } from "vitest";
import { useEffect, useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { JsonValue } from "@shared/types/JsonValue";
import type { CanvasNode } from "../../types/CanvasNode";
import { useMakeStepVariable } from "../../hooks/useMakeStepVariable";
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
const alsoPick: CanvasNode = { ...pick, id: "b3" };
const typed: CanvasNode = {
  id: "f1",
  type: "browser",
  position: { x: 0, y: 0 },
  data: { config: { action: "fill", locator: { kind: "label", value: "Search" }, value: "ahm" } },
};
const typedAgain: CanvasNode = { ...typed, id: "f2" };

function renderDialog(variables: Record<string, string> = {}, node: CanvasNode = pick, nodes: readonly CanvasNode[] = [pick, check, alsoPick]) {
  const onSubmit = vi.fn();
  render(<MakeStepVariableDialog open node={node} nodes={nodes} variables={variables} onClose={vi.fn()} onSubmit={onSubmit} />);
  return onSubmit;
}

/** The edit under test: the step's typed text becomes a placeholder; its element label stays. */
const templatedValue: CanvasNode = {
  ...typed,
  data: { ...typed.data, config: { action: "fill", locator: { kind: "label", value: "Search" }, value: "{{variables.term}}" } },
};

/**
 * The dialog as WorkflowCanvas wires it: the nodes are committed state, the
 * ref a save reads catches up with them only after the render that received
 * them, and the dialog is keyed by the node it is open for.
 */
function CanvasLike({ setVariable }: { setVariable: (name: string, value: JsonValue) => void }) {
  const [nodes, setNodes] = useState<CanvasNode[]>([typed]);
  const nodesRef = useRef<CanvasNode[]>([typed]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  const make = useMakeStepVariable({ nodes, nodesRef, setNodes, variables: {}, setVariable });
  return (
    <div>
      <button type="button" onClick={() => make.start(typed.id)}>Open step</button>
      <button type="button" onClick={() => setNodes([templatedValue])}>Template the value</button>
      <span data-testid="dialog-state">{make.dialog.open ? "open" : "closed"}</span>
      <MakeStepVariableDialog
        key={`variable-${make.dialog.nodeId ?? "none"}`}
        open={make.dialog.open}
        node={make.dialog.node}
        nodes={make.dialog.nodes}
        variables={make.dialog.variables}
        onClose={make.dialog.onClose}
        onSubmit={make.dialog.onSubmit}
      />
    </div>
  );
}

describe("MakeStepVariableDialog", () => {
  it("preselects the only literal, suggests a name, and offers the other step with the same element text", () => {
    const onSubmit = renderDialog();
    expect(screen.getByText("Elroy")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Variable name").value).toBe("optionName");
    const others = screen.getByLabelText<HTMLInputElement>("Also replace the same element text in 1 other step");
    expect(others.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Make variable" }));
    expect(onSubmit).toHaveBeenCalledWith({ field: "locator.name", name: "optionName", everywhere: true });
  });

  it("counts only the steps holding the same text in the value family, and says so", () => {
    renderDialog({}, typed, [typed, typedAgain, pick]);
    expect(screen.getByLabelText<HTMLInputElement>("Also replace the same value in 1 other step").checked).toBe(true);
  });

  it("refuses a name that already holds a different value", () => {
    const onSubmit = renderDialog({ client: "Ada" });
    fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: "client" } });
    expect(screen.getByText("client already holds a different value. Pick another name.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Make variable" }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Variable name"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the typed name and shows the error when a variable takes the name while the dialog is open", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <MakeStepVariableDialog open node={pick} nodes={[pick]} variables={{}} onClose={vi.fn()} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText("Variable name"), { target: { value: "client" } });
    // A variable named client gains a different value while the dialog is open.
    rerender(<MakeStepVariableDialog open node={pick} nodes={[pick]} variables={{ client: "Ada" }} onClose={vi.fn()} onSubmit={onSubmit} />);
    expect(screen.getByLabelText<HTMLInputElement>("Variable name").value).toBe("client");
    expect(screen.getByText("client already holds a different value. Pick another name.")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Make variable" }).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Variable name"), { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes itself when the literal it is open for is taken away", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <MakeStepVariableDialog open node={typed} nodes={[typed]} variables={{}} onClose={onClose} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Make variable" })).toBeTruthy();
    // The chosen literal (the typed text, the first of two) becomes a
    // placeholder; the step keeps its other literal, but not this one.
    const templated: CanvasNode = {
      ...typed,
      data: { config: { action: "fill", locator: { kind: "label", value: "Search" }, value: "{{variables.term}}" } },
    };
    rerender(<MakeStepVariableDialog open node={templated} nodes={[templated]} variables={{}} onClose={onClose} onSubmit={vi.fn()} />);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("releases the open dialog when its literal becomes a placeholder under the canvas's ref order, and opens it again", () => {
    render(<CanvasLike setVariable={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open step" }));
    expect(screen.getByTestId("dialog-state").textContent).toBe("open");
    expect(screen.getByLabelText<HTMLInputElement>("Variable name").value).toBe("search");
    // An edit templates the step's typed text while the dialog is open. The
    // canvas's ref order hands the hook the new nodes only after this render.
    fireEvent.click(screen.getByRole("button", { name: "Template the value" }));
    expect(screen.getByTestId("dialog-state").textContent).toBe("closed");
    // The step still has its element label, so the action opens a fresh
    // dialog, preselecting the literal that remains.
    fireEvent.click(screen.getByRole("button", { name: "Open step" }));
    expect(screen.getByTestId("dialog-state").textContent).toBe("open");
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Variable name").value).toBe("elementLabel");
  });
});
