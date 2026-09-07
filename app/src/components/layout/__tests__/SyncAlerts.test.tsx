// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncAlerts } from "../SyncAlerts";
import type { CloudSyncStatus } from "../../../types/cloud";

const cloudStatus = vi.fn();
const invoke = vi.fn();
vi.mock("../../../utils/apiweaveClient", () => ({
  apiweave: { cloud: { status: () => cloudStatus() } },
  invoke: (...args: unknown[]) => invoke(...args),
  onCloudStatusChanged: () => () => {},
  IpcError: class IpcError extends Error {},
}));

const tabs = vi.fn();
vi.mock("../../../hooks/useWorkspaceTabs", () => ({
  useWorkspaceTabs: () => tabs(),
}));

afterEach(cleanup);

/** The workspace the user is in, and (optionally) the workflow they have open. */
function show(
  overrides: Partial<CloudSyncStatus>,
  openWorkflowId: string | null = null,
  conflicted: readonly string[] = [],
) {
  cloudStatus.mockResolvedValue({
    conflictCount: conflicted.length,
    bindings: [],
    encryptionDecisionPending: [],
    ...overrides,
  });
  invoke.mockResolvedValue(
    conflicted.map((id) => ({ kind: "workflow", record_id: id })),
  );
  tabs.mockReturnValue({
    workspaceId: "ws-1",
    tabs: [],
    activeTabId: openWorkflowId,
    activeTab:
      openWorkflowId === null ? undefined : { workflowId: openWorkflowId },
  });
  render(
    <MemoryRouter>
      <SyncAlerts />
    </MemoryRouter>,
  );
}

const locked = { workspaceId: "ws-1", encryption: "locked" };

describe("SyncAlerts", () => {
  it("warns about the open workspace being locked", async () => {
    show({ bindings: [locked] as never });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This workspace is locked.",
    );
    expect(screen.getByRole("button")).toHaveTextContent("Unlock");
  });

  it("ignores a workspace the user is not in", async () => {
    show({
      bindings: [{ ...locked, workspaceId: "ws-2" }] as never,
      encryptionDecisionPending: [{ workspaceId: "ws-2" }] as never,
    });
    await waitFor(() => expect(cloudStatus).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a conflict only for the workflow in the active tab", async () => {
    show({}, "wf-a", ["wf-a"]);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "This workflow has a sync conflict.",
    );
  });

  it("stays quiet while the conflicted workflow is not open", async () => {
    show({}, "wf-b", ["wf-a"]);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays quiet when no workflow is open at all", async () => {
    show({}, null, ["wf-a"]);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
