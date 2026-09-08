import { useRef } from "react";
import { describe, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SseConfigPanel } from "./SseConfigPanel";

function Harness({ activeTab }: { activeTab: "finish" | "settings" }) {
  const workingDataRef = useRef<Record<string, unknown>>({});
  return (
    <SseConfigPanel
      initialConfig={{
        finishConditions: [{ path: "data.status", operator: "equals", expectedValue: "complete" }],
      }}
      workingDataRef={workingDataRef}
      activeTab={activeTab}
    />
  );
}

describe("SseConfigPanel", () => {
  test("keeps a blank extractor row mounted while its name is entered", async () => {
    const user = userEvent.setup();
    render(<Harness activeTab="settings" />);

    await user.click(screen.getByRole("button", { name: "Add row" }));
    const name = screen.getByLabelText("eventPayload 1");
    expect(name).toBeInTheDocument();

    await user.type(name, "payload");
    expect(name).toHaveValue("payload");
  });

  test("does not remount the finish-rule path input while it is edited", () => {
    render(<Harness activeTab="finish" />);
    const path = screen.getByPlaceholderText("data.status");
    path.focus();

    fireEvent.change(path, { target: { value: "data.state" } });

    expect(screen.getByPlaceholderText("data.status")).toBe(path);
    expect(path).toHaveFocus();
  });
});
