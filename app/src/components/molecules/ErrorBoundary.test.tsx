import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("inspector exploded");
}

describe("ErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeAll(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => consoleError.mockRestore());

  it("renders the recovery UI instead of blanking, and logs the error", () => {
    render(
      <ErrorBoundary name="app">
        <Boom />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("inspector exploded");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("[ErrorBoundary] app failed to render: inspector exploded"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("reloads the window from the Reload action", async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      render(
        <ErrorBoundary name="app">
          <Boom />
        </ErrorBoundary>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reload" }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("copies the error details", async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary name="app">
        <Boom />
      </ErrorBoundary>,
    );
    await user.click(screen.getByRole("button", { name: "Copy error details" }));
    expect(await navigator.clipboard.readText()).toContain("inspector exploded");
  });
});
