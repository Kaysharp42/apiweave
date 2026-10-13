import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkflowJsonEditor } from "./WorkflowJsonEditor";

const workflow = { nodes: [], edges: [] };

function renderEditor() {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <WorkflowJsonEditor
      open
      workflowJson={workflow}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  const editor = screen.getByLabelText("Workflow JSON editor");
  return { onApply, onClose, editor };
}

const edited = JSON.stringify({ nodes: [], edges: [], name: "edited" });

describe("WorkflowJsonEditor keeps changed text on close", () => {
  test("Escape with unchanged text just closes", () => {
    const { onClose, editor } = renderEditor();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape with changed text asks instead of closing", async () => {
    const { onClose, onApply, editor } = renderEditor();
    fireEvent.change(editor, { target: { value: edited } });

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(await screen.findByText("Apply your JSON changes?")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(editor).toHaveValue(edited);
  });

  test("Escape on the prompt keeps editing, it does not close the editor", async () => {
    const { onClose, editor } = renderEditor();
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.keyDown(editor, { key: "Escape" });
    const keep = await screen.findByRole("button", { name: "Keep editing" });

    fireEvent.keyDown(keep, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByText("Apply your JSON changes?")).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(editor).toHaveValue(edited);
  });

  test("Apply from the prompt applies the changed text", async () => {
    const { onApply, editor } = renderEditor();
    fireEvent.change(editor, { target: { value: edited } });
    fireEvent.keyDown(editor, { key: "Escape" });

    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith(JSON.parse(edited));
  });

  test("Discard from the prompt closes without applying", async () => {
    const { onApply, onClose, editor } = renderEditor();
    fireEvent.change(editor, { target: { value: "{ not json" } });
    fireEvent.keyDown(editor, { key: "Escape" });

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
