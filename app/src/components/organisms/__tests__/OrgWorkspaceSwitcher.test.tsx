import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OrgWorkspaceSwitcher } from "../OrgWorkspaceSwitcher";
import type { WorkspaceContextValue, WorkspaceEntry } from "../../../types";
import type { Workspace } from "../../../types/Workspace";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSwitchTo = vi.fn();
const mockRefresh = vi.fn<() => Promise<void>>();
const authState = vi.hoisted(() => ({ isSingleUser: false }));
const cloudState = vi.hoisted(() => ({ status: null as import("../../../types").CloudSyncStatus | null }));

vi.mock("../../../auth/useAuth", () => ({
  useAuth: () => ({ isSingleUser: authState.isSingleUser }),
}));

vi.mock("../../../hooks/useCloudSync", () => ({
  useCloudSync: () => ({ status: cloudState.status }),
}));

const defaultContext: WorkspaceContextValue = {
  availableWorkspaces: [],
  currentWorkspace: null,
  currentOrg: null,
  orgs: [],
  currentRole: null,
  switchTo: mockSwitchTo,
  refresh: mockRefresh,
  isLoading: false,
};

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => defaultContext,
}));

function setContext(overrides: Partial<WorkspaceContextValue>): void {
  Object.assign(defaultContext, overrides);
}

function renderSwitcher() {
  return render(
    <MemoryRouter>
      <OrgWorkspaceSwitcher />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    workspaceId: "ws-1",
    slug: "default",
    name: "Default",
    description: null,
    origin: "local",
    syncMode: "none",
    isPersonal: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEntry(
  ws: Workspace,
  role = "owner",
): WorkspaceEntry {
  return { workspace: ws, role };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrgWorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    authState.isSingleUser = false;
    cloudState.status = null;
    setContext({
      availableWorkspaces: [],
      currentWorkspace: null,
      currentRole: null,
      refresh: mockRefresh,
      isLoading: false,
    });
  });

  it("shows loading skeleton when isLoading is true", () => {
    setContext({ isLoading: true });
    const { container } = renderSwitcher();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders trigger button with personal label when no workspace is selected", () => {
    const personalWs = makeWorkspace({ name: "Personal" });
    setContext({
      availableWorkspaces: [makeEntry(personalWs)],
      currentWorkspace: personalWs,
    });
    renderSwitcher();
    expect(screen.getByLabelText("Switch workspace")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("opens dropdown on trigger click and shows workspaces", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: "Personal", isPersonal: true });
    const otherWs = makeWorkspace({
      workspaceId: "ws-2",
      slug: "main",
      name: "Main",
      isPersonal: false,
    });
    setContext({
      availableWorkspaces: [makeEntry(personalWs), makeEntry(otherWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Personal").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Main")).toBeInTheDocument();
  });

  it("calls switchTo when a workspace option is clicked", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    const otherWs = makeWorkspace({
      workspaceId: "ws-2",
      slug: "main",
      name: "Main",
      isPersonal: false,
    });
    setContext({
      availableWorkspaces: [makeEntry(personalWs), makeEntry(otherWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    const mainOption = screen.getByText("Main");
    await user.click(mainOption);

    expect(mockSwitchTo).toHaveBeenCalledWith("main");
  });

  it("shows the Team source when workspace names are duplicated", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: "Kyra", isPersonal: true });
    const teamWs = makeWorkspace({
      workspaceId: "ws-team",
      slug: "kyra-team",
      name: "Kyra",
      isPersonal: false,
    });
    cloudState.status = {
      linked: true,
      active: true,
      linkState: "linked",
      syncState: "idle",
      state: "idle",
      pendingCount: 0,
      deadLetterCount: 0,
      conflictCount: 0,
      workspaceIds: ["cloud-team-ws"],
      bindings: [{
        workspaceId: "ws-team",
        workspaceName: "Kyra",
        cloudWorkspaceId: "cloud-team-ws",
        cloudWorkspaceName: "Kyra",
        teamId: "team-kyra",
        teamName: "Kyra Team",
        syncMode: "bi-directional",
        initializationState: "initialized",
        pendingCount: 0,
        deadLetterCount: 0,
        conflictCount: 0,
        boundAt: "2026-07-29T00:00:00Z",
      }],
      workspaceCatalog: [],
      teamCatalog: [],
    };
    setContext({
      availableWorkspaces: [makeEntry(personalWs), makeEntry(teamWs)],
      currentWorkspace: teamWs,
    });

    renderSwitcher();
    expect(screen.getByText("Team · Kyra Team")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Switch workspace"));
    expect(screen.getAllByText("Kyra")).toHaveLength(3);
    expect(screen.getAllByText("Team · Kyra Team").length).toBeGreaterThanOrEqual(1);
  });

  it("closes dropdown on Escape key", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(personalWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
  });

  it('shows "No workspaces available" when list is empty', async () => {
    const user = userEvent.setup();
    setContext({ availableWorkspaces: [] });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      expect(screen.getByText("No workspaces available")).toBeInTheDocument();
    });
  });

  it("marks the active workspace with aria-selected", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(personalWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(1);
      expect(options[0]).toHaveAttribute("aria-selected", "true");
    });
  });

  it("shows workspace creation on desktop even in single-user mode", async () => {
    // Desktop is single-user but IPC-backed: users create workspaces locally and
    // cloud sync provisions them. The old web-only "hide when single-user" gate
    // no longer applies on the desktop shell.
    const user = userEvent.setup();
    authState.isSingleUser = true;
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(personalWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    expect(
      screen.getByRole("button", { name: "New workspace" }),
    ).toBeInTheDocument();
    // "Manage workspaces" stays a web/team-only affordance.
    expect(
      screen.queryByRole("button", { name: "Manage workspaces" }),
    ).not.toBeInTheDocument();
  });
});
