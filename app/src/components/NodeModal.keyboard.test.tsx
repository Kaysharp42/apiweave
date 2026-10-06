import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NodeModal } from "./NodeModal";
import type { NodeModalNode } from "../types/NodeModalNode";

const node: NodeModalNode = {
  id: "start-1",
  type: "start",
  position: { x: 0, y: 0 },
  data: { label: "Start", config: {} },
};

function renderModal() {
  const onSave = vi.fn();
  const onSaveWorkflow = vi.fn();
  const onClose = vi.fn();
  render(
    <NodeModal
      open
      node={node}
      onClose={onClose}
      onSave={onSave}
      onSaveWorkflow={onSaveWorkflow}
      workspaceId="ws"
      currentWorkflowId="wf"
    />,
  );
  const name = screen.getByLabelText("Node name");
  fireEvent.change(name, { target: { value: "Renamed" } });
  return { onSave, onSaveWorkflow, onClose, name };
}

const savedLabel = (onSave: ReturnType<typeof vi.fn>) =>
  (onSave.mock.calls.at(-1)?.[0] as NodeModalNode | undefined)?.data.label;

describe("NodeModal keeps the draft", () => {
  test("Ctrl+S inside the editor applies the draft, then saves the workflow", () => {
    const { onSave, onSaveWorkflow, onClose, name } = renderModal();

    fireEvent.keyDown(name, { key: "s", ctrlKey: true });

    expect(savedLabel(onSave)).toBe("Renamed");
    expect(onSaveWorkflow).toHaveBeenCalledTimes(1);
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      onSaveWorkflow.mock.invocationCallOrder[0] ?? 0,
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Cmd+S does the same on macOS", () => {
    const { onSave, onSaveWorkflow, name } = renderModal();

    fireEvent.keyDown(name, { key: "s", metaKey: true });

    expect(savedLabel(onSave)).toBe("Renamed");
    expect(onSaveWorkflow).toHaveBeenCalledTimes(1);
  });

  test("Escape with an edited draft applies it instead of dropping it", () => {
    const { onSave, onClose, name } = renderModal();

    fireEvent.keyDown(name, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(savedLabel(onSave)).toBe("Renamed");
  });

  test("Ctrl+S then Escape applies once and keeps the edit", () => {
    const { onSave, onClose, name } = renderModal();

    fireEvent.keyDown(name, { key: "s", ctrlKey: true });
    fireEvent.keyDown(name, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(savedLabel(onSave)).toBe("Renamed");
  });

  test("Cancel still discards the draft", () => {
    const { onSave, onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
