import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkspaceGitStatus } from "@shared/types/WorkspaceGitStatus";
import { GitSyncControl } from "./GitSyncControl";
import { installGitBridge, trackedStatus, untrackedStatus } from "../../__tests__/gitFixtures";

const workspace = vi.hoisted(() => ({ current: { workspaceId: "ws-1", slug: "acme" } }));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentOrg: { slug: "personal" },
    currentWorkspace: workspace.current,
  }),
}));

vi.mock("./WindowControls", () => ({
  WindowControls: () => null,
  dragStyle: {},
  noDragStyle: {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  workspace.current = { workspaceId: "ws-1", slug: "acme" };
});

/** A new element each time: rendering the same element again is a no-op, and the switch below needs a render. */
const routed = () => (
  <MemoryRouter>
    <GitSyncControl />
  </MemoryRouter>
);

function renderControl() {
  return render(routed());
}

const trigger = (label: string) => screen.findByRole("button", { name: `Version history: ${label}` });

const local = { remoteUrl: null, lastSyncedAt: null } as const;

interface StateCase {
  readonly name: string;
  readonly status: WorkspaceGitStatus;
  readonly label: string;
}

const STATES: readonly StateCase[] = [
  { name: "synced", status: trackedStatus(), label: "Synced" },
  { name: "pending (uncommitted edits)", status: trackedStatus({ uncommitted: true }), label: "Pending" },
  { name: "pending (unpushed versions)", status: trackedStatus({ outgoing: 2 }), label: "Pending (2 to push)" },
  { name: "syncing", status: trackedStatus({ state: "syncing" }), label: "Syncing" },
  { name: "incoming", status: trackedStatus({ mode: "manual", incoming: 3 }), label: "Incoming (3)" },
  { name: "diverged", status: trackedStatus({ state: "diverged", incoming: 1, outgoing: 1 }), label: "Diverged" },
  { name: "read-only", status: trackedStatus({ readOnly: true }), label: "Read-only" },
  {
    name: "error",
    status: trackedStatus({ state: "error", lastError: { code: "network_error", message: "fatal: unable to access" } }),
    label: "Sync error",
  },
  { name: "local only, committed", status: trackedStatus(local), label: "Committed" },
  { name: "local only, uncommitted", status: trackedStatus({ ...local, uncommitted: true }), label: "Pending" },
];

describe("GitSyncControl", () => {
  it("is absent when the workspace is not tracked, and when there is no bridge", async () => {
    const { container } = renderControl();
    expect(container).toBeEmptyDOMElement();

    installGitBridge(untrackedStatus);
    const tracked = renderControl();
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(tracked.container.querySelector("button")).toBeNull();
  });

  it.each(STATES)("shows $name as a visible label and an accessible name", async ({ status, label }) => {
    installGitBridge(status);
    renderControl();

    const button = await trigger(label);
    expect(button).toHaveTextContent(label);
    // Never the colour alone: an icon, drawn aria-hidden, beside the text.
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("follows the statuses main pushes", async () => {
    const { push } = installGitBridge(trackedStatus());
    renderControl();
    await trigger("Synced");

    act(() => push(trackedStatus({ state: "syncing" })));
    await trigger("Syncing");
    act(() => push(trackedStatus({ workspaceId: "ws-2", state: "error", lastError: { code: "timeout", message: "t" } })));
    expect(screen.getByRole("button", { name: "Version history: Syncing" })).toBeInTheDocument();
  });

  it("opens an explanation with the last sync and a link to the version history settings", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus());
    renderControl();

    await user.click(await trigger("Synced"));

    expect(await screen.findByText("This workspace matches github.com.")).toBeInTheDocument();
    expect(screen.getByText(/Last synced/)).toBeInTheDocument();
    expect(screen.getByText(/Last commit abc1234 Start tracking this workspace in APIWeave/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Version history settings" })).toHaveAttribute(
      "href",
      "/personal/acme/settings/version-history",
    );
  });

  it("syncs straight away in auto mode", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus({ uncommitted: true }), {
      syncNow: vi.fn(async () => trackedStatus()),
    });
    renderControl();

    await user.click(await trigger("Pending"));
    await user.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", undefined);
    expect(bridge.pendingChanges).not.toHaveBeenCalled();
    await trigger("Synced");
  });

  it("in manual mode lists the pending changes by name and syncs with the message", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus({ mode: "manual", uncommitted: true }), {
      pendingChanges: vi.fn(async () => [
        { kind: "workflow" as const, change: "added" as const, name: "Checkout", path: "workflows/checkout--w1.json" },
        { kind: "environment" as const, change: "deleted" as const, name: "Staging", path: "environments/staging--e1.json" },
      ]),
      syncNow: vi.fn(async () => trackedStatus({ mode: "manual" })),
    });
    renderControl();

    await user.click(await trigger("Pending"));
    await user.click(await screen.findByRole("button", { name: "Sync now" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Added workflow “Checkout”")).toBeInTheDocument();
    expect(within(dialog).getByText("Deleted environment “Staging”")).toBeInTheDocument();
    expect(bridge.syncNow).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole("textbox", { name: "Commit message" }), "Add checkout");
    await user.click(within(dialog).getByRole("button", { name: "Commit and sync" }));

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", { message: "Add checkout" });
  });

  it("in manual mode with nothing uncommitted, just syncs", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus({ mode: "manual", incoming: 1 }));
    renderControl();

    await user.click(await trigger("Incoming (1)"));
    expect(await screen.findByText(/1 new commit is waiting on github.com/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sync now" }));

    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Retry for an error, with the message for its code", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(
      trackedStatus({ state: "error", lastError: { code: "auth_failed", message: "remote: Invalid username or password." } }),
    );
    renderControl();

    await user.click(await trigger("Sync error"));

    expect(
      await screen.findByText("Sign-in to github.com failed — your credential manager will ask again on retry."),
    ).toBeInTheDocument();
    expect(screen.getByText("remote: Invalid username or password.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard local changes" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", undefined);
  });

  it("sends a missing author to the settings instead of offering Retry", async () => {
    const user = userEvent.setup();
    installGitBridge(
      trackedStatus({ state: "error", lastError: { code: "identity_missing", message: "Author identity unknown" } }),
    );
    renderControl();

    await user.click(await trigger("Sync error"));

    expect(await screen.findByRole("link", { name: "Set your name and email" })).toHaveAttribute(
      "href",
      "/personal/acme/settings/version-history",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText("Author identity unknown")).toBeNull();
  });

  it("explains a read-only workspace, and offers Retry and Discard", async () => {
    const user = userEvent.setup();
    installGitBridge(
      trackedStatus({
        readOnly: true,
        outgoing: 1,
        lastError: { code: "permission_denied", message: "remote: Permission to acme/tests denied" },
      }),
    );
    renderControl();

    await user.click(await trigger("Read-only"));

    expect(await screen.findByText(/You can't push to this repo — your changes stay on this device/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard local changes" })).toBeInTheDocument();
  });

  it("keeps the read-only explanation and Discard when a later sync also failed, with the failure told after it", async () => {
    const user = userEvent.setup();
    installGitBridge(
      trackedStatus({
        readOnly: true,
        state: "error",
        lastError: { code: "network_error", message: "fatal: unable to access" },
      }),
    );
    renderControl();

    await user.click(await trigger("Read-only"));

    expect(await screen.findByText(/You can't push to this repo — your changes stay on this device/)).toBeInTheDocument();
    expect(screen.getByText(/The last sync also failed: Can't reach github\.com/)).toBeInTheDocument();
    expect(screen.getByText("fatal: unable to access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard local changes" })).toBeInTheDocument();
  });

  it("sends Retry through the commit dialog in manual mode with edits waiting, like Sync now", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(
      trackedStatus({
        mode: "manual",
        uncommitted: true,
        state: "error",
        lastError: { code: "network_error", message: "fatal: unable to access" },
      }),
      { syncNow: vi.fn(async () => trackedStatus({ mode: "manual" })) },
    );
    renderControl();

    await user.click(await trigger("Sync error"));
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    const dialog = await screen.findByRole("dialog");
    expect(bridge.syncNow).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole("textbox", { name: "Commit message" }), "Try again");
    await user.click(within(dialog).getByRole("button", { name: "Commit and sync" }));
    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", { message: "Try again" });
  });

  it("does not let an action that resolves after a workspace switch change the workspace now shown", async () => {
    const user = userEvent.setup();
    let finish: (status: WorkspaceGitStatus) => void = () => undefined;
    const { bridge } = installGitBridge(trackedStatus({ uncommitted: true }), {
      status: vi.fn(async (workspaceId: string) =>
        workspaceId === "ws-1" ? trackedStatus({ uncommitted: true }) : trackedStatus({ workspaceId, remoteUrl: null, lastSyncedAt: null }),
      ),
      syncNow: vi.fn(
        () =>
          new Promise<WorkspaceGitStatus>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const view = renderControl();
    await user.click(await trigger("Pending"));
    await user.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(bridge.syncNow).toHaveBeenCalledWith("ws-1", undefined);

    workspace.current = { workspaceId: "ws-2", slug: "other" };
    view.rerender(routed());
    await trigger("Committed");
    // The first workspace's call lands: its result belongs to it, not to what is on screen.
    await act(async () => finish(trackedStatus({ state: "error", lastError: { code: "timeout", message: "t" } })));

    expect(screen.getByRole("button", { name: "Version history: Committed" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    // And nothing it was doing — busy, a failure — followed the control to the next workspace.
    await user.click(screen.getByRole("button", { name: "Version history: Committed" }));
    expect(await screen.findByRole("button", { name: "Commit now" })).toBeEnabled();
  });

  it("explains a divergence, and discards only after the confirmation", async () => {
    const user = userEvent.setup();
    const { bridge } = installGitBridge(trackedStatus({ state: "diverged", incoming: 1, outgoing: 1 }), {
      discardLocalChanges: vi.fn(async () => trackedStatus()),
    });
    renderControl();

    await user.click(await trigger("Diverged"));
    expect(await screen.findByText(/Both this device and the remote changed.*later release/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard local changes" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Every local commit and every change not yet committed is thrown away/)).toBeInTheDocument();
    expect(bridge.discardLocalChanges).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(bridge.discardLocalChanges).not.toHaveBeenCalled();

    await user.click(await trigger("Diverged"));
    await user.click(await screen.findByRole("button", { name: "Discard local changes" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard local changes" }));

    expect(bridge.discardLocalChanges).toHaveBeenCalledWith("ws-1");
    await trigger("Synced");
  });

  it("shows a call that was rejected, not only a cycle that failed", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus({ uncommitted: true }), {
      syncNow: vi.fn().mockRejectedValueOnce(new Error("workspace is not tracked")),
    });
    renderControl();

    await user.click(await trigger("Pending"));
    await user.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("workspace is not tracked");
  });

  it("calls a local-only workspace's action Commit now, with no push wording", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus({ ...local, uncommitted: true }));
    renderControl();

    await user.click(await trigger("Pending"));

    expect(await screen.findByRole("button", { name: "Commit now" })).toBeInTheDocument();
    expect(screen.queryByText(/push|remote/i)).toBeNull();
  });
});
