import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedEnvironment } from "../types/ScopedEnvironment";

vi.mock("../utils/apiweaveClient", () => ({
  authenticatedFetch: vi.fn(),
  environmentsUrl: vi.fn(),
  default: "http://localhost",
}));

import useEnvironmentStore, {
  getSelectedEnvironment,
} from "./EnvironmentStore";

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
