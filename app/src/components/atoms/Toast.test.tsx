import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AppContext } from "../../contexts/AppContext";
import { Toast } from "./Toast";

const captured = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

describe("Toast", () => {
  it("stacks bottom-right, clear of the status bar and the canvas action stack", () => {
    render(<Toast />);

    expect(captured.props?.position).toBe("bottom-right");
    expect(captured.props?.offset).toEqual({ bottom: 40, right: 56 });
  });

  it("narrows the stack so it clears the canvas zoom controls", () => {
    render(<Toast />);

    expect(captured.props?.style).toEqual({ "--width": "300px" });
  });

  it("follows the app theme rather than the OS theme", () => {
    render(
      <AppContext.Provider
        value={{
          darkMode: true,
          themePreference: "dark",
          setThemePreference: () => {},
          autoSaveEnabled: true,
          setAutoSaveEnabled: () => {},
        }}
      >
        <Toast />
      </AppContext.Provider>,
    );

    expect(captured.props?.theme).toBe("dark");
  });
});
