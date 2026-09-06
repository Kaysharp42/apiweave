import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import GroupNode from "./GroupNode";

const patchConfig = vi.fn();
vi.mock("../../hooks/useNodeConfigPatch", () => ({
  useNodeConfigPatch: () => patchConfig,
}));

function renderFrame(color?: string) {
  return render(
    <ReactFlowProvider>
      <GroupNode
        id="frame-1"
        type="group"
        selected
        dragging={false}
        draggable
        selectable
        deletable
        zIndex={0}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{ label: "Checkout", config: color === undefined ? {} : { color } }}
      />
    </ReactFlowProvider>,
  );
}

describe("GroupNode tints", () => {
  it("marks the stored tint and writes the one that is picked", async () => {
    renderFrame("violet");

    expect(screen.getByRole("button", { name: "violet" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "rose" }));
    expect(patchConfig).toHaveBeenCalledWith("color", "rose");
  });

  // An unknown stored name would leave `--aw-group-tint` undefined, which
  // collapses every color-mix that draws the frame.
  it("falls back to slate when the stored tint is not one of ours", () => {
    renderFrame("chartreuse");

    expect(screen.getByRole("button", { name: "slate" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
