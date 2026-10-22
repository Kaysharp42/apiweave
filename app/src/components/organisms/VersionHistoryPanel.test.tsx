import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

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
    const { bridge } = installGitBridge(local({ mode: "manual" }));
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /^commit now$/i }));

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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /^sync now$/i }));

    expect(await screen.findByText(/Both this device and the remote changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard local changes/i })).toBeInTheDocument();
  });

  it("follows the statuses main pushes for this workspace only, and words a failure instead of repeating git", async () => {
    const { push } = installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" />);
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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /^stop tracking$/i }));
    expect(bridge.untrack).not.toHaveBeenCalled();
    const confirm = await screen.findAllByRole("button", { name: /^stop tracking$/i });
    await user.click(confirm[confirm.length - 1]!);

    expect(bridge.untrack).toHaveBeenCalledWith("ws-1");
    expect(await screen.findByRole("button", { name: /track this workspace/i })).toBeInTheDocument();
  });

  it("connects a remote with the trimmed URL and shows the status it returns", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    const connect = screen.getByRole("button", { name: /connect to remote/i });
    expect(connect).toBeDisabled();
    const field = screen.getByRole("textbox", { name: /remote url/i });
    expect(field).toHaveAttribute("placeholder", "https://host/owner/repo.git or git@host:owner/repo.git");
    await user.type(field, "  git@github.com:acme/tests.git  ");
    await user.click(connect);

    expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "git@github.com:acme/tests.git", null);
    expect(await screen.findByText("git@github.com:acme/tests.git")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /remote url/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^disconnect$/i })).toBeInTheDocument();
    // Neither gh nor glab lists an account: there is nothing to pick.
    expect(screen.queryByRole("combobox", { name: /account/i })).toBeNull();
  });

  describe("the account a remote is reached as", () => {
    const WORK: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null };
    const PERSONAL: GitAccount = { ...WORK, login: "octo-personal", active: false };
    const TANUKI: GitAccount = { provider: "gitlab", host: "gitlab.com", login: "tanuki", gitProtocol: "https", active: true, problem: null };
    const ref = ({ provider, host, login }: GitAccount) => ({ provider, host, login });
    const listAccounts = vi.fn(async () => ({ clis: [], accounts: [WORK, PERSONAL, TANUKI] }));

    it("connects as the account picked, offering only accounts on the remote's host", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(local(), { listAccounts });
      render(<VersionHistoryPanel workspaceId="ws-1" />);

      await user.type(await screen.findByRole("textbox", { name: /remote url/i }), "https://github.com/acme/tests.git");
      const picker = await screen.findByRole("combobox", { name: /account/i });
      expect([...picker.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
        "Your own git sign-in (credential manager or SSH key)",
        "octo-work on github.com",
        "octo-personal on github.com",
      ]);
      await user.selectOptions(picker, "github|github.com|octo-personal");
      await user.click(screen.getByRole("button", { name: /connect to remote/i }));

      expect(bridge.connectRemote).toHaveBeenCalledWith("ws-1", "https://github.com/acme/tests.git", ref(PERSONAL));
    });

    it("changes the account of a connected workspace, and back to the user's own sign-in", async () => {
      const user = userEvent.setup();
      const { bridge } = installGitBridge(trackedStatus({ account: ref(WORK) }), { listAccounts });
      render(<VersionHistoryPanel workspaceId="ws-1" />);

      const picker = await screen.findByRole("combobox", { name: /account/i });
      await waitFor(() => expect(picker).toHaveValue("github|github.com|octo-work"));
      await user.selectOptions(picker, "github|github.com|octo-personal");
      expect(bridge.setAccount).toHaveBeenCalledWith("ws-1", ref(PERSONAL));

      await user.selectOptions(picker, "");
      expect(bridge.setAccount).toHaveBeenLastCalledWith("ws-1", null);
    });

    it("keeps showing a bound account that is no longer signed in, rather than changing it", async () => {
      installGitBridge(trackedStatus({ account: { provider: "github", host: "github.com", login: "gone" } }));
      render(<VersionHistoryPanel workspaceId="ws-1" />);

      const picker = await screen.findByRole("combobox", { name: /account/i });
      expect(picker).toHaveValue("github|github.com|gone");
      expect(screen.getByRole("option", { name: "gone on github.com — not signed in" })).toBeInTheDocument();
    });
  });

  it("shows the remote, the branch and the sync state of a connected workspace", async () => {
    installGitBridge(trackedStatus({ branch: "trunk", outgoing: 2 }));
    render(<VersionHistoryPanel workspaceId="ws-1" />);

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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.type(await screen.findByRole("textbox", { name: /remote url/i }), "https://example.com/other.git");
    await user.click(screen.getByRole("button", { name: /connect to remote/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That repository already has history this workspace did not come from.");
    expect(screen.getByRole("textbox", { name: /remote url/i })).toHaveValue("https://example.com/other.git");
    expect(screen.getByText("Not connected")).toBeInTheDocument();
  });

  it("asks before it disconnects, then disconnects", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus());
    render(<VersionHistoryPanel workspaceId="ws-1" />);

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
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /^discard local changes$/i }));
    expect(bridge.discardLocalChanges).not.toHaveBeenCalled();
    expect(await screen.findByText(/thrown away, and the remote's version of this workspace is loaded/)).toBeInTheDocument();
    const confirm = await screen.findAllByRole("button", { name: /^discard local changes$/i });
    await user.click(confirm[confirm.length - 1]!);

    expect(bridge.discardLocalChanges).toHaveBeenCalledWith("ws-1");
  });

  it("has no Discard for a workspace with no remote, and says it is committed", async () => {
    installGitBridge(local());
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    expect(await screen.findByText("Committed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discard local changes/i })).toBeNull();
  });

  it("shows a failed call's message", async () => {
    const user = userEvent.setup();
    installGitBridge(untrackedStatus, {
      track: vi.fn().mockRejectedValueOnce(new Error("git is not installed or not on PATH")),
    });
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /track this workspace/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("git is not installed or not on PATH");
  });

  it("says version history needs the desktop app when there is no bridge", () => {
    render(<VersionHistoryPanel workspaceId="ws-1" />);
    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
  });
});
