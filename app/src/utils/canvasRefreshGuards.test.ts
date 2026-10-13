import { describe, expect, it } from "vitest";
import {
  canApplyBackgroundRefresh,
  shouldActOnDetach,
  writeFollowsBaseRevision,
} from "./canvasRefreshGuards";

describe("shouldActOnDetach", () => {
  it("acts on a detach caused by another process", () => {
    expect(shouldActOnDetach({ initiatedLocally: false, tabIsOpen: true })).toBe(true);
  });

  it("stays out of a delete the user ran here", () => {
    // The sidebar already closed the tab and toasted; a second toast blaming an
    // agent would be wrong twice over.
    expect(shouldActOnDetach({ initiatedLocally: true, tabIsOpen: true })).toBe(false);
  });

  it("stays out of a move the user ran here, which relocates the tab", () => {
    expect(shouldActOnDetach({ initiatedLocally: true, tabIsOpen: true })).toBe(false);
  });

  it("ignores a repeated notification once the tab is gone", () => {
    // `moveToWorkspace` notifies twice for one logical detach.
    expect(shouldActOnDetach({ initiatedLocally: false, tabIsOpen: false })).toBe(false);
  });
});

describe("canApplyBackgroundRefresh", () => {
  it("applies when nothing changed while the fetch was in flight", () => {
    expect(
      canApplyBackgroundRefresh({
        hydrationVersionAtRequest: 3,
        hydrationVersionNow: 3,
        tabIsDirty: false,
      }),
    ).toBe(true);
  });

  it("refuses to overwrite unsaved edits made during the fetch", () => {
    expect(
      canApplyBackgroundRefresh({
        hydrationVersionAtRequest: 3,
        hydrationVersionNow: 3,
        tabIsDirty: true,
      }),
    ).toBe(false);
  });

  it("refuses a read superseded by a live snapshot", () => {
    expect(
      canApplyBackgroundRefresh({
        hydrationVersionAtRequest: 3,
        hydrationVersionNow: 4,
        tabIsDirty: false,
      }),
    ).toBe(false);
  });
});

describe("writeFollowsBaseRevision", () => {
  it("adopts a write that is the next revision after the base", () => {
    expect(writeFollowsBaseRevision(5, 6)).toBe(true);
  });

  it("leaves the base alone when another write landed in between", () => {
    // Rev 6 came from an agent; adopting 7 would let the next save overwrite it.
    expect(writeFollowsBaseRevision(5, 7)).toBe(false);
  });
});
