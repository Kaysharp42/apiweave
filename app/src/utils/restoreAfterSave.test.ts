import { describe, expect, it, vi } from "vitest";
import { restoreAfterSave } from "./restoreAfterSave";
import { IpcError } from "./apiweaveClient";

describe("restoreAfterSave", () => {
  it("restores and reloads once the unsaved edits are saved", async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    await restoreAfterSave(() => Promise.resolve(true), restore, reload);
    expect(restore).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("neither restores nor reloads when the save did not land, so the edits stay on the canvas", async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const reload = vi.fn().mockResolvedValue(undefined);
    await expect(restoreAfterSave(() => Promise.resolve(false), restore, reload)).rejects.toThrow(
      /unsaved edits could not be saved/,
    );
    expect(restore).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("names a conflicting restore and does not reload", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    await expect(
      restoreAfterSave(
        () => Promise.resolve(true),
        () => Promise.reject(new IpcError("conflict", "stale")),
        reload,
      ),
    ).rejects.toThrow(/changed while you were looking/);
    expect(reload).not.toHaveBeenCalled();
  });
});
