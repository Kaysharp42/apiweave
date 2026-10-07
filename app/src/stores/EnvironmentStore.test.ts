import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";

const listMock = vi.hoisted(() => vi.fn());

vi.mock("../utils/apiweaveClient", () => ({
  apiweave: { environments: { list: listMock } },
}));

import useEnvironmentStore, {
  getSelectedEnvironment,
} from "./EnvironmentStore";

type EnvironmentList = { items: ScopedEnvironment[]; total: number };

function listOf(environments: ScopedEnvironment[]): EnvironmentList {
  return { items: environments, total: environments.length };
}

function makeEnv(overrides: Partial<ScopedEnvironment> = {}): ScopedEnvironment {
  return {
    environmentId: "env-1",
    name: "Dev",
    variables: {},
    secrets: {},
    scopeType: "workspace",
    scopeId: "ws1",
    isDefault: false,
    allowedWorkspaceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getSelectedEnvironment", () => {
  beforeEach(() => {
    localStorage.clear();
    useEnvironmentStore.setState({
      environments: [makeEnv()],
      selectedEnvironmentByWorkflow: {},
      isLoading: false,
    });
  });

  it("returns the per-workflow selection when set", () => {
    useEnvironmentStore.setState({
      selectedEnvironmentByWorkflow: { wf1: "env-1" },
    });
    expect(getSelectedEnvironment("wf1")).toBe("env-1");
  });

  it("falls back to the workflow's own environment", () => {
    expect(getSelectedEnvironment("wf1", "env-1")).toBe("env-1");
  });

  it("honors the localStorage default while it exists in the workspace", () => {
    localStorage.setItem("defaultEnvironment", "env-1");
    expect(getSelectedEnvironment("wf-new")).toBe("env-1");
  });

  it("ignores a stale localStorage default pointing at another workspace's environment", () => {
    localStorage.setItem("defaultEnvironment", "env-other-workspace");
    expect(getSelectedEnvironment("wf-new")).toBeNull();
  });

  it("ignores a localStorage default whose environment was deleted", () => {
    localStorage.setItem("defaultEnvironment", "env-deleted");
    useEnvironmentStore.setState({ environments: [] });
    expect(getSelectedEnvironment("wf-new")).toBeNull();
  });

  it("returns null when nothing resolves", () => {
    expect(getSelectedEnvironment("wf-new")).toBeNull();
  });
});

/**
 * The store backs the run-time environment picker, so it must hold exactly one
 * workspace's environments at a time. Anything left over from a previous
 * workspace is selectable, and picking it saves a `selectedEnvironmentId` the
 * server rejects as not_found — the workspace the user is now in has no such
 * environment.
 */
describe("fetchEnvironments — one workspace at a time", () => {
  beforeEach(() => {
    listMock.mockReset();
    useEnvironmentStore.setState({
      environments: [],
      loadedWorkspaceId: null,
      selectedEnvironmentByWorkflow: {},
      isLoading: false,
    });
  });

  it("replaces the previous workspace's environments", async () => {
    listMock.mockResolvedValueOnce(
      listOf([makeEnv({ environmentId: "a-1" })]),
    );
    await useEnvironmentStore.getState().fetchEnvironments("ws-a");
    expect(
      useEnvironmentStore.getState().environments.map((e) => e.environmentId),
    ).toEqual(["a-1"]);

    listMock.mockResolvedValueOnce(
      listOf([makeEnv({ environmentId: "b-1" })]),
    );
    await useEnvironmentStore.getState().fetchEnvironments("ws-b");
    expect(
      useEnvironmentStore.getState().environments.map((e) => e.environmentId),
    ).toEqual(["b-1"]);
  });

  it("empties the list when the fetch fails rather than keeping the old workspace's", async () => {
    listMock.mockResolvedValueOnce(
      listOf([makeEnv({ environmentId: "a-1" })]),
    );
    await useEnvironmentStore.getState().fetchEnvironments("ws-a");

    listMock.mockRejectedValueOnce(new Error("offline"));
    await useEnvironmentStore.getState().fetchEnvironments("ws-b");

    expect(useEnvironmentStore.getState().environments).toEqual([]);
    expect(useEnvironmentStore.getState().isLoading).toBe(false);
  });

  it("clears the list for an empty workspace id", async () => {
    listMock.mockResolvedValueOnce(
      listOf([makeEnv({ environmentId: "a-1" })]),
    );
    await useEnvironmentStore.getState().fetchEnvironments("ws-a");

    await useEnvironmentStore.getState().fetchEnvironments("");

    expect(useEnvironmentStore.getState().environments).toEqual([]);
    expect(useEnvironmentStore.getState().loadedWorkspaceId).toBeNull();
  });

  it("drops a slow response for a workspace the user has already left", async () => {
    let releaseSlow: (value: EnvironmentList) => void = () => {};
    listMock.mockReturnValueOnce(
      new Promise<EnvironmentList>((resolve) => {
        releaseSlow = resolve;
      }),
    );
    const slow = useEnvironmentStore.getState().fetchEnvironments("ws-a");

    listMock.mockResolvedValueOnce(
      listOf([makeEnv({ environmentId: "b-1" })]),
    );
    await useEnvironmentStore.getState().fetchEnvironments("ws-b");

    releaseSlow(listOf([makeEnv({ environmentId: "a-1" })]));
    await slow;

    expect(
      useEnvironmentStore.getState().environments.map((e) => e.environmentId),
    ).toEqual(["b-1"]);
  });
});
