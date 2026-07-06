import { describe, expect, test, vi, beforeEach } from "vitest";
import { authenticatedFetch, copyInviteLink } from "./apiweaveClient";

describe("apiweave IPC legacy transport shim", () => {
  beforeEach(() => {
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { items: [], total: 0 } }),
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });
  });

  test("authenticatedFetch returns a Response backed by IPC data", async () => {
    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/workflows",
    );
    await expect(response.json()).resolves.toEqual({ workflows: [], total: 0 });
  });

  test("copyInviteLink reports unavailable clipboard", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyInviteLink("https://example.test/invite")).resolves.toBe(
      false,
    );
  });
});
