import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";
import { confirmCloseAll } from "../../stores/PendingEditsStore";

vi.mock("../../stores/PendingEditsStore", () => ({
  confirmCloseAll: vi.fn(),
}));

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

  describe("Reload", () => {
    const reload = vi.fn();
    const original = window.location;
    beforeAll(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...original, reload },
      });
    });
    afterAll(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    });
    beforeEach(() => reload.mockClear());

    async function clickReload(): Promise<void> {
      render(
        <ErrorBoundary name="page">
          <Boom />
        </ErrorBoundary>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    }

    it("reloads once unsaved work is settled", async () => {
      vi.mocked(confirmCloseAll).mockResolvedValue(true);
      await clickReload();
      expect(confirmCloseAll).toHaveBeenCalled();
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    });

    it("stays put when the unsaved-changes prompt is cancelled", async () => {
      vi.mocked(confirmCloseAll).mockResolvedValue(false);
      await clickReload();
      expect(confirmCloseAll).toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });
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
