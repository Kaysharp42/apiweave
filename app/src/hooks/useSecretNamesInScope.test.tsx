import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSecretNamesInScope } from "./useSecretNamesInScope";
import { forgetSecretNames } from "../utils/secretNames";
import { listScopedSecrets } from "./useSecretValues";
import type { Secret } from "../types";

vi.mock("../contexts/WorkflowContext", async () => {
  const { createContext } = await import("react");
  return { default: createContext({ workflowId: "wf-1" }) };
});

vi.mock("../contexts/WorkspaceContext", async () => {
  const { createContext } = await import("react");
  return { default: createContext({ currentWorkspace: { workspaceId: "ws-1" } }) };
});

vi.mock("./useSecretValues", () => ({ listScopedSecrets: vi.fn() }));

const WORKSPACE_ID = "ws-1";

function storedSecret(name: string): Secret {
  return {
    secretId: `secret-${name}`,
    name,
    scopeType: "workspace",
    scopeId: WORKSPACE_ID,
    keyId: "key-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("useSecretNamesInScope", () => {
  beforeEach(() => {
    // The cache outlives a test; drop it so each one starts with no request made.
    forgetSecretNames(WORKSPACE_ID);
    vi.mocked(listScopedSecrets).mockReset();
  });

  it("gives every mounted instance the new list after one of them refreshes", async () => {
    const stored: Secret[] = [storedSecret("EXISTING")];
    vi.mocked(listScopedSecrets).mockImplementation(async () => [...stored]);

    // The notice in a config panel and the badge on a canvas node: two readers
    // of the same workspace, each holding its own copy of the names.
    const notice = renderHook(() => useSecretNamesInScope());
    const badge = renderHook(() => useSecretNamesInScope());

    await waitFor(() => expect(notice.result.current.names).toEqual(["EXISTING"]));
    await waitFor(() => expect(badge.result.current.names).toEqual(["EXISTING"]));
    // One request per workspace+environment, however many readers there are.
    expect(listScopedSecrets).toHaveBeenCalledTimes(1);
    expect(listScopedSecrets).toHaveBeenCalledWith("workspace", WORKSPACE_ID, WORKSPACE_ID);

    // "Save as secret": the name is stored, and the panel that saved it refreshes.
    stored.push(storedSecret("UNSET_PASSWORD_1"));
    act(() => notice.result.current.refresh());

    await waitFor(() => expect(notice.result.current.names).toContain("UNSET_PASSWORD_1"));
    // The badge had no reason to refetch before: this is the bug.
    await waitFor(() => expect(badge.result.current.names).toContain("UNSET_PASSWORD_1"));
    // Both re-read through the same cache entry, so the save costs one request.
    expect(listScopedSecrets).toHaveBeenCalledTimes(2);
  });

  it("leaves a reader alone until its own workspace is invalidated", async () => {
    vi.mocked(listScopedSecrets).mockImplementation(async () => [storedSecret("EXISTING")]);

    const sibling = renderHook(() => useSecretNamesInScope());
    await waitFor(() => expect(sibling.result.current.names).toEqual(["EXISTING"]));

    act(() => forgetSecretNames("ws-2"));

    // Re-read hits the cached promise, so nothing changes for this reader.
    expect(sibling.result.current.names).toEqual(["EXISTING"]);
    expect(listScopedSecrets).toHaveBeenCalledTimes(1);
  });
});
