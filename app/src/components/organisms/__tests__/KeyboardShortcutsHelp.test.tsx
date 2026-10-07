import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KeyboardShortcutsHelp } from "../KeyboardShortcutsHelp";
import { KEYBOARD_SHORTCUTS } from "../../../constants/keyboardShortcuts";

describe("KeyboardShortcutsHelp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists every shortcut the handlers answer, undo, redo and grouping included", () => {
    render(<KeyboardShortcutsHelp open onClose={vi.fn()} />);

    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(screen.getByText(shortcut.description)).toBeInTheDocument();
    }
    for (const description of ["Undo", "Redo", "Group selected nodes", "Ungroup selected frame"]) {
      expect(screen.getByText(description)).toBeInTheDocument();
    }
  });

  it("names the Mac keys on macOS", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<KeyboardShortcutsHelp open onClose={vi.fn()} />);

    expect(screen.getAllByText("⌘").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ctrl")).not.toBeInTheDocument();
  });
});
