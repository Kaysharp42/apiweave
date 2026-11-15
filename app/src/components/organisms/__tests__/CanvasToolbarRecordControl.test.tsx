import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CanvasToolbarRecordControl } from "../CanvasToolbarRecordControl";

const base = { stepCount: 0, disabled: false, onRecord: vi.fn(), onStop: vi.fn() };

describe("CanvasToolbarRecordControl", () => {
  it("opens the start dialog from Record", async () => {
    const onRecord = vi.fn();
    render(<CanvasToolbarRecordControl {...base} state="idle" onRecord={onRecord} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Record browser steps" }));
    expect(onRecord).toHaveBeenCalledOnce();
  });

  it.each([
    ["while a run is in progress", { state: "idle", disabled: true }],
    ["while the browser opens", { state: "starting", disabled: false }],
    ["while another workflow is being recorded", { state: "elsewhere", disabled: false }],
  ] as const)("cannot record %s", (_when, props) => {
    render(<CanvasToolbarRecordControl {...base} {...props} />);
    expect(screen.getByRole("button", { name: "Record browser steps" })).toBeDisabled();
  });

  it("shows the live step count and stops from Stop", async () => {
    const onStop = vi.fn();
    render(<CanvasToolbarRecordControl {...base} state="recording" stepCount={3} onStop={onStop} />);
    expect(screen.getByText("Recording — 3 steps")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("keeps the count, without the label, when the toolbar is narrow", () => {
    render(<CanvasToolbarRecordControl {...base} state="stopping" stepCount={1} showLabel={false} />);
    expect(screen.getByText("1 step")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop recording" })).toBeDisabled();
  });
});
