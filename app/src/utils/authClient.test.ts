import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  authenticatedFetch,
  authenticatedJson,
  IpcError,
  invoke,
} from "./apiweaveClient";

describe("apiweave IPC auth-compatible client", () => {
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

  test("authenticatedJson routes legacy paths through IPC", async () => {
    const data = await authenticatedJson(
      "ipc://apiweave/api/workspaces/ws-1/workflows",
    );
    expect(data).toEqual({ workflows: undefined, total: undefined });
  });

  test("POST /workflows/{id}/templates routes to workflows.saveTemplates", async () => {
    const ipcInvoke = vi.fn().mockResolvedValue({ ok: true, data: {} });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke: ipcInvoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });
    const templates = [{ label: "req" }];

    await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/workflows/wf-1/templates",
      { method: "POST", body: JSON.stringify(templates) },
    );

    expect(ipcInvoke).toHaveBeenCalledWith("workflows", "saveTemplates", {
      workspaceId: "ws-1",
      workflowId: "wf-1",
      templates,
    });
  });

  test("IpcError exposes code for React Query handlers", () => {
    expect(new IpcError("denied", "nope").code).toBe("denied");
  });
});
