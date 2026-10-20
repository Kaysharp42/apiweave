import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkspacePendingChange } from "@shared/types/WorkspacePendingChange";
import { GitCommitDialog } from "./GitCommitDialog";
import { installGitBridge, trackedStatus } from "../../__tests__/gitFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CHANGES: readonly WorkspacePendingChange[] = [
  { kind: "workspace", change: "changed", name: "Acme QA", path: "workspace.json" },
  { kind: "project", change: "added", name: "Billing", path: "projects/billing--p1.json" },
  { kind: "workflow", change: "changed", name: "Checkout", path: "workflows/checkout--w1.json" },
  { kind: "environment", change: "deleted", name: "Staging", path: "environments/staging--e1.json" },
];

function renderDialog(onConfirm = vi.fn(), connected = true) {
  const onClose = vi.fn();
  render(
    <GitCommitDialog workspaceId="ws-1" connected={connected} onClose={onClose} onConfirm={onConfirm} />,
  );
  return { onConfirm, onClose };
}

describe("GitCommitDialog", () => {
  it("lists what would be committed by record name, with what happens to each", async () => {
    const { bridge } = installGitBridge(trackedStatus(), { pendingChanges: vi.fn(async () => CHANGES) });
    renderDialog();

    const list = await screen.findByRole("list", { name: "Pending changes" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Changed workspace “Acme QA”",
      "Added project “Billing”",
      "Changed workflow “Checkout”",
      "Deleted environment “Staging”",
    ]);
    // Names, not file paths.
    expect(screen.queryByText(/checkout--w1/)).toBeNull();
    expect(bridge.pendingChanges).toHaveBeenCalledWith("ws-1");
  });

  it("puts the cursor in the message field as it opens, with no icon beside the close button", async () => {
    installGitBridge(trackedStatus(), { pendingChanges: vi.fn(async () => CHANGES) });
    renderDialog();

    const field = await screen.findByRole("textbox", { name: "Commit message" });
    await vi.waitFor(() => expect(field).toHaveFocus());
    const dialog = screen.getByRole("dialog");
    // The close button is the only control in the header.
    expect(within(dialog).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "Close",
      "Cancel",
      "Commit and sync",
    ]);
  });

  it("hands the message to its caller", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus(), { pendingChanges: vi.fn(async () => CHANGES) });
    const { onConfirm } = renderDialog();

    await user.type(await screen.findByRole("textbox", { name: "Commit message" }), "Rework checkout");
    await user.click(screen.getByRole("button", { name: "Commit and sync" }));

    expect(onConfirm).toHaveBeenCalledWith("Rework checkout");
  });

  it("hands over an empty message when none is typed, so the service's own is used", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus(), { pendingChanges: vi.fn(async () => CHANGES) });
    const { onConfirm } = renderDialog();

    await screen.findByRole("list", { name: "Pending changes" });
    await user.click(screen.getByRole("button", { name: "Commit and sync" }));

    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("waits for the list before it can be confirmed", async () => {
    let release: (changes: readonly WorkspacePendingChange[]) => void = () => undefined;
    installGitBridge(trackedStatus(), {
      pendingChanges: vi.fn(() => new Promise<readonly WorkspacePendingChange[]>((resolve) => {
        release = resolve;
      })),
    });
    renderDialog();

    expect(await screen.findByRole("button", { name: "Commit and sync" })).toBeDisabled();
    release(CHANGES);

    await screen.findByRole("list", { name: "Pending changes" });
    expect(screen.getByRole("button", { name: "Commit and sync" })).toBeEnabled();
  });

  it("still lets the commit go ahead when the list cannot be read, and says why it is missing", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus(), {
      pendingChanges: vi.fn().mockRejectedValueOnce(new Error("the clone is busy")),
    });
    const { onConfirm } = renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't list the changes: the clone is busy");
    await user.click(screen.getByRole("button", { name: "Commit and sync" }));

    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("says so when no record changed, and words a local-only workspace's commit without a sync", async () => {
    installGitBridge(trackedStatus(), { pendingChanges: vi.fn(async () => []) });
    renderDialog(vi.fn(), false);

    expect(await screen.findByText(/No workflow, project or environment changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Commit and sync" })).toBeNull();
  });

  it("closes without confirming", async () => {
    const user = userEvent.setup();
    installGitBridge(trackedStatus(), { pendingChanges: vi.fn(async () => CHANGES) });
    const { onConfirm, onClose } = renderDialog();

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
