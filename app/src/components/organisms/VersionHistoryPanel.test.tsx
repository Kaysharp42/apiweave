import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitBridge } from "@shared/types/GitBridge";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { VersionHistoryPanel } from "./VersionHistoryPanel";

const untracked: WorkspaceGitStatus = {
  workspaceId: "ws-1",
  tracked: false,
  mode: "auto",
  state: "idle",
  lastError: null,
  lastCommit: null,
};

const tracked = (overrides: Partial<WorkspaceGitStatus> = {}): WorkspaceGitStatus => ({
  ...untracked,
  tracked: true,
  lastCommit: { sha: "abc1234def5678", subject: "Start tracking this workspace in APIWeave", authorDate: "2026-10-19T09:00:00+02:00" },
  ...overrides,
});

interface InstalledBridge {
  readonly bridge: GitBridge;
  /** Push a status the way main's status-change channel does. */
  readonly push: (status: WorkspaceGitStatus) => void;
}

function installBridge(initial: WorkspaceGitStatus): InstalledBridge {
  let listener: ((status: WorkspaceGitStatus) => void) | undefined;
  const bridge: GitBridge = {
    status: vi.fn(async () => initial),
    track: vi.fn(async () => tracked()),
    untrack: vi.fn(async () => untracked),
    setMode: vi.fn(async (_workspaceId, mode) => tracked({ mode })),
    syncNow: vi.fn(async (_workspaceId, request) =>
      tracked({ mode: "manual", lastCommit: { sha: "fedcba9876543", subject: request?.message ?? "Update 1 file", authorDate: "2026-10-19T10:00:00+02:00" } })),
    onStatusChanged: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  vi.stubGlobal("__APIWEAVE_GIT__", bridge);
  return { bridge, push: (status) => listener?.(status) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VersionHistoryPanel", () => {
  it("tracks an untracked workspace and shows its first commit", async () => {
    const user = userEvent.setup();
    const { bridge } = installBridge(untracked);
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /track this workspace/i }));

    expect(bridge.track).toHaveBeenCalledWith("ws-1");
    expect(await screen.findByText("abc1234 Start tracking this workspace in APIWeave")).toBeInTheDocument();
    // Auto mode commits on its own: there is no message field to fill in.
    expect(screen.queryByRole("textbox", { name: /commit message/i })).toBeNull();
  });

  it("commits with a message in manual mode, and switches back to auto", async () => {
    const user = userEvent.setup();
    const { bridge } = installBridge(tracked({ mode: "manual" }));
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.type(await screen.findByRole("textbox", { name: /commit message/i }), "Add the login flow");
    await user.click(screen.getByRole("button", { name: /commit now/i }));

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", { message: "Add the login flow" });
    expect(await screen.findByText("fedcba9 Add the login flow")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /commit message/i })).toHaveValue("");

    await user.click(screen.getByRole("checkbox"));
    expect(bridge.setMode).toHaveBeenCalledWith("ws-1", "auto");
    await waitFor(() => expect(screen.queryByRole("button", { name: /commit now/i })).toBeNull());
  });

  it("follows the statuses main pushes for this workspace only", async () => {
    const { push } = installBridge(tracked());
    render(<VersionHistoryPanel workspaceId="ws-1" />);
    await screen.findByText(/abc1234/);

    act(() => push(tracked({ workspaceId: "ws-2", lastError: { code: "command_failed", message: "elsewhere" } })));
    act(() => push(tracked({ state: "error", lastError: { code: "command_failed", message: "git commit failed" } })));

    expect(await screen.findByText("git commit failed")).toBeInTheDocument();
    expect(screen.queryByText("elsewhere")).toBeNull();
  });

  it("asks for an author when git has none, and commits under the one given", async () => {
    const user = userEvent.setup();
    const { bridge } = installBridge(untracked);
    vi.mocked(bridge.track).mockResolvedValueOnce(
      tracked({ state: "error", lastCommit: null, lastError: { code: "identity_missing", message: "git commit failed: Author identity unknown" } }),
    );
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
    const { bridge } = installBridge(tracked());
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /^stop tracking$/i }));
    expect(bridge.untrack).not.toHaveBeenCalled();
    const confirm = await screen.findAllByRole("button", { name: /^stop tracking$/i });
    await user.click(confirm[confirm.length - 1]!);

    expect(bridge.untrack).toHaveBeenCalledWith("ws-1");
    expect(await screen.findByRole("button", { name: /track this workspace/i })).toBeInTheDocument();
  });

  it("shows a failed call's message", async () => {
    const user = userEvent.setup();
    const { bridge } = installBridge(untracked);
    vi.mocked(bridge.track).mockRejectedValueOnce(new Error("git is not installed or not on PATH"));
    render(<VersionHistoryPanel workspaceId="ws-1" />);

    await user.click(await screen.findByRole("button", { name: /track this workspace/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("git is not installed or not on PATH");
  });

  it("says version history needs the desktop app when there is no bridge", () => {
    render(<VersionHistoryPanel workspaceId="ws-1" />);
    expect(screen.getByText(/only available in the desktop app/i)).toBeInTheDocument();
  });
});
