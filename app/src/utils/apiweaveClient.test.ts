import { afterEach, describe, expect, test, vi, beforeEach } from "vitest";
import { IpcError, agents, invoke, mcp, updates } from "./apiweaveClient";

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

describe("privileged bridges", () => {
  const remote = (channel: string, message: string): Promise<never> =>
    Promise.reject(
      new Error(`Error invoking remote method '${channel}': Error: ${message}`),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("agents rejects with main's message, not Electron's wrapper", async () => {
    vi.stubGlobal("__APIWEAVE_AGENTS__", {
      launchEmbedded: () => remote("agents:launchEmbedded", "claude is not on PATH"),
    });

    await expect(
      agents.launchEmbedded({} as Parameters<typeof agents.launchEmbedded>[0]),
    ).rejects.toThrow(/^claude is not on PATH$/);
  });

  test("mcp rejects with main's message, not Electron's wrapper", async () => {
    vi.stubGlobal("__APIWEAVE_MCP__", {
      enable: () => remote("mcp:enable", "port 7777 is in use"),
    });

    await expect(mcp.enable()).rejects.toThrow(/^port 7777 is in use$/);
  });

  test("updates rejects with main's message, not Electron's wrapper", async () => {
    vi.stubGlobal("__APIWEAVE_UPDATES__", {
      check: () => remote("updates:check", "offline"),
    });

    await expect(updates.check()).rejects.toThrow(/^offline$/);
  });
});
