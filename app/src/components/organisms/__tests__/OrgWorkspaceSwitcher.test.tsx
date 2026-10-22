import { act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OrgWorkspaceSwitcher } from "../OrgWorkspaceSwitcher";
import { installGitBridge, trackedStatus } from "../../../__tests__/gitFixtures";
import type { WorkspaceContextValue } from "../../../types";
import type { Workspace } from "../../../types/Workspace";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSwitchTo = vi.fn();
const mockRefresh = vi.fn<() => Promise<void>>();

const defaultContext: WorkspaceContextValue = {
  availableWorkspaces: [],
  currentWorkspace: null,
  currentOrg: null,
  orgs: [],
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
    isPersonal: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrgWorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRefresh.mockResolvedValue(undefined);
    setContext({
      availableWorkspaces: [],
      currentWorkspace: null,
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
      availableWorkspaces: [personalWs],
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
      availableWorkspaces: [personalWs, otherWs],
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
      availableWorkspaces: [personalWs, otherWs],
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

  it("describes a non-personal workspace as local to this device", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: "Kyra", isPersonal: true });
    const localWs = makeWorkspace({
      workspaceId: "ws-local",
      slug: "kyra-local",
      name: "Kyra local",
      isPersonal: false,
    });
    setContext({
      availableWorkspaces: [personalWs, localWs],
      currentWorkspace: localWs,
    });

    renderSwitcher();
    expect(screen.getByText("On this device")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Switch workspace"));
    expect(screen.getAllByText("On this device").length).toBeGreaterThanOrEqual(1);
  });

  it("closes dropdown on Escape key", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [personalWs],
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
      availableWorkspaces: [personalWs],
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

  it("offers workspace creation and opening from git, and nothing else", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [personalWs],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    expect(
      screen.getByRole("button", { name: "New workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open from git…" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manage workspaces" }),
    ).not.toBeInTheDocument();
  });

  it("shows each tracked row's sync state as an icon named by its tooltip, and leaves the rest alone", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: "Personal", isPersonal: true });
    const otherWs = makeWorkspace({
      workspaceId: "ws-2",
      slug: "main",
      name: "Main",
      isPersonal: false,
    });
    setContext({
      availableWorkspaces: [personalWs, otherWs],
      currentWorkspace: personalWs,
    });
    installGitBridge(trackedStatus(), {
      statusAll: vi.fn(async () => [
        trackedStatus(),
        trackedStatus({ workspaceId: "ws-2", remoteUrl: null, lastSyncedAt: null, uncommitted: true }),
      ]),
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    const personal = await screen.findByRole("option", { name: /Personal/ });
    expect(within(personal).getByRole("img", { name: "Synced" })).toHaveAttribute("title", "Synced");
    const main = screen.getByRole("option", { name: /Main/ });
    expect(
      within(main).getByRole("img", { name: "Local history · uncommitted" }),
    ).toBeInTheDocument();
  });

  it("gives an untracked row no icon, and follows a status change for a row it did have", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: "Personal", isPersonal: true });
    const otherWs = makeWorkspace({
      workspaceId: "ws-2",
      slug: "main",
      name: "Main",
      isPersonal: false,
    });
    setContext({
      availableWorkspaces: [personalWs, otherWs],
      currentWorkspace: personalWs,
    });
    const { push } = installGitBridge(trackedStatus(), {
      statusAll: vi.fn(async () => [trackedStatus()]),
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    const personal = await screen.findByRole("option", { name: /Personal/ });
    await waitFor(() => expect(within(personal).getByRole("img", { name: "Synced" })).toBeInTheDocument());
    expect(within(screen.getByRole("option", { name: /Main/ })).queryByRole("img")).toBeNull();

    act(() => push(trackedStatus({ state: "syncing" })));

    await waitFor(() =>
      expect(
        within(screen.getByRole("option", { name: /Personal/ })).getByRole("img", { name: "Syncing" }),
      ).toBeInTheDocument(),
    );
  });

  it("opens the open-from-git dialog from its menu entry", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [personalWs],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    expect(
      screen.queryByRole("dialog", { name: "Open workspace from git" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Switch workspace"));
    await user.click(screen.getByRole("button", { name: "Open from git…" }));

    expect(
      await screen.findByRole("dialog", { name: "Open workspace from git" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Repository URL")).toBeInTheDocument();
  });
});
