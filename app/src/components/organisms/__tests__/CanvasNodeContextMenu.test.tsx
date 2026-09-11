import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasNodeContextMenu } from "../CanvasNodeContextMenu";
import { PaletteProvider } from "../../../contexts/PaletteContext";

function renderMenu(props: Partial<{ onSelect: () => void; onClose: () => void }> = {}) {
  return render(
    <PaletteProvider>
      <CanvasNodeContextMenu
        x={120}
        y={180}
        workspaceId=""
        onSelect={props.onSelect ?? vi.fn()}
        onClose={props.onClose ?? vi.fn()}
      />
    </PaletteProvider>,
  );
}

describe("CanvasNodeContextMenu", () => {
  it("shows the grouped palette and adds the clicked node", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    renderMenu({ onSelect, onClose });

    expect(
      screen.getByRole("menu", { name: "Add node to canvas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Streaming")).toBeInTheDocument();
    expect(screen.getByText("Control Flow")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("menuitem", { name: /GET Request/i }),
    );

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "http-request",
        label: "GET Request",
        method: "GET",
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("filters nodes from the focused search box", async () => {
    renderMenu();

    await userEvent.keyboard("delay");

    expect(screen.getByRole("menuitem", { name: /Delay/i })).toBeInTheDocument();
    expect(screen.queryByText("GET Request")).not.toBeInTheDocument();
  });

  it("closes when Escape is pressed", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
