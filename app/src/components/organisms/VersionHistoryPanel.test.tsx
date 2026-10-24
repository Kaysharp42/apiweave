import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitAccount } from "@shared/types/GitAccount";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import {
  installGitBridge,
  trackedStatus,
  untrackedStatus,
} from "../../__tests__/gitFixtures";

/** A tracked workspace with no remote, the panel's plainest case. */
const local = (overrides = {}) =>
  trackedStatus({ remoteUrl: null, lastSyncedAt: null, ...overrides });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VersionHistoryPanel", () => {
  it("tracks an untracked workspace and shows its first commit", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(untrackedStatus, {
      track: vi.fn(async () => local()),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /track this workspace/i }));

    expect(bridge.track).toHaveBeenCalledWith("ws-1");
    expect(await screen.findByText(/abc1234 Start tracking this workspace in APIWeave/)).toBeInTheDocument();
    // Auto mode commits on its own: there is no message field to fill in.
    expect(screen.queryByRole("textbox", { name: /commit message/i })).toBeNull();
  });

  it("commits through the dialog in manual mode: the changes by name, then the message", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(local({ mode: "manual", uncommitted: true }), {
      pendingChanges: vi.fn(async () => [
        { kind: "workflow" as const, change: "added" as const, name: "Login", path: "workflows/login--w1.json" },
      ]),
      syncNow: vi.fn(async () => local({ mode: "manual" })),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /^commit now$/i }));
    expect(await screen.findByText(/Added workflow/)).toHaveTextContent("Added workflow “Login”");
    await user.type(screen.getByRole("textbox", { name: /commit message/i }), "Add the login flow");
    await user.click(screen.getByRole("button", { name: /^commit$/i }));

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", { message: "Add the login flow" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /commit message/i })).toBeNull());

    await user.click(screen.getByRole("checkbox"));
    expect(bridge.setMode).toHaveBeenCalledWith("ws-1", "auto");
  });

  it("syncs straight away in manual mode when nothing is waiting to be committed", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus({ mode: "manual" }));
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /^sync now$/i }));

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", undefined);
    expect(bridge.pendingChanges).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: /commit message/i })).toBeNull();
  });

  it("shows why a sync stopped from the status it resolves with", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus({ mode: "manual" }), {
      syncNow: vi.fn(async () =>
        trackedStatus({
          mode: "manual",
          state: "diverged",
          incoming: 1,
          outgoing: 1,
          lastError: { code: null, message: "both sides changed" },
        }),
      ),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /^sync now$/i }));

    expect(await screen.findByText(/Both this device and the remote changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard local changes/i })).toBeInTheDocument();
  });

  it("follows the statuses main pushes for this workspace only, and words a failure instead of repeating git", async () => {
    const { push } = installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);
    await screen.findByText(/abc1234/);

    act(() => push(local({ workspaceId: "ws-2", state: "error", lastError: { code: "timeout", message: "elsewhere" } })));
    act(() => push(local({ state: "error", lastError: { code: "command_failed", message: "git commit failed" } })));

    expect(await screen.findByText(/Git reported an error APIWeave doesn't recognise/)).toBeInTheDocument();
    expect(screen.getByText("git commit failed")).toBeInTheDocument();
    expect(screen.queryByText("elsewhere")).toBeNull();
    expect(screen.getByRole("button", { name: /^retry$/i })).toBeInTheDocument();
  });

  it("asks for an author when git has none, and commits under the one given", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(untrackedStatus, {
      track: vi.fn(async () =>
        local({ state: "error", lastCommit: null, lastError: { code: "identity_missing", message: "git commit failed: Author identity unknown" } }),
      ),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /track this workspace/i }));
    // The reason is a code; git's own words are not shown as the problem.
    expect(screen.queryByText(/Author identity unknown/)).toBeNull();
    const save = await screen.findByRole("button", { name: /save and commit/i });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /your name/i }), "Ada Lovelace");
    await user.type(screen.getByRole("textbox", { name: /your email address/i }), "ada@example.invalid");
    await user.click(save);

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", { identity: { name: "Ada Lovelace", email: "ada@example.invalid" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: /save and commit/i })).toBeNull());
  });

  it("asks before it stops tracking, then untracks", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /^stop tracking$/i }));
    expect(bridge.untrack).not.toHaveBeenCalled();
    const confirm = await screen.findAllByRole("button", { name: /^stop tracking$/i });
    await user.click(confirm[confirm.length - 1]!);

    expect(bridge.untrack).toHaveBeenCalledWith("ws-1");
    expect(await screen.findByRole("button", { name: /track this workspace/i })).toBeInTheDocument();
  });

  it("connects a remote by its trimmed URL when no account is signed in, and shows the status it returns", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    const connect = screen.getByRole("button", { name: /connect to remote/i });
    expect(connect).toBeDisabled();
    // With no account, the picker is the URL field, for any host.
    const field = await screen.findByRole("textbox", { name: "Repository URL" });
    expect(field).toHaveAttribute("placeholder", "https://host/owner/repo.git or git@host:owner/repo.git");
    await user.type(field, "  git@github.com:acme/tests.git  ");
    await user.click(connect);

    expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "git@github.com:acme/tests.git", null);
    expect(await screen.findByText("git@github.com:acme/tests.git")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Repository URL" })).toBeNull();
    expect(screen.getByRole("button", { name: /^disconnect$/i })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /account/i })).toBeNull();
  });

  describe("the account a remote is reached as", () => {
    const WORK: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null };
    const PERSONAL: GitAccount = { ...WORK, login: "octo-personal", active: false };
    const SSH: GitAccount = { ...WORK, login: "octo-ssh", gitProtocol: "ssh", active: false };
    const TANUKI: GitAccount = { provider: "gitlab", host: "gitlab.com", login: "tanuki", gitProtocol: "https", active: true, problem: null };
    const ref = ({ provider, host, login }: GitAccount) => ({ provider, host, login });
    const listAccounts = vi.fn(async () => ({ clis: [], accounts: [WORK, PERSONAL, SSH, TANUKI] }));
    const repository = (owner: string, name: string) => ({
      owner,
      name,
      fullName: `${owner}/${name}`,
      httpsUrl: `https://github.com/${owner}/${name}.git`,
      sshUrl: `git@github.com:${owner}/${name}.git`,
      private: true,
      empty: true,
      canPush: true,
    });
    const listRepositories = vi.fn(async (account: { readonly login: string }) => ({
      repositories: [repository(account.login, "shop-api"), repository("acme", "billing")],
      problems: [],
    }));

    it("starts on the first account, lists its empty repositories with Create repository… first, and connects to one as it", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(local(), { listAccounts, listRepositories });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      const picker = await screen.findByRole("combobox", { name: "Repository" });
      await waitFor(() => expect(within(picker).getByRole("option", { name: "acme/billing (private)" })).toBeInTheDocument());
      expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
        "Choose a repository",
        "Create repository…",
        "octo-work/shop-api (private)",
        "acme/billing (private)",
      ]);
      expect(bridge.listRepositories).toHaveBeenCalledWith(ref(WORK), { tagged: false, emptyOnly: true });
      await user.selectOptions(picker, "acme/billing");
      await user.click(screen.getByRole("button", { name: /connect to remote/i }));

      expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "https://github.com/acme/billing.git", ref(WORK));
    });

    it("lists another account's repositories when it is chosen, keeps each list while open, and refreshes on demand", async () => {
      const user = userEvent.setup();
      const listed = vi.fn(listRepositories);
      installGitBridge(local(), { listAccounts, listRepositories: listed });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);
      const account = await screen.findByRole("combobox", { name: "Account" });
      await screen.findByRole("option", { name: "octo-work/shop-api (private)" });

      await user.selectOptions(account, "github|github.com|octo-personal");
      expect(await screen.findByRole("option", { name: "octo-personal/shop-api (private)" })).toBeInTheDocument();
      await user.selectOptions(account, "github|github.com|octo-work");
      expect(await screen.findByRole("option", { name: "octo-work/shop-api (private)" })).toBeInTheDocument();
      expect(listed).toHaveBeenCalledTimes(2);

      await user.click(screen.getByRole("button", { name: "Refresh repositories" }));
      await waitFor(() => expect(listed).toHaveBeenCalledTimes(3));
    });

    it("connects an SSH account's repository by its SSH URL, bound to no account", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(local(), { listAccounts, listRepositories });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      await user.selectOptions(await screen.findByRole("combobox", { name: "Account" }), "github|github.com|octo-ssh");
      await user.selectOptions(await screen.findByRole("combobox", { name: "Repository" }), await screen.findByRole("option", { name: "octo-ssh/shop-api (private)" }));
      expect(screen.getByText(/octo-ssh uses SSH/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /connect to remote/i }));

      expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "git@github.com:octo-ssh/shop-api.git", null);
    });

    it("takes a URL instead for a repository not listed, reached as the account when it is an https one", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(local(), { listAccounts, listRepositories });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      await user.click(await screen.findByRole("button", { name: "Use a URL instead" }));
      await user.type(screen.getByRole("textbox", { name: "Repository URL" }), "https://github.com/acme/not-listed.git");
      await user.click(screen.getByRole("button", { name: /connect to remote/i }));
      expect(bridge.connectRemote).toHaveBeenLastCalledWith("ws-1", "https://github.com/acme/not-listed.git", ref(WORK));
    });

    it("connects a URL on another host with the user's own sign-in", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(local(), { listAccounts, listRepositories });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      await user.selectOptions(await screen.findByRole("combobox", { name: "Account" }), "");
      await user.type(screen.getByRole("textbox", { name: "Repository URL" }), "https://git.example/team/tests.git");
      await user.click(screen.getByRole("button", { name: /connect to remote/i }));

      expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "https://git.example/team/tests.git", null);
    });

    it("says which owner could not be listed, rather than showing a short list as the whole one", async () => {
      installGitBridge(local(), {
        listAccounts,
        listRepositories: vi.fn(async () => ({ repositories: [], problems: ["acme: Resource protected by organization SAML enforcement."] })),
      });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      expect(await screen.findByText("acme: Resource protected by organization SAML enforcement.")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "No empty repository you can push to" })).toBeInTheDocument();
    });

    it("signs in from the connect form, and lists the account just added", async () => {
      const user = userEvent.setup();
      const added = vi.fn().mockResolvedValueOnce({ clis: [], accounts: [] }).mockResolvedValue({ clis: [], accounts: [PERSONAL] });
      const { bridge } = installGitBridge(local(), { listAccounts: added, listRepositories, signIn: vi.fn(async () => ref(PERSONAL)) });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      await user.click(await screen.findByRole("button", { name: /sign in to github/i }));
      expect(screen.getByRole("textbox", { name: "Host" })).toHaveValue("github.com");
      await user.click(screen.getByRole("button", { name: /sign in in the browser/i }));
      await user.click(await screen.findByRole("button", { name: /^done$/i }));

      await user.selectOptions(await screen.findByRole("combobox", { name: "Repository" }), await screen.findByRole("option", { name: "octo-personal/shop-api (private)" }));
      await user.click(screen.getByRole("button", { name: /connect to remote/i }));
      expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "https://github.com/octo-personal/shop-api.git", ref(PERSONAL));
    });

    it("changes the account of a connected workspace, and back to the user's own sign-in", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(trackedStatus({ account: ref(WORK) }), { listAccounts });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      const picker = await screen.findByRole("combobox", { name: /account/i });
      await waitFor(() => expect(picker).toHaveValue("github|github.com|octo-work"));
      await user.selectOptions(picker, "github|github.com|octo-personal");
      expect(bridge.setAccount).toHaveBeenCalledWith("ws-1", ref(PERSONAL));

      await user.selectOptions(picker, "");
      expect(bridge.setAccount).toHaveBeenLastCalledWith("ws-1", null);
    });

    it("says why a tool could not list its accounts, rather than just showing none", async () => {
      installGitBridge(trackedStatus(), {
        listAccounts: vi.fn(async () => ({
          clis: [
            { provider: "github" as const, command: "gh" as const, missing: false, version: "2.97.0", problem: "gh did not answer in time" },
            { provider: "gitlab" as const, command: "glab" as const, missing: true, version: null, problem: null },
          ],
          accounts: [],
        })),
      });
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      // The tool's own words already name it: no "gh: gh …".
      expect(await screen.findByText("gh did not answer in time")).toBeInTheDocument();
      expect(screen.queryByText(/glab/)).toBeNull();
    });

    it("keeps showing a bound account that is no longer signed in, rather than changing it", async () => {
      installGitBridge(trackedStatus({ account: { provider: "github", host: "github.com", login: "gone" } }));
      render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

      const picker = await screen.findByRole("combobox", { name: /account/i });
      expect(picker).toHaveValue("github|github.com|gone");
      expect(screen.getByRole("option", { name: "gone on github.com — not signed in" })).toBeInTheDocument();
    });
  });

  it("shows the remote, the branch and the sync state of a connected workspace", async () => {
    installGitBridge(trackedStatus({ branch: "trunk", outgoing: 2 }));
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    expect(await screen.findByText("https://github.com/acme/tests.git")).toBeInTheDocument();
    expect(screen.getByText("trunk")).toBeInTheDocument();
    expect(screen.getByText("Pending (2 to push)")).toBeInTheDocument();
    expect(screen.getByText(/2 commits haven't been pushed to the remote yet/)).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
  });

  it("shows why a connect was refused, and keeps the URL to correct", async () => {
    const user = userEvent.setup();
    installGitBridge(local(), {
      connectRemote: vi.fn().mockRejectedValueOnce(
        new Error("That repository already has history this workspace did not come from. Open a workspace from git instead."),
      ),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.type(await screen.findByRole("textbox", { name: "Repository URL" }), "https://example.com/other.git");
    await user.click(screen.getByRole("button", { name: /connect to remote/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That repository already has history this workspace did not come from.");
    expect(screen.getByRole("textbox", { name: "Repository URL" })).toHaveValue("https://example.com/other.git");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("asks before it disconnects, then disconnects", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus());
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    expect(await screen.findByText("https://github.com/acme/tests.git")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^disconnect$/i }));
    expect(bridge.disconnectRemote).not.toHaveBeenCalled();
    expect(await screen.findByText("Every local commit stays; only the connection is removed.")).toBeInTheDocument();
    const confirm = await screen.findAllByRole("button", { name: /^disconnect$/i });
    await user.click(confirm[confirm.length - 1]!);

    expect(bridge.disconnectRemote).toHaveBeenCalledWith("ws-1");
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });

  it("offers Discard local changes for any connected workspace, and asks first", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus());
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /^discard local changes$/i }));
    expect(bridge.discardLocalChanges).not.toHaveBeenCalled();
    expect(await screen.findByText(/thrown away, and the remote's version of this workspace is loaded/)).toBeInTheDocument();
    const confirm = await screen.findAllByRole("button", { name: /^discard local changes$/i });
    await user.click(confirm[confirm.length - 1]!);

    expect(bridge.discardLocalChanges).toHaveBeenCalledWith("ws-1");
  });

  it("has no Discard for a workspace with no remote, and says its history is local", async () => {
    installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    expect(await screen.findByText("Local history")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discard local changes/i })).toBeNull();
  });

  it("shows a failed call's message", async () => {
    const user = userEvent.setup();
    installGitBridge(untrackedStatus, {
      track: vi.fn().mockRejectedValueOnce(new Error("git is not installed or not on PATH")),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    await user.click(await screen.findByRole("button", { name: /track this workspace/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("git is not installed or not on PATH");
  });

  it("says version history needs the desktop app when there is no bridge", () => {
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);
    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
  });
});

describe("Create repository", () => {
  const HTTPS: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null };
  const SSH: GitAccount = { ...HTTPS, login: "octo-ssh", gitProtocol: "ssh", active: false };

  async function createFrom(account: GitAccount, overrides: Parameters<typeof installGitBridge>[1] = {}) {
    const user = userEvent.setup();
    const installed = installGitBridge(local(), { listAccounts: vi.fn(async () => ({ clis: [], accounts: [HTTPS, SSH] })), ...overrides });
    render(<VersionHistoryPanel workspaceId="ws-1" workspaceSlug="shop-api" />);

    // Create repository… is the first entry of the account's repository list.
    await user.selectOptions(await screen.findByRole("combobox", { name: "Account" }), `${account.provider}|${account.host}|${account.login}`);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Repository" }), "Create repository…");
    const dialog = await screen.findByRole("dialog", { name: "Create repository" });
    expect(within(dialog).getByRole("combobox", { name: "Account" })).toHaveValue(`${account.provider}|${account.host}|${account.login}`);
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Owner" })).toHaveValue(account.login));
    return { user, dialog, ...installed };
  }

  it("creates a private repository named after the workspace, then connects to it as the HTTPS account", async () => {
    const { user, dialog, bridge } = await createFrom(HTTPS);

    expect(within(dialog).getByRole("textbox", { name: "Repository name" })).toHaveValue("shop-api");
    expect(within(dialog).getByRole("combobox", { name: "Visibility" })).toHaveValue("private");
    await user.click(within(dialog).getByRole("button", { name: "Create and connect" }));

    await waitFor(() =>
      expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "https://github.com/octo-work/shop-api.git", {
        provider: "github",
        host: "github.com",
        login: "octo-work",
      }),
    );
    expect(bridge.createRepository).toHaveBeenCalledWith(
      { provider: "github", host: "github.com", login: "octo-work" },
      { owner: "octo-work", name: "shop-api", private: true },
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("connects an SSH account's repository by its SSH URL, bound to no account", async () => {
    const { user, dialog, bridge } = await createFrom(SSH);

    await user.click(within(dialog).getByRole("button", { name: "Create and connect" }));

    await waitFor(() => expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "git@github.com:octo-ssh/shop-api.git", null));
  });

  it("refuses a name that is not one, before asking the host", async () => {
    const { user, dialog, bridge } = await createFrom(HTTPS);
    const name = within(dialog).getByRole("textbox", { name: "Repository name" });

    await user.clear(name);
    await user.type(name, "-shop..api");

    expect(within(dialog).getByText(/use letters and digits/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create and connect" })).toBeDisabled();
    expect(bridge.createRepository).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the host's refusal, naming a repository that exists", async () => {
    const { user, dialog, bridge } = await createFrom(HTTPS, {
      createRepository: vi.fn().mockRejectedValueOnce(new Error("github.com/octo-work/shop-api already exists.")),
    });

    await user.click(within(dialog).getByRole("button", { name: "Create and connect" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("github.com/octo-work/shop-api already exists.");
    expect(bridge.connectRemote).not.toHaveBeenCalled();
  });

  it("keeps a repository it could not connect to, says so, and fills the connect form in with it", async () => {
    const { user, dialog } = await createFrom(HTTPS, {
      connectRemote: vi.fn().mockRejectedValueOnce(new Error("Could not reach github.com.")),
    });

    await user.click(within(dialog).getByRole("button", { name: "Create and connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "github.com/octo-work/shop-api was created, but connecting this workspace to it failed. The repository was kept",
    );
    expect(screen.getByRole("textbox", { name: "Repository URL" })).toHaveValue("https://github.com/octo-work/shop-api.git");
    expect(screen.getByRole("combobox", { name: "Account" })).toHaveValue("github|github.com|octo-work");
    expect(screen.getByRole("button", { name: /connect to remote/i })).toBeEnabled();
  });

  it("says when the repository could not be tagged, once it is connected", async () => {
    const { user, dialog } = await createFrom(HTTPS, {
      createRepository: vi.fn(async () => ({
        repository: {
          owner: "octo-work",
          name: "shop-api",
          fullName: "octo-work/shop-api",
          httpsUrl: "https://github.com/octo-work/shop-api.git",
          sshUrl: "git@github.com:octo-work/shop-api.git",
          private: true,
          empty: true,
          canPush: true,
        },
        problem: "octo-work/shop-api was created, but not tagged apiweave-workspace: Forbidden",
      })),
    });

    await user.click(within(dialog).getByRole("button", { name: "Create and connect" }));

    expect(await screen.findByRole("status")).toHaveTextContent("not tagged apiweave-workspace");
  });
});