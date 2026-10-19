import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitBridge } from "@shared/types/GitBridge";
import type { OpenWorkspaceFromGitResult } from "@shared/types/OpenWorkspaceFromGitResult";
import { OpenWorkspaceFromGitModal } from "../OpenWorkspaceFromGitModal";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const mockRefresh = vi.fn<() => Promise<void>>();
const mockSwitchTo = vi.fn();

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ refresh: mockRefresh, switchTo: mockSwitchTo }),
}));

const URL_PLACEHOLDER = "https://host/owner/repo.git or git@host:owner/repo.git";
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

function installBridge(result: OpenWorkspaceFromGitResult): GitBridge["openFromGit"] {
  const openFromGit = vi.fn<GitBridge["openFromGit"]>(async () => result);
  vi.stubGlobal("__APIWEAVE_GIT__", { openFromGit });
  return openFromGit;
}

function renderModal(onClose = vi.fn()) {
  render(<OpenWorkspaceFromGitModal isOpen onClose={onClose} />);
  return onClose;
}

async function submit(user: ReturnType<typeof userEvent.setup>, url = REPOSITORY): Promise<void> {
  await user.type(screen.getByPlaceholderText(URL_PLACEHOLDER), url);
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

    await user.type(screen.getByPlaceholderText(URL_PLACEHOLDER), "   ");
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeDisabled();

    await user.type(screen.getByPlaceholderText(URL_PLACEHOLDER), REPOSITORY);
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeEnabled();
  });

  it("clones the repository, then refreshes the list, switches to the new workspace and closes", async () => {
    const openFromGit = installBridge(opened);
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user, `  ${REPOSITORY}  `);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(openFromGit).toHaveBeenCalledWith(REPOSITORY);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSwitchTo).toHaveBeenCalledWith("acme-qa-2");
    expect(mockRefresh.mock.invocationCallOrder[0]).toBeLessThan(mockSwitchTo.mock.invocationCallOrder[0]!);
  });

  it("shows the button busy and the field locked while the clone runs", async () => {
    let finish: (result: OpenWorkspaceFromGitResult) => void = () => undefined;
    const openFromGit = vi.fn<GitBridge["openFromGit"]>(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("__APIWEAVE_GIT__", { openFromGit });
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);

    const button = await screen.findByRole("button", { name: "Open workspace" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByPlaceholderText(URL_PLACEHOLDER)).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish(opened);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("shows the panel's error and stays open when the repository cannot be opened", async () => {
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
    expect(screen.queryByPlaceholderText(URL_PLACEHOLDER)).not.toBeInTheDocument();
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

    expect(screen.getByPlaceholderText(URL_PLACEHOLDER)).toHaveValue(REPOSITORY);
    expect(screen.queryByText(/already in APIWeave/)).not.toBeInTheDocument();
  });

  it("lists the import's warnings and switches only when the user confirms", async () => {
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
    // Nothing switched while the warnings were on screen.
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockSwitchTo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(URL_PLACEHOLDER)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open workspace" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSwitchTo).toHaveBeenCalledWith("acme-qa-2");
    expect(openFromGit).toHaveBeenCalledTimes(1);
  });

  it("goes back from the warnings to the form, and can close the dialog", async () => {
    installBridge(openedWithWarnings);
    const user = userEvent.setup();
    const onClose = renderModal();

    await submit(user);
    await user.click(await screen.findByRole("button", { name: "Back" }));

    expect(screen.getByPlaceholderText(URL_PLACEHOLDER)).toHaveValue(REPOSITORY);
    expect(
      screen.queryByText(/a few things to review/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
