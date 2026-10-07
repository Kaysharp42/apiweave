import { describe, expect, test, vi, beforeEach } from "vitest";
import { IpcError, invoke } from "./apiweaveClient";

describe("apiweave IPC client", () => {
  beforeEach(() => {
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke: vi.fn().mockResolvedValue({ ok: true, data: { id: "ok" } }),
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });
  });

  test("invoke unwraps successful contract envelopes", async () => {
    await expect(
      invoke<{ id: string }>("workspaces", "get", { workspaceId: "ws-1" }),
    ).resolves.toEqual({ id: "ok" });
  });

  test("invoke preserves contract error code", async () => {
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "not_found", message: "missing" },
      }),
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });

    await expect(invoke("workflows", "get", {})).rejects.toMatchObject({
      code: "not_found",
      message: "missing",
    });
  });

  test("IpcError exposes code for React Query handlers", () => {
    expect(new IpcError("denied", "nope").code).toBe("denied");
  });
});
