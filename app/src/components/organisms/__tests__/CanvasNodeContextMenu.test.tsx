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

  it("filters from the focused search box and adds with Enter", async () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });

    await userEvent.keyboard("delay");
    expect(screen.getByRole("menuitem", { name: /Delay/i })).toBeInTheDocument();
    expect(screen.queryByText("GET Request")).not.toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: "delay", label: "Delay" }),
    );
  });

  it("wraps arrow navigation around the flattened list", async () => {
    const onSelect = vi.fn();
    renderMenu({ onSelect });

    // Up from the first row lands on the last node of the last section.
    await userEvent.keyboard("{ArrowUp}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ type: "group" }),
    );
  });

  it("closes when Escape is pressed", async () => {
    const onClose = vi.fn();
    renderMenu({ onClose });

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
