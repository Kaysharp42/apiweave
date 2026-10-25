import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Workspace } from "../Workspace";

// The canvas, its panels and the store/hook plumbing are not what this test is
// about: it proves the empty state's button is wired to the dialog that opens a
// workspace from git. Everything that would drag in the real canvas is stubbed.
vi.mock("../../WorkflowCanvas", () => ({ default: () => null }));
vi.mock("../../VariablesPanel", () => ({ default: () => null }));
vi.mock("../../WorkflowSettingsPanel", () => ({ default: () => null }));
vi.mock("../../DynamicFunctionsHelper", () => ({ default: () => null }));
vi.mock("../../../contexts/WorkflowContext", () => ({
  WorkflowProvider: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../../organisms/TabBar", () => ({
  TabBar: () => null,
  WORKSPACE_TABPANEL_ID: "workspace-tabpanel",
  workspaceTabId: (id: string) => `workspace-tab-${id}`,
}));
vi.mock("../../organisms/KeyboardShortcutsHelp", () => ({
  KeyboardShortcutsHelp: () => null,
}));
vi.mock("../../../hooks/useWorkspaceTabs", () => ({
  useWorkspaceTabs: () => ({ activeTabId: null, activeTab: undefined }),
}));
vi.mock("../../../hooks/useKeyboardShortcuts", () => ({
  default: () => undefined,
}));
vi.mock("../../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: null,
    workspaceSlug: null,
    orgId: null,
    orgSlug: null,
    isReady: false,
  }),
}));
vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    availableWorkspaces: [],
    currentWorkspace: null,
    currentOrg: null,
    orgs: [],
    switchTo: vi.fn(),
    refresh: vi.fn(async () => undefined),
    isLoading: false,
  }),
}));
vi.mock("../../../stores/TabStore", () => ({
  default: () => ({
    openTab: vi.fn(),
    closeTab: vi.fn(),
    activateNextTab: vi.fn(),
    activatePrevTab: vi.fn(),
  }),
}));
vi.mock("../../../stores/TutorialStore", () => ({
  default: (selector: (state: unknown) => unknown) =>
    selector({ completedLessonIds: [], lastLessonId: null }),
}));
vi.mock("../../../stores/SidebarStore", () => ({
  default: { getState: () => ({ signalWorkflowsRefresh: vi.fn() }) },
}));
vi.mock("../../../stores/NavigationStore", () => ({
  default: { getState: () => ({ toggleNavBarCollapse: vi.fn() }) },
}));
vi.mock("../../../stores/PendingEditsStore", () => ({
  confirmCloseTabs: vi.fn(async () => true),
}));
vi.mock("../../../utils/apiweaveClient", () => ({
  apiweave: { workflows: { create: vi.fn() } },
  git: {
    openFromGit: vi.fn(),
    // No account signed in: the dialog's picker is the URL field.
    listAccounts: vi.fn(async () => ({ clis: [], accounts: [] })),
    listRepositories: vi.fn(async () => ({ repositories: [], problems: [] })),
    onSignInPrompt: vi.fn(() => () => undefined),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("Workspace empty state", () => {
  it("opens the open-from-git dialog from its Open from git button", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Workspace />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open from git/i }));

    expect(
      screen.getByRole("dialog", { name: "Open workspace from git" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Repository URL" })).toBeInTheDocument();
  });
});
