import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitAccountList } from "@shared/types/GitAccountList";
import { GitAccountsSettingsPanel } from "../GitAccountsSettingsPanel";
import { installGitBridge, trackedStatus, untrackedStatus } from "../../../__tests__/gitFixtures";

vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    availableWorkspaces: [
      { workspaceId: "ws-1", name: "Shop API" },
      { workspaceId: "ws-2", name: "Billing" },
      { workspaceId: "ws-3", name: "Scratch" },
    ],
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const WORK = { provider: "github" as const, host: "github.com", login: "octo-work" };

const LIST: GitAccountList = {
  clis: [
    { provider: "github", command: "gh", missing: false, version: "2.97.0", problem: null },
    { provider: "gitlab", command: "glab", missing: true, version: null, problem: null },
  ],
  accounts: [
    { ...WORK, gitProtocol: "https", active: true, problem: null },
    { provider: "github", host: "github.com", login: "octo-personal", gitProtocol: "ssh", active: false, problem: null },
  ],
};

describe("GitAccountsSettingsPanel", () => {
  it("says it needs the desktop app with no bridge", () => {
    render(<GitAccountsSettingsPanel />);
    expect(screen.getByText(/only available in the desktop app/)).toBeInTheDocument();
  });

  it("lists each tool's accounts with the workspaces that use them, and where to install a missing tool", async () => {
    installGitBridge(untrackedStatus, {
      listAccounts: vi.fn(async () => LIST),
      statusAll: vi.fn(async () => [
        trackedStatus({ workspaceId: "ws-1", account: WORK }),
        trackedStatus({ workspaceId: "ws-2", account: WORK }),
        trackedStatus({ workspaceId: "ws-3" }),
      ]),
    });
    render(<GitAccountsSettingsPanel />);

    const work = (await screen.findByText("octo-work")).closest("li") as HTMLElement;
    expect(await within(work).findByText("Used by Shop API, Billing.")).toBeInTheDocument();
    expect(within(work).getByText(/gh's active account/)).toBeInTheDocument();
    const personal = screen.getByText("octo-personal").closest("li") as HTMLElement;
    expect(within(personal).getByText("No workspace uses this account.")).toBeInTheDocument();
    expect(within(personal).getByText(/SSH/)).toBeInTheDocument();
    expect(screen.getByText("GitHub CLI (gh) 2.97.0 is installed.")).toBeInTheDocument();

    expect(screen.getByText("The GitLab CLI (glab) is not installed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gitlab.com/gitlab-org/cli" })).toHaveAttribute(
      "href",
      "https://gitlab.com/gitlab-org/cli",
    );
    expect(screen.getByText(/glab keeps one account per host/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Sign in…" });
    expect(buttons.map((button) => (button as HTMLButtonElement).disabled)).toEqual([false, true]);
  });

  it("shows a tool's problem, and a list that could not be read at all", async () => {
    installGitBridge(untrackedStatus, {
      listAccounts: vi
        .fn()
        .mockResolvedValueOnce({
          clis: [{ provider: "github", command: "gh", missing: false, version: "2.97.0", problem: "gh did not answer in time" }],
          accounts: [],
        })
        .mockRejectedValueOnce(new Error("boom")),
    });
    render(<GitAccountsSettingsPanel />);

    expect(await screen.findByText("gh did not answer in time")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your gh and glab accounts could not be listed: boom");
  });

  it("signs in from the tool's card and lists the new account", async () => {
    const listAccounts = vi.fn(async () => LIST);
    installGitBridge(untrackedStatus, { listAccounts });
    render(<GitAccountsSettingsPanel />);

    await userEvent.click((await screen.findAllByRole("button", { name: "Sign in…" }))[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Sign in to GitHub" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign in in the browser" }));

    expect(await within(dialog).findByText(/Signed in to github.com as/)).toBeInTheDocument();
    await vi.waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(2));
  });
  it("shows Refresh working while the tools are asked again", async () => {
    let answer: (list: GitAccountList) => void = () => undefined;
    const listAccounts = vi.fn().mockResolvedValueOnce(LIST).mockImplementationOnce(() => new Promise<GitAccountList>((resolve) => { answer = resolve; }));
    installGitBridge(untrackedStatus, { listAccounts });
    render(<GitAccountsSettingsPanel />);

    const refresh = await screen.findByRole("button", { name: "Refresh" });
    await vi.waitFor(() => expect(refresh).toBeEnabled());
    await userEvent.click(refresh);

    expect(refresh).toBeDisabled();
    expect(refresh).toHaveAttribute("aria-busy", "true");
    act(() => answer(LIST));
    await vi.waitFor(() => expect(refresh).toBeEnabled());
  });});
