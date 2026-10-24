import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitAccountList } from "@shared/types/GitAccountList";
import { GitAccountsMenu } from "./GitAccountsMenu";
import { useWorkspaceGitStatus } from "../../hooks/useWorkspaceGitStatus";
import { installGitBridge, trackedStatus, untrackedStatus } from "../../__tests__/gitFixtures";

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: { slug: "personal" },
    currentWorkspace: { workspaceId: "ws-1", slug: "acme" },
  }),
}));

vi.mock("./WindowControls", () => ({
  WindowControls: () => null,
  dragStyle: {},
  noDragStyle: {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const WORK = { provider: "github" as const, host: "github.com", login: "octo-work" };

const LIST: GitAccountList = {
  clis: [
    { provider: "github", command: "gh", missing: false, version: "2.97.0", problem: null },
    { provider: "gitlab", command: "glab", missing: false, version: "1.46.1", problem: null },
  ],
  accounts: [
    { ...WORK, gitProtocol: "https", active: true, problem: null },
    { provider: "github", host: "github.com", login: "octo-personal", gitProtocol: "https", active: false, problem: null },
    { provider: "gitlab", host: "gitlab.com", login: "tanuki", gitProtocol: "https", active: true, problem: "401 Unauthorized" },
  ],
};

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/** The menu fed the way the header feeds it: the current workspace's status. */
function HeaderFeed() {
  return <GitAccountsMenu status={useWorkspaceGitStatus("ws-1").status} />;
}

function renderMenu() {
  render(
    <MemoryRouter initialEntries={["/personal/acme/workflows"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <HeaderFeed />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GitAccountsMenu", () => {
  it("is absent with no bridge to ask", () => {
    renderMenu();
    expect(screen.queryByRole("button", { name: /Git accounts/ })).toBeNull();
  });

  it("shows the workspace's account initials and its sync state, and a neutral trigger for a workspace with none", async () => {
    installGitBridge(trackedStatus({ account: WORK }));
    renderMenu();

    const trigger = await screen.findByRole("button", { name: "Git accounts — this workspace uses octo-work on github.com — Synced" });
    expect(trigger).toHaveTextContent("OW");
    vi.unstubAllGlobals();

    installGitBridge(untrackedStatus);
    renderMenu();
    const neutral = await screen.findAllByRole("button", { name: "Git accounts" });
    expect(neutral.at(-1)).not.toHaveTextContent(/\w/);
  });

  it("lists accounts by host, marks the one this workspace uses, and says what is wrong with one", async () => {
    const { bridge } = installGitBridge(trackedStatus({ account: WORK }), { listAccounts: vi.fn(async () => LIST) });
    renderMenu();

    // The tools are not asked until the menu opens.
    expect(bridge.listAccounts).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole("button", { name: /^Git accounts/ }));

    const github = await screen.findByRole("region", { name: "GitHub on github.com" });
    const work = within(github).getByText("octo-work").closest("li");
    expect(work).not.toBeNull();
    expect(within(work as HTMLElement).getByText("This workspace")).toBeInTheDocument();
    expect(within(github).getByText("octo-personal").closest("li")).not.toHaveTextContent("This workspace");
    const gitlab = screen.getByRole("region", { name: "GitLab on gitlab.com" });
    expect(within(gitlab).getByText("401 Unauthorized")).toBeInTheDocument();
    expect(screen.getByText(/glab keeps one account per host/)).toBeInTheDocument();
  });

  it("keeps a workspace's account that is not signed in any more in view", async () => {
    const gone = { provider: "github" as const, host: "github.com", login: "gone" };
    installGitBridge(trackedStatus({ account: gone }), { listAccounts: vi.fn(async () => LIST) });
    renderMenu();

    await userEvent.click(await screen.findByRole("button", { name: /^Git accounts/ }));

    const row = (await screen.findByText("gone")).closest("li") as HTMLElement;
    expect(within(row).getByText("This workspace")).toBeInTheDocument();
    expect(within(row).getByText("gh is not signed in as gone any more")).toBeInTheDocument();
  });

  it("signs in to another account with the provider's own dialog", async () => {
    installGitBridge(untrackedStatus, { listAccounts: vi.fn(async () => LIST) });
    renderMenu();

    await userEvent.click(await screen.findByRole("button", { name: "Git accounts" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add GitLab account" }));

    const dialog = await screen.findByRole("dialog", { name: "Sign in to GitLab" });
    expect(within(dialog).getByRole("textbox", { name: "Host" })).toHaveValue("gitlab.com");
  });

  it("offers no sign-in with a tool that is not installed", async () => {
    installGitBridge(untrackedStatus, {
      listAccounts: vi.fn(async () => ({
        clis: [
          { provider: "github" as const, command: "gh" as const, missing: false, version: "2.97.0", problem: null },
          { provider: "gitlab" as const, command: "glab" as const, missing: true, version: null, problem: null },
        ],
        accounts: [],
      })),
    });
    renderMenu();

    await userEvent.click(await screen.findByRole("button", { name: "Git accounts" }));

    expect(await screen.findByText(/No GitHub or GitLab account is signed in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add GitLab account" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add GitHub account" })).toBeEnabled();
  });

  it("links to Settings > Git accounts", async () => {
    installGitBridge(untrackedStatus);
    renderMenu();

    await userEvent.click(await screen.findByRole("button", { name: "Git accounts" }));
    await userEvent.click(await screen.findByRole("button", { name: "Settings > Git accounts" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/personal/acme/settings/git-accounts");
  });
  it("is a panel labelled by its title, and offers sign-in only once the tools have answered", async () => {
    let answer: (list: GitAccountList) => void = () => undefined;
    installGitBridge(untrackedStatus, {
      listAccounts: vi.fn(() => new Promise<GitAccountList>((resolve) => { answer = resolve; })),
    });
    renderMenu();

    await userEvent.click(await screen.findByRole("button", { name: "Git accounts" }));

    expect(await screen.findByText("Checking your GitHub and GitLab sign-ins…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add GitHub account" })).toBeDisabled();
    const title = screen.getByRole("heading", { level: 2, name: "Git accounts" });
    expect(title.closest("[aria-labelledby]")).toHaveAttribute("aria-labelledby", title.id);
    act(() => answer(LIST));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Add GitHub account" })).toBeEnabled());
  });

  it("offers to set up sync for a workspace with no remote, and not for one that syncs", async () => {
    installGitBridge(trackedStatus({ remoteUrl: null }));
    renderMenu();

    await userEvent.click(await screen.findByRole("button", { name: /^Git accounts/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Set up sync for this workspace…" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/personal/acme/settings/version-history");
    vi.unstubAllGlobals();

    installGitBridge(trackedStatus({ account: WORK }));
    renderMenu();
    await userEvent.click(await screen.findByRole("button", { name: /this workspace uses octo-work/ }));
    await screen.findByRole("button", { name: "Settings > Git accounts" });
    expect(screen.queryByRole("button", { name: "Set up sync for this workspace…" })).toBeNull();
  });
});
