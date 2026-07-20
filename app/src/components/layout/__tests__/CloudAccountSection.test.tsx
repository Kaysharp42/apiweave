// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAccountSection } from "../CloudAccountSection";
import type { CloudSyncStatus } from "../../../types/cloud";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const base: CloudSyncStatus = {
  linked: false,
  active: false,
  linkState: "unlinked",
  syncState: "idle",
  state: "idle",
  pendingCount: 0,
  deadLetterCount: 0,
  conflictCount: 0,
  workspaceIds: [],
  bindings: [],
  workspaceCatalog: [],
};

function binding(overrides: Partial<CloudSyncStatus["bindings"][number]> = {}) {
  return {
    workspaceId: "local-1",
    workspaceName: "Personal",
    cloudWorkspaceId: "cloud-1",
    cloudWorkspaceName: "Personal",
    syncMode: "bi-directional",
    initializationState: "initialized" as const,
    pendingCount: 0,
    deadLetterCount: 0,
    conflictCount: 0,
    boundAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

function setStatus(status: CloudSyncStatus | "unavailable") {
  const invoke = vi.fn(async (
    _domain: string,
    _action: string,
    _payload: unknown,
  ) => {
    if (status === "unavailable") {
      return { ok: false, error: { code: "denied", message: "no bridge" } };
    }
    return { ok: true, data: status };
  });
  const bridge = {
    invoke,
    onRunProgress: vi.fn().mockReturnValue(() => undefined),
    onCloudStatusChanged: vi.fn().mockReturnValue(() => undefined),
  };
  vi.stubGlobal("__APIWEAVE_IPC__", bridge);
  Object.defineProperty(window, "__APIWEAVE_IPC__", {
    value: bridge,
    configurable: true,
  });
  return invoke;
}

function renderSection(): void {
  render(
    <MemoryRouter>
      <CloudAccountSection />
    </MemoryRouter>,
  );
}

// The account-menu controls carry role="menuitem" (they live in a role="menu"
// popover), so assert against that role, not "button".
const item = (name: RegExp) =>
  screen.findByRole("menuitem", { name }, { timeout: 3000 });

describe("CloudAccountSection", () => {
  afterEach(() => cleanup());
  beforeEach(() => vi.restoreAllMocks());

  it("shows Link cloud account when unlinked", async () => {
    setStatus(base);
    renderSection();
    expect(await item(/link cloud account/i)).toBeInTheDocument();
  });

  it("prompts to choose a workspace when linked with no bindings", async () => {
    setStatus({ ...base, linked: true, linkState: "linked" });
    renderSection();
    expect(await item(/choose workspace/i)).toBeInTheDocument();
  });

  it("surfaces conflicts ahead of the routine active view", async () => {
    setStatus({
      ...base,
      linked: true,
      active: true,
      linkState: "linked",
      syncState: "conflict",
      state: "conflict",
      conflictCount: 2,
      bindings: [binding({ conflictCount: 2 })],
    });
    renderSection();
    expect(await item(/resolve conflicts/i)).toBeInTheDocument();
  });

  it("offers Sync now in the active/idle state", async () => {
    const invoke = setStatus({
      ...base,
      linked: true,
      active: true,
      linkState: "linked",
      lastSyncedAt: "2026-07-16T10:00:00.000Z",
      bindings: [binding()],
    });
    renderSection();
    await userEvent.click(await item(/sync now/i));

    await waitFor(() => {
      const actions = invoke.mock.calls
        .filter(([domain]) => domain === "cloud")
        .map(([, action]) => action);
      expect(actions).toEqual([
        "status",
        "pull",
        "push",
        "refreshWorkspaceCatalog",
      ]);
    });
  });

  it("offers Relink when authentication is required", async () => {
    setStatus({
      ...base,
      linked: true,
      linkState: "authenticationRequired",
      bindings: [binding()],
    });
    renderSection();
    expect(await item(/relink account/i)).toBeInTheDocument();
  });

  it("renders nothing when the cloud bridge is unavailable", async () => {
    setStatus("unavailable");
    const { container } = render(
      <MemoryRouter>
        <CloudAccountSection />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
