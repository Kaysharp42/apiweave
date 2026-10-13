import { afterEach, describe, expect, it, vi } from "vitest";
import usePendingEditsStore, {
  confirmCloseTabs,
  registerPendingEdits,
  settlePendingEdits,
} from "./PendingEditsStore";
import type { PendingEdits } from "../types/PendingEdits";
import type { UnsavedChangesChoice } from "../types/UnsavedChangesChoice";

/** A canvas whose unsaved state each save may or may not clear. */
function makeEdits(opts: { unsaved: boolean; flushSaves?: boolean; saveSaves?: boolean }) {
  const state = { unsaved: opts.unsaved };
  const edits: PendingEdits = {
    flush: vi.fn(async () => {
      if (opts.flushSaves) state.unsaved = false;
    }),
    isUnsaved: () => state.unsaved,
    save: vi.fn(async () => {
      if (opts.saveSaves) state.unsaved = false;
    }),
  };
  return edits;
}

const answer = (choice: UnsavedChangesChoice) => vi.fn(() => Promise.resolve(choice));

describe("settlePendingEdits", () => {
  it("closes without asking once the flushed auto-save leaves nothing unsaved", async () => {
    const edits = makeEdits({ unsaved: true, flushSaves: true });
    const ask = answer("cancel");
    expect(await settlePendingEdits(edits, ask)).toBe(true);
    expect(edits.flush).toHaveBeenCalledTimes(1);
    expect(ask).not.toHaveBeenCalled();
  });

  it("keeps the tab open on Cancel", async () => {
    const edits = makeEdits({ unsaved: true });
    expect(await settlePendingEdits(edits, answer("cancel"))).toBe(false);
    expect(edits.save).not.toHaveBeenCalled();
  });

  it("closes on Discard without saving", async () => {
    const edits = makeEdits({ unsaved: true });
    expect(await settlePendingEdits(edits, answer("discard"))).toBe(true);
    expect(edits.save).not.toHaveBeenCalled();
  });

  it("saves on Save and closes once the save took", async () => {
    const edits = makeEdits({ unsaved: true, saveSaves: true });
    expect(await settlePendingEdits(edits, answer("save"))).toBe(true);
    expect(edits.save).toHaveBeenCalledTimes(1);
  });

  it("stays open when Save fails", async () => {
    const edits = makeEdits({ unsaved: true, saveSaves: false });
    expect(await settlePendingEdits(edits, answer("save"))).toBe(false);
  });
});

describe("confirmCloseTabs", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => cleanups.splice(0).forEach((c) => c()));

  it("closes tabs with no mounted canvas without asking", async () => {
    expect(await confirmCloseTabs(["not-mounted"])).toBe(true);
    expect(usePendingEditsStore.getState().promptFor).toBeNull();
  });

  it("asks through the dialog store about a dirty mounted canvas", async () => {
    const edits = makeEdits({ unsaved: true });
    cleanups.push(registerPendingEdits("wf1", edits));

    const pending = confirmCloseTabs(["other", "wf1"]);
    await vi.waitFor(() =>
      expect(usePendingEditsStore.getState().promptFor).not.toBeNull(),
    );
    usePendingEditsStore.getState().answer("discard");

    expect(await pending).toBe(true);
    expect(usePendingEditsStore.getState().promptFor).toBeNull();
  });
});
