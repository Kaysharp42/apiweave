// @vitest-environment jsdom
import "../../../__tests__/setup";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { GitAccount } from "@shared/types/GitAccount";
import type { GitBridge } from "@shared/types/GitBridge";
import { CreateWorkspaceModal } from "../CreateWorkspaceModal";
import { installGitBridge, trackedStatus, untrackedStatus } from "../../../__tests__/gitFixtures";
import type { Workspace } from "../../../types/Workspace";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentOrg: { slug: "personal" } }),
}));

const created: Workspace = {
  workspaceId: "ws-new",
  slug: "qa-workspace",
  name: "QA Workspace",
  description: null,
  isPersonal: false,
  deletedAt: null,
  rev: 1,
  createdAt: "2026-07-19T00:00:00.000Z",
  updatedAt: "2026-07-19T00:00:00.000Z",
} as unknown as Workspace;

const WORK: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null };
const WORK_REF = { provider: "github" as const, host: "github.com", login: "octo-work" };

function stubBridge() {
  const invoke = vi.fn(async () => ({ ok: true as const, data: created }));
  const bridge = {
    invoke,
    onRunProgress: vi.fn().mockReturnValue(() => undefined),
  };
  vi.stubGlobal("__APIWEAVE_IPC__", bridge);
  Object.defineProperty(window, "__APIWEAVE_IPC__", {
    value: bridge,
    configurable: true,
  });
  return invoke;
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="location-state">{JSON.stringify(location.state)}</div>
    </>
  );
}

function renderModal(onCreated = vi.fn().mockResolvedValue(undefined), onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={["/personal/personal/workflows"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <CreateWorkspaceModal isOpen onClose={onClose} onCreated={onCreated} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onCreated, onClose };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CreateWorkspaceModal (desktop)", () => {
  it("creates a non-personal workspace over IPC", async () => {
    const invoke = stubBridge();
    const user = userEvent.setup();
    const { onCreated } = renderModal();

    await user.type(
      screen.getByPlaceholderText("QA Workspace"),
      "QA Workspace",
    );
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(invoke).toHaveBeenCalledWith(
      "workspaces",
      "create",
      expect.objectContaining({
        name: "QA Workspace",
        slug: "qa-workspace",
        isPersonal: false,
      }),
    );
  });

  it("offers no Cloud ownership or encryption choice", () => {
    stubBridge();
    renderModal();

    expect(screen.queryByText(/Cloud Team/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/End-to-end encrypt/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("offers no sync without the desktop's git bridge", () => {
    stubBridge();
    renderModal();

    expect(screen.queryByRole("checkbox", { name: "Sync with GitHub or GitLab" })).toBeNull();
  });
});

describe("CreateWorkspaceModal's sync with GitHub or GitLab", () => {
  function installGit(overrides: Partial<GitBridge> = {}) {
    stubBridge();
    return installGitBridge(untrackedStatus, { listAccounts: vi.fn(async () => ({ clis: [], accounts: [WORK] })), ...overrides });
  }

  async function fillAndSync(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText("QA Workspace"), "QA Workspace");
    await user.click(screen.getByRole("checkbox", { name: "Sync with GitHub or GitLab" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("octo-work"));
  }

  it("is off by default, and then creates the workspace alone", async () => {
    const { bridge } = installGit();
    const user = userEvent.setup();
    const { onCreated } = renderModal();

    expect(screen.getByRole("checkbox", { name: "Sync with GitHub or GitLab" })).not.toBeChecked();
    await user.type(screen.getByPlaceholderText("QA Workspace"), "QA Workspace");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(bridge.track).not.toHaveBeenCalled();
    expect(bridge.createRepository).not.toHaveBeenCalled();
    expect(bridge.connectRemote).not.toHaveBeenCalled();
  });

  it("creates the workspace, tracks it, creates a private repository named after its slug and connects as the account", async () => {
    const { bridge } = installGit();
    const user = userEvent.setup();
    const { onCreated, onClose } = renderModal();

    await fillAndSync(user);
    expect(screen.getByRole("textbox", { name: "Repository name" })).toHaveValue("qa-workspace");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(bridge.track).toHaveBeenCalledWith("ws-new");
    expect(bridge.createRepository).toHaveBeenCalledWith(WORK_REF, { owner: "octo-work", name: "qa-workspace", private: true });
    expect(bridge.connectRemote).toHaveBeenCalledWith("ws-new", "https://github.com/octo-work/qa-workspace.git", WORK_REF);
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(toast.success).toHaveBeenCalledWith('Workspace "QA Workspace" created and synced with github.com', undefined);
  });

  it("names the repository after the slug until the name is edited", async () => {
    installGit();
    const user = userEvent.setup();
    renderModal();

    await fillAndSync(user);
    const name = screen.getByRole("textbox", { name: "Repository name" });
    await user.clear(name);
    await user.type(name, "api-tests");
    await user.type(screen.getByPlaceholderText("QA Workspace"), " Two");

    expect(name).toHaveValue("api-tests");
  });

  it("keeps the workspace, tracked, when the repository cannot be created, and sends the user to Version history", async () => {
    const { bridge } = installGit({
      createRepository: vi.fn().mockRejectedValueOnce(new Error("github.com/octo-work/qa-workspace already exists.")),
    });
    const user = userEvent.setup();
    const { onCreated, onClose } = renderModal();

    await fillAndSync(user);
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workspace was created and tracked, but the repository could not be created: github.com/octo-work/qa-workspace already exists. Create it from Version history.",
    );
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(bridge.connectRemote).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create workspace" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open Version history" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/personal/qa-workspace/settings/version-history");
    // The repository it was going to make goes with it, for Version history to start from.
    expect(JSON.parse(screen.getByTestId("location-state").textContent ?? "{}")).toMatchObject({
      gitRepositoryDraft: { owner: "octo-work", name: "qa-workspace", private: true },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a repository it could not connect to, and says so", async () => {
    installGit({ connectRemote: vi.fn().mockRejectedValueOnce(new Error("Could not reach github.com.")) });
    const user = userEvent.setup();
    renderModal();

    await fillAndSync(user);
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "github.com/octo-work/qa-workspace was created, but connecting this workspace to it failed. The repository was kept",
    );
  });

  it("asks who the commit is by when git knows no author, then creates and connects, instead of stopping halfway", async () => {
    const { bridge } = installGit({
      track: vi.fn(async () => trackedStatus({ workspaceId: "ws-new", remoteUrl: null, lastCommit: null, lastError: { code: "identity_missing", message: "Author identity unknown" } })),
      syncNow: vi.fn(async () => trackedStatus({ workspaceId: "ws-new", remoteUrl: "https://github.com/octo-work/qa-workspace.git", account: WORK_REF })),
    });
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await fillAndSync(user);
    await user.click(screen.getByRole("button", { name: "Create workspace" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText(/Tell git who is making its commits/)).toBeInTheDocument();
    expect(bridge.createRepository).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole("textbox", { name: "Your name" }), "Ada Lovelace");
    await user.type(within(dialog).getByRole("textbox", { name: "Your email address" }), "ada@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Save and commit" }));

    await waitFor(() =>
      expect(bridge.syncNow).toHaveBeenCalledWith("ws-new", { identity: { name: "Ada Lovelace", email: "ada@example.com" } }),
    );
    await waitFor(() => expect(bridge.connectRemote).toHaveBeenCalledWith("ws-new", "https://github.com/octo-work/qa-workspace.git", WORK_REF));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });
});
