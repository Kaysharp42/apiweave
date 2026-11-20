import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NodeModal } from "./NodeModal";
import type { NodeModalNode } from "../types/NodeModalNode";
import type { NodeStep } from "../types/NodeStep";

afterEach(() => {
  vi.restoreAllMocks();
});

const node: NodeModalNode = {
  id: "start-1",
  type: "start",
  position: { x: 0, y: 0 },
  data: { label: "Start", config: {} },
};

function step(nodeId: string, overrides: Partial<NodeStep> = {}): NodeStep {
  return {
    nodeId,
    label: nodeId.toUpperCase(),
    detail: null,
    nodeType: "http-request",
    handle: null,
    ranLastRun: false,
    ...overrides,
  };
}

function renderModal(
  steps: {
    previous?: NodeStep[];
    next?: NodeStep[];
    arrivedBy?: "previous" | "next";
  } = {},
) {
  const onSave = vi.fn();
  const onSaveWorkflow = vi.fn();
  const onClose = vi.fn();
  const onStep = vi.fn();
  render(
    <NodeModal
      open
      node={node}
      onClose={onClose}
      onSave={onSave}
      onSaveWorkflow={onSaveWorkflow}
      steps={{
        previous: steps.previous ?? [],
        next: steps.next ?? [],
        arrivedBy: steps.arrivedBy ?? null,
        onStep,
      }}
      workspaceId="ws"
      currentWorkflowId="wf"
      getNodeOutput={() => undefined}
    />,
  );
  const name = screen.getByLabelText("Node name");
  fireEvent.change(name, { target: { value: "Renamed" } });
  return { onSave, onSaveWorkflow, onClose, onStep, name };
}

const steppedTo = (onStep: ReturnType<typeof vi.fn>) =>
  (onStep.mock.calls.at(-1)?.[1] as NodeStep | undefined)?.nodeId;

describe("NodeModal steps to the neighbouring nodes", () => {
  test("reads as a direction, names where it goes, and disables one with nowhere to go", () => {
    renderModal({ next: [step("login")] });

    // Node names repeat ("Click", "Click"), so the visible text is the direction.
    expect(screen.getByRole("button", { name: "Next node: LOGIN" })).toHaveTextContent(/^Next$/);
    expect(screen.getByRole("button", { name: "Previous node" })).toHaveAttribute(
      "title",
      "Start of the workflow",
    );
  });

  test("a bare arrow in the name field moves the caret; Alt+arrow steps, applying the draft first", () => {
    const { onSave, onStep, name } = renderModal({ next: [step("login")] });

    fireEvent.keyDown(name, { key: "ArrowRight" });
    expect(onStep).not.toHaveBeenCalled();

    fireEvent.keyDown(name, { key: "ArrowRight", altKey: true });
    expect(onStep).toHaveBeenCalledWith("next", step("login"));
    expect(savedLabel(onSave)).toBe("Renamed");
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(
      onStep.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test("at a fork the arrow opens a picker on the branch the last run took, and again takes it", () => {
    const { onStep } = renderModal({
      next: [
        step("ok", { handle: "pass" }),
        step("bad", { handle: "fail", ranLastRun: true }),
      ],
    });

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onStep).not.toHaveBeenCalled();
    const items = within(screen.getByRole("menu", { name: "Next node" })).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("pass"),
      expect.stringContaining("fail"),
    ]);

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(steppedTo(onStep)).toBe("bad");
  });

  test("a number picks a branch; Escape closes the picker and leaves the editor open", () => {
    const { onStep, onClose } = renderModal({
      next: [step("ok", { handle: "pass" }), step("bad", { handle: "fail" })],
    });

    fireEvent.click(screen.getByRole("button", { name: /choose one of 2 branches/ }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "1" });
    expect(steppedTo(onStep)).toBe("ok");
  });

  test("opened by a step, focus is on that step's button so the bare arrow keeps working", async () => {
    renderModal({ previous: [step("a")], next: [step("c")], arrivedBy: "next" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next node: C" })).toHaveFocus(),
    );
  });

  test("a step keeps the dialog and its layout, and replaces only the node's fields", () => {
    const props = {
      open: true,
      onClose: vi.fn(),
      onSave: vi.fn(),
      onSaveWorkflow: vi.fn(),
      steps: { previous: [], next: [], arrivedBy: null, onStep: vi.fn() },
      workspaceId: "ws",
      currentWorkflowId: "wf",
      getNodeOutput: () => undefined,
    };
    const { rerender } = render(<NodeModal {...props} node={node} />);
    const dialog = screen.getByRole("dialog");
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(screen.getByRole("button", { name: "Hide response" }));

    const end: NodeModalNode = {
      ...node,
      id: "end-1",
      type: "end",
      data: { label: "Finish", config: {} },
    };
    rerender(<NodeModal {...props} node={end} steps={{ ...props.steps, arrivedBy: "next" }} />);

    // The layout outlives the step: rebuilding it lays the split out a frame
    // late, drawing the response pane over the form.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(screen.getByRole("button", { name: "Save" })).toBe(saveButton);
    expect(screen.getByRole("button", { name: "Show response" })).toBeInTheDocument();
    expect(screen.getByLabelText("Node name")).toHaveValue("Finish");

    // The draft is the new node's: a rename applies to it alone.
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Done" } });
    fireEvent.click(saveButton);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave.mock.calls[0]?.[0]).toMatchObject({ id: "end-1", data: { label: "Done" } });
  });

  test("a merge offers each input to step back to", () => {
    const { onStep } = renderModal({ previous: [step("b"), step("c")] });

    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    fireEvent.click(screen.getByRole("menuitem", { name: /C/ }));

    expect(onStep).toHaveBeenCalledWith("previous", step("c"));
  });
});

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
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
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
