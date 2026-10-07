import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteScopedSecret,
  fetchScopedPublicKey,
  listScopedSecrets,
  postScopedEncryptedSecret,
} from "./useSecretValues";

type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;

function installBridge(data: unknown) {
  const invoke = vi.fn<TestIpcBridge["invoke"]>(async () => ({ ok: true, data }));
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke,
    onRunProgress: () => () => undefined,
  });
  return invoke;
}

afterEach(() => vi.unstubAllGlobals());

describe("scoped secret helpers", () => {
  it("authorizes a workspace scope against that workspace", async () => {
    const invoke = installBridge([]);
    await listScopedSecrets("workspace", "ws-1");
    expect(invoke).toHaveBeenCalledWith("secrets", "list", {
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeId: "ws-1",
    });
  });

  it("authorizes an environment scope against the workspace the caller names", async () => {
    const invoke = installBridge({ keyId: "k", publicKey: "p", algorithm: "libsodium-sealed-box" });
    await fetchScopedPublicKey("environment", "env-1", "ws-1");
    expect(invoke).toHaveBeenCalledWith("secrets", "publicKey", {
      workspaceId: "ws-1",
      scopeType: "environment",
      scopeId: "env-1",
    });
  });

  it("fails closed for an environment scope without a workspace", async () => {
    const invoke = installBridge(null);
    await expect(
      deleteScopedSecret("environment", "env-1", "API_KEY"),
    ).rejects.toMatchObject({ code: "validation" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("stores the sealed bytes as given", async () => {
    const invoke = installBridge({});
    const sealed = new Uint8Array([9, 8, 7]);
    await postScopedEncryptedSecret({
      scopeType: "workspace",
      scopeId: "ws-1",
      name: "API_KEY",
      sealed,
      keyId: "k",
    });
    expect(invoke).toHaveBeenCalledWith("secrets", "set", {
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeId: "ws-1",
      name: "API_KEY",
      sealed,
      keyId: "k",
    });
  });
});
