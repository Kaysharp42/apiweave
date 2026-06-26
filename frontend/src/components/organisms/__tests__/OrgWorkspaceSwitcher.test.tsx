import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { OrgWorkspaceSwitcher } from "../OrgWorkspaceSwitcher";
import type { WorkspaceContextValue, WorkspaceEntry } from "../../../types";
import type { Organization } from "../../../types/Organization";
import type { Workspace } from "../../../types/Workspace";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSwitchTo = vi.fn();
const mockRefresh = vi.fn<() => Promise<void>>();
const mockAuthenticatedJson = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({ isSingleUser: false }));

vi.mock("../../../auth/useAuth", () => ({
  useAuth: () => ({ isSingleUser: authState.isSingleUser }),
}));

vi.mock("../../../utils/authenticatedApi", () => ({
  authenticatedJson: (...args: unknown[]) => mockAuthenticatedJson(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const defaultContext: WorkspaceContextValue = {
  orgs: [],
  availableWorkspaces: [],
  currentOrg: null,
  currentWorkspace: null,
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

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    orgId: "org-1",
    slug: "acme",
    name: "Acme Corp",
    description: null,
    avatarUrl: null,
    ownerUserId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    workspaceId: "ws-1",
    slug: "default",
    name: "Default",
    description: null,
    ownerType: "user",
    ownerUserId: "user-1",
    orgId: null,
    isPersonal: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEntry(
  org: Organization | null,
  ws: Workspace,
  role = "owner",
): WorkspaceEntry {
  return { org, workspace: ws, role };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OrgWorkspaceSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedJson.mockReset();
    mockRefresh.mockResolvedValue(undefined);
    authState.isSingleUser = false;
    setContext({
      orgs: [],
      availableWorkspaces: [],
      currentOrg: null,
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

  it("renders trigger button with personal label when no org is selected", () => {
    const personalWs = makeWorkspace({ name: "Personal" });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });
    renderSwitcher();
    expect(screen.getByLabelText("Switch workspace")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });

  it("renders trigger with org/workspace label when org is selected", () => {
    const org = makeOrg({ name: "Acme Corp" });
    const ws = makeWorkspace({ name: "Production" });
    setContext({
      currentOrg: org,
      currentWorkspace: ws,
    });
    renderSwitcher();
    expect(screen.getByText("Acme Corp / Production")).toBeInTheDocument();
  });

  it("opens dropdown on trigger click and shows workspaces", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ name: "Personal", isPersonal: true });
    const org = makeOrg({ name: "Acme Corp" });
    const orgWs = makeWorkspace({
      workspaceId: "ws-2",
      slug: "main",
      name: "Main",
      isPersonal: false,
      orgId: "org-1",
    });
    setContext({
      orgs: [org],
      availableWorkspaces: [makeEntry(null, personalWs), makeEntry(org, orgWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Personal").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Acme Corp").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Main")).toBeInTheDocument();
  });

  it("calls switchTo when a workspace option is clicked", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    const org = makeOrg({ slug: "acme" });
    const orgWs = makeWorkspace({
      workspaceId: "ws-2",
      slug: "main",
      name: "Main",
      isPersonal: false,
      orgId: "org-1",
    });
    setContext({
      orgs: [org],
      availableWorkspaces: [makeEntry(null, personalWs), makeEntry(org, orgWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    const mainOption = screen.getByText("Main");
    await user.click(mainOption);

    expect(mockSwitchTo).toHaveBeenCalledWith("acme", "main");
  });

  it("closes dropdown on Escape key", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
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
      availableWorkspaces: [makeEntry(null, personalWs)],
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

  it("shows organization creation in multi-tenant mode", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    expect(
      screen.getByRole("button", { name: "Create organization" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage organizations" }),
    ).toBeInTheDocument();
  });

  it("hides organization creation in single-user mode", async () => {
    const user = userEvent.setup();
    authState.isSingleUser = true;
    const personalWs = makeWorkspace({ isPersonal: true });
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));

    expect(
      screen.queryByRole("button", { name: "Create organization" }),
    ).not.toBeInTheDocument();
  });

  it("creates an organization from the switcher", async () => {
    const user = userEvent.setup();
    const personalWs = makeWorkspace({ isPersonal: true });
    const createdOrg = makeOrg({
      orgId: "org-42",
      slug: "org_42_labs",
      name: "42 Labs",
    });
    mockAuthenticatedJson.mockResolvedValue(createdOrg);
    setContext({
      availableWorkspaces: [makeEntry(null, personalWs)],
      currentWorkspace: personalWs,
    });

    renderSwitcher();
    await user.click(screen.getByLabelText("Switch workspace"));
    await user.click(
      screen.getByRole("button", { name: "Create organization" }),
    );
    await user.type(screen.getByPlaceholderText("Acme QA"), "42 Labs");
    await user.click(
      screen.getByRole("button", { name: "Create organization" }),
    );

    await waitFor(() => expect(mockAuthenticatedJson).toHaveBeenCalled());
    expect(mockAuthenticatedJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/orgs"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "42 Labs",
          slug: "org_42_labs",
          description: null,
        }),
      }),
    );
    expect(mockRefresh).toHaveBeenCalled();
  });
});
