import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import type { GitBridge } from "@shared/types/GitBridge";
import type { OpenWorkspaceFromGitResult } from "@shared/types/OpenWorkspaceFromGitResult";
import { OpenWorkspaceFromGitModal } from "../OpenWorkspaceFromGitModal";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const mockRefresh = vi.fn<() => Promise<void>>();
const mockSwitchTo = vi.fn();

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ refresh: mockRefresh, switchTo: mockSwitchTo }),
}));

const REPOSITORY = "https://git.example.com/acme/tests.git";

const opened: OpenWorkspaceFromGitResult = {
  kind: "opened",
  workspaceId: "ws-git",
  slug: "acme-qa-2",
  name: "Acme QA",
  warnings: [],
};
const openedWithWarnings: OpenWorkspaceFromGitResult = {
  ...opened,
  warnings: [
    "Workflow 'Member' has the placeholder \"<SECRET>\"; set the secret it was replaced with.",
    "No default environment was set; 'env-main' is now the workspace default.",
  ],
};
const duplicate: OpenWorkspaceFromGitResult = { ...opened, kind: "duplicate", slug: "acme-qa" };

/** No account signed in: the picker is the URL field, as before accounts. */
const NO_ACCOUNTS: Pick<GitBridge, "listAccounts" | "listRepositories" | "onSignInPrompt"> = {
  listAccounts: async () => ({ clis: [], accounts: [] }),
  listRepositories: async () => ({ repositories: [], problems: [] }),
  onSignInPrompt: () => () => undefined,
};

function installBridge(result: OpenWorkspaceFromGitResult, overrides: Partial<GitBridge> = {}): GitBridge["openFromGit"] {
  const openFromGit = vi.fn<GitBridge["openFromGit"]>(async () => result);
  vi.stubGlobal("__APIWEAVE_GIT__", { ...NO_ACCOUNTS, openFromGit, ...overrides });
  return openFromGit;
}

function renderModal(onClose = vi.fn()) {
  render(<OpenWorkspaceFromGitModal isOpen onClose={onClose} />);
  return onClose;
}

function urlField(): HTMLElement {
  return screen.getByRole("textbox", { name: "Repository URL" });
}

async function findUrlField(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: "Repository URL" });
}

function queryUrlField(): HTMLElement | null {
  return screen.queryByRole("textbox", { name: "Repository URL" });
}

async function submit(user: ReturnType<typeof userEvent.setup>, url = REPOSITORY): Promise<void> {
  await user.type(await findUrlField(), url);
  await user.click(screen.getByRole("button", { name: "Open workspace" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRefresh.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OpenWorkspaceFromGitModal", () => {
  it("explains what is cloned and keeps Open workspace disabled until there is a URL", async () => {
    installBridge(opened);
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText(/cloned from the repository into this app/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeDisabled();

    await user.type(await findUrlField(), "   ");
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeDisabled();

    await user.type(urlField(), REPOSITORY);
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeEnabled();
  });

  it("clones the repository, then refreshes the list, switches to the new workspace and closes", async () => {
    const openFromGit = installBridge(opened);
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user, `  ${REPOSITORY}  `);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // No account is signed in: the clone is the user's own credentials.
    expect(openFromGit).toHaveBeenCalledWith(REPOSITORY, null);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSwitchTo).toHaveBeenCalledWith("acme-qa-2");
    expect(mockRefresh.mock.invocationCallOrder[0]).toBeLessThan(mockSwitchTo.mock.invocationCallOrder[0]!);
  });

  it("shows the button busy and the field locked while the clone runs", async () => {
    let finish: (result: OpenWorkspaceFromGitResult) => void = () => undefined;
    const openFromGit = vi.fn<GitBridge["openFromGit"]>(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("__APIWEAVE_GIT__", { ...NO_ACCOUNTS, openFromGit });
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);

    const button = await screen.findByRole("button", { name: "Open workspace" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(urlField()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish(opened);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("shows the panel's error once, inline, and stays open when the repository cannot be opened", async () => {
    const openFromGit = installBridge(opened);
    vi.mocked(openFromGit).mockRejectedValueOnce(
      new Error("Error invoking remote method 'git:openFromGit': Error: .apiweave/format.json is missing: this is not an APIWeave workspace repository"),
    );
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      ".apiweave/format.json is missing: this is not an APIWeave workspace repository",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("Error invoking remote method");
    expect(toast.error).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeEnabled();
  });

  it("offers the existing workspace on a duplicate, and opens it without a second bridge call", async () => {
    const openFromGit = installBridge(duplicate);
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);

    expect(await screen.findByText(/This workspace is already in APIWeave:/)).toHaveTextContent("Acme QA");
    expect(queryUrlField()).not.toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open it" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSwitchTo).toHaveBeenCalledWith("acme-qa");
    expect(openFromGit).toHaveBeenCalledTimes(1);
  });

  it("goes back from a duplicate to the form with the URL still in it", async () => {
    installBridge(duplicate);
    const user = userEvent.setup();
    renderModal();

    await submit(user);
    await user.click(await screen.findByRole("button", { name: "Back" }));

    expect(await findUrlField()).toHaveValue(REPOSITORY);
    expect(screen.queryByText(/already in APIWeave/)).not.toBeInTheDocument();
  });

  it("lists the import's warnings, refreshes the list at once, and switches only when the user confirms", async () => {
    const openFromGit = installBridge(openedWithWarnings);
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);

    expect(
      await screen.findByText(/a few things to review/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/has the placeholder/)).toBeInTheDocument();
    expect(
      screen.getByText(/No default environment was set/),
    ).toBeInTheDocument();
    // The workspace already exists, so the list knows it before the user decides.
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockSwitchTo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(queryUrlField()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open workspace" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockSwitchTo).toHaveBeenCalledWith("acme-qa-2");
    expect(openFromGit).toHaveBeenCalledTimes(1);
  });

  it("shows every warning, even two with the same text, each under a key of its own", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installBridge({ ...opened, warnings: ["Set the secret TOKEN.", "Set the secret TOKEN."] });
    const user = userEvent.setup();
    renderModal();

    await submit(user);

    expect(await screen.findAllByText("Set the secret TOKEN.")).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/two children with the same key/);
    consoleError.mockRestore();
  });

  describe("with an account", () => {
    const WORK = { provider: "github" as const, host: "github.com", login: "octo-work", gitProtocol: "https" as const, active: true, problem: null };
    const tagged = {
      owner: "acme",
      name: "api-tests",
      fullName: "acme/api-tests",
      httpsUrl: "https://github.com/acme/api-tests.git",
      sshUrl: "git@github.com:acme/api-tests.git",
      private: true,
      empty: false,
      canPush: true,
    };
    const other = { ...tagged, name: "website", fullName: "acme/website", httpsUrl: "https://github.com/acme/website.git", private: false };

    it("lists the account's apiweave-workspace repositories and clones the one chosen as the account", async () => {
      const listRepositories = vi.fn<GitBridge["listRepositories"]>(async () => ({ repositories: [tagged], problems: [] }));
      const openFromGit = installBridge(opened, { listAccounts: async () => ({ clis: [], accounts: [WORK] }), listRepositories });
      const user = userEvent.setup();
      const onClose = renderModal();

      await user.selectOptions(await screen.findByRole("combobox", { name: "Repository" }), await screen.findByRole("option", { name: "acme/api-tests (private)" }));
      await user.click(screen.getByRole("button", { name: "Open workspace" }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(listRepositories).toHaveBeenCalledWith({ provider: "github", host: "github.com", login: "octo-work" }, { tagged: true, emptyOnly: false });
      expect(openFromGit).toHaveBeenCalledWith("https://github.com/acme/api-tests.git", { provider: "github", host: "github.com", login: "octo-work" });
    });

    it("shows every repository with Show all repositories, and says when none is tagged", async () => {
      const listRepositories = vi.fn<GitBridge["listRepositories"]>(async (_account, request) => ({
        repositories: request.tagged ? [] : [tagged, other],
        problems: [],
      }));
      installBridge(opened, { listAccounts: async () => ({ clis: [], accounts: [WORK] }), listRepositories });
      const user = userEvent.setup();
      renderModal();

      expect(await screen.findByRole("option", { name: "No repository tagged apiweave-workspace" })).toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "Show all repositories" }));

      expect(await screen.findByRole("option", { name: "acme/website" })).toBeInTheDocument();
      expect(listRepositories).toHaveBeenLastCalledWith(expect.anything(), { tagged: false, emptyOnly: false });
    });
  });

  it("closes from the warnings without switching, the workspace already in the list", async () => {
    installBridge(openedWithWarnings);
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);
    await screen.findByText(/a few things to review/i);
    // The footer's, not the dialog's own close icon.
    const close = screen.getAllByRole("button", { name: "Close" }).find((button) => button.textContent === "Close");
    await user.click(close!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSwitchTo).not.toHaveBeenCalled();
  });
});
