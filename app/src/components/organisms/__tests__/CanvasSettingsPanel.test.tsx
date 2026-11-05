import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppContext } from "../../../App";
import { CanvasSettingsPanel } from "../CanvasSettingsPanel";
import useCanvasPrefsStore from "../../../stores/CanvasPrefsStore";

beforeEach(() => {
  useCanvasPrefsStore.setState({ minimapVisible: false });
});

function renderPanel(autoSaveEnabled: boolean) {
  const setAutoSaveEnabled = vi.fn();
  const setThemePreference = vi.fn();
  render(
    <AppContext.Provider
      value={{
        darkMode: false,
        themePreference: "system",
        setThemePreference,
        autoSaveEnabled,
        setAutoSaveEnabled,
      }}
    >
      <CanvasSettingsPanel />
    </AppContext.Provider>,
  );
  return { setAutoSaveEnabled, setThemePreference };
}

describe("CanvasSettingsPanel auto-save", () => {
  it("shows the auto-save setting and turns it off", async () => {
    const user = userEvent.setup();
    const { setAutoSaveEnabled } = renderPanel(true);

    const toggle = screen.getByRole("checkbox", { name: "Auto-save" });
    expect(toggle).toBeChecked();
    expect(screen.getByText(/700 ms after you stop editing/)).toBeInTheDocument();

    await user.click(toggle);

    expect(setAutoSaveEnabled).toHaveBeenCalledWith(false);
  });

  it("shows an unchecked switch when auto-save is off", () => {
    renderPanel(false);

    expect(screen.getByRole("checkbox", { name: "Auto-save" })).not.toBeChecked();
  });

  it("keeps the canvas preferences in the same panel", () => {
    renderPanel(true);

    expect(
      screen.getByRole("checkbox", { name: "Snap to grid" }),
    ).toBeInTheDocument();
  });

  it("keeps the minimap off until the user asks for it", async () => {
    const user = userEvent.setup();
    renderPanel(true);

    const toggle = screen.getByRole("checkbox", { name: "Show minimap" });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);

    expect(useCanvasPrefsStore.getState().minimapVisible).toBe(true);
  });

  it("offers System, Light and Dark and defaults to System", async () => {
    const user = userEvent.setup();
    const { setThemePreference } = renderPanel(true);

    expect(screen.getByRole("button", { name: "Follow system" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Follow system" }));
    await user.click(screen.getByRole("option", { name: "Dark" }));

    expect(setThemePreference).toHaveBeenCalledWith("dark");
  });
});
