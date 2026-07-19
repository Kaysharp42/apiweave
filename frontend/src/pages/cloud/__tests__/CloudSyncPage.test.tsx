// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudSyncPage } from "../CloudSyncPage";
import type { CloudSyncStatus } from "../../../types/cloud";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const base: CloudSyncStatus = {
  linked: true,
  active: true,
  linkState: "linked",
  syncState: "idle",
  state: "idle",
  pendingCount: 0,
  deadLetterCount: 0,
  conflictCount: 0,
  workspaceIds: [],
  bindings: [],
  workspaceCatalog: [],
  account: { accountId: "acc-1", email: "user@example.com" },
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

function setStatus(status: CloudSyncStatus): void {
  const invoke = vi.fn(async () => ({ ok: true, data: status }));
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
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <CloudSyncPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CloudSyncPage", () => {
  it("renders the auto-synced list with no manual bind form", async () => {
    setStatus({ ...base, bindings: [binding()] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Synced workspaces")).toBeInTheDocument(),
    );
    // The workspace shows in the read-only synced list...
    expect(screen.getAllByText("Personal").length).toBeGreaterThanOrEqual(1);
    // ...with the reconciliation refresh and the stop-syncing control...
    expect(
      screen.getByRole("button", { name: "Check for new workspaces" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop syncing" }),
    ).toBeInTheDocument();
    // ...and no manual bind form.
    expect(screen.queryByText("Add a workspace")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Bind/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the auto-sync empty state when nothing is bound", async () => {
    setStatus({ ...base, bindings: [] });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("Your workspaces sync automatically"),
      ).toBeInTheDocument(),
    );
  });

  it("renders a friendly per-workspace error, never raw codes", async () => {
    setStatus({
      ...base,
      syncState: "error",
      bindings: [
        binding({
          deadLetterCount: 1,
          lastError:
            "This workspace no longer exists in the cloud. Reconnect to re-create it.",
        }),
      ],
    });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(/no longer exists in the cloud/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/rejectionReason=|status=3/)).not.toBeInTheDocument();
  });
});
