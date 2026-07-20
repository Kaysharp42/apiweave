import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopShell } from "./isDesktopShell";

const setIpc = (enabled: boolean): void => {
  if (!enabled) {
    delete window.__APIWEAVE_IPC__;
    return;
  }

  window.__APIWEAVE_IPC__ = {
    invoke: vi.fn().mockResolvedValue({ ok: true, data: null }),
    onRunProgress: vi.fn().mockReturnValue(() => undefined),
  };
};

describe("isDesktopShell", () => {
  afterEach(() => {
    setIpc(false);
  });

  it("returns true when the Electron IPC bridge exists", () => {
    setIpc(true);

    expect(isDesktopShell()).toBe(true);
  });

  it("returns false when the Electron IPC bridge is absent", () => {
    setIpc(false);

    expect(isDesktopShell()).toBe(false);
  });
});
