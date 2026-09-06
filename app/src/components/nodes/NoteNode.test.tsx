import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import NoteNode from "./NoteNode";

vi.mock("../../hooks/useNodeConfigPatch", () => ({
  useNodeConfigPatch: () => () => {},
}));

describe("NoteNode", () => {
  it("renders as an annotation instead of an executable node", () => {
    render(
      <ReactFlowProvider>
        <NoteNode
          id="note-1"
          type="note"
          selected={false}
          dragging={false}
          draggable
          selectable
          deletable
          zIndex={0}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{
            label: "Retry plan",
            config: { content: "Pause before the fallback request." },
          }}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByLabelText("Canvas note: Retry plan")).toBeTruthy();
    // The title is edited on the note itself — it has no details dialog.
    expect(screen.getByLabelText("Note title")).toHaveValue("Retry plan");
    expect(screen.getByText("Annotation")).toBeTruthy();
    expect(screen.getByDisplayValue("Pause before the fallback request.")).toBeTruthy();
    expect(screen.queryByLabelText(/Node status:/)).toBeNull();
  });
});
