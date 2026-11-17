import { describe, expect, it } from "vitest";
import { isRecordControlDisabled, recordingControlView } from "./recordingControl";

describe("recordingControlView", () => {
  it("shows this workflow's recording as its phase, with its steps", () => {
    expect(recordingControlView("recording", true, true, 3)).toEqual({
      state: "recording",
      stopping: true,
      stepCount: 3,
    });
  });

  it("shows another workflow's recording as elsewhere, with none of its steps", () => {
    expect(recordingControlView("recording", false, true, 3)).toEqual({
      state: "elsewhere",
      stopping: false,
      stepCount: 0,
    });
  });

  it("leaves an idle recording idle even for another workflow", () => {
    expect(recordingControlView("idle", false, false, 0)).toEqual({
      state: "idle",
      stopping: false,
      stepCount: 0,
    });
  });
});

describe("isRecordControlDisabled", () => {
  it("is enabled with a loaded canvas in a workflow of a workspace", () => {
    expect(isRecordControlDisabled(false, true, "wf", "ws")).toBe(false);
  });

  it("is disabled while a run is in progress or the canvas is not ready", () => {
    expect(isRecordControlDisabled(true, true, "wf", "ws")).toBe(true);
    expect(isRecordControlDisabled(false, false, "wf", "ws")).toBe(true);
  });

  it("is disabled without a workflow or a workspace", () => {
    expect(isRecordControlDisabled(false, true, undefined, "ws")).toBe(true);
    expect(isRecordControlDisabled(false, true, "wf", undefined)).toBe(true);
  });
});
