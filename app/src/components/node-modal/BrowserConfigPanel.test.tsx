import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserConfigPanel } from "./BrowserConfigPanel";
import type { BrowserLocator } from "@shared/types/BrowserLocator";

const SAVE_BUTTON: BrowserLocator = { kind: "role", role: "button", name: "Save" };

describe("BrowserConfigPanel", () => {
  test("switching a click to a fill keeps the locator and stores the typed value", async () => {
    const user = userEvent.setup();
    const workingDataRef = { current: {} as Record<string, unknown> };

    render(
      <BrowserConfigPanel
        initialConfig={{ action: "click", locator: SAVE_BUTTON }}
        workingDataRef={workingDataRef}
        activeTab="step"
      />,
    );

    // The first combobox is "What this step does"; the click's dialog picker
    // and the locator's own pickers come after it.
    await user.selectOptions(screen.getAllByRole("combobox")[0]!, "fill");

    // The element the click found is still the element the fill types into.
    expect(screen.getByText("page.getByRole('button', { name: 'Save' })")).toBeTruthy();

    await user.type(screen.getByPlaceholderText("{{env.TEST_EMAIL}}"), "jane@example.com");

    expect(workingDataRef.current.config).toEqual({
      action: "fill",
      locator: SAVE_BUTTON,
      value: "jane@example.com",
    });
  });
});
