import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitBridge } from "@shared/types/GitBridge";
import { trackedStatus, installGitBridge } from "../../../__tests__/gitFixtures";
import { GitBranchDialog } from "../GitBranchDialog";

function renderDialog(
  overrides: Partial<GitBridge> = {},
  currentBranch = "main",
) {
  const installed = installGitBridge(trackedStatus(), overrides);
  const onClose = vi.fn();
  const onSwitched = vi.fn();
  render(
    <GitBranchDialog
      workspaceId="ws-1"
      currentBranch={currentBranch}
      onClose={onClose}
      onSwitched={onSwitched}
    />,
  );
  return { ...installed, onClose, onSwitched };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GitBranchDialog", () => {
  it("lists the remote's other branches and switches to the one chosen", async () => {
    const switched = trackedStatus({ branch: "feature" });
    const switchBranch = vi.fn<GitBridge["switchBranch"]>(async () => switched);
    const listBranches = vi.fn<GitBridge["listBranches"]>(async () => ({
      branches: ["feature", "main"],
      defaultBranch: null,
    }));
    const { onClose, onSwitched } = renderDialog({
      listBranches,
      switchBranch,
    });
    const user = userEvent.setup();

    const select = await screen.findByRole("combobox", { name: "Branch" });
    expect(listBranches).toHaveBeenCalledWith("ws-1");
    expect(
      screen.queryByRole("option", { name: "main" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(select, "feature");
    await user.click(screen.getByRole("button", { name: "Switch branch" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(switchBranch).toHaveBeenCalledWith("ws-1", "feature");
    expect(onSwitched).toHaveBeenCalledWith(switched);
  });

  it("shows why a switch was refused, and leaves the dialog open", async () => {
    const switchBranch = vi.fn<GitBridge["switchBranch"]>(async () => {
      throw new Error(
        "This branch has 2 commits that main on the remote does not. Push or discard them before switching branches; nothing was switched.",
      );
    });
    const { onClose, onSwitched } = renderDialog({
      listBranches: async () => ({
        branches: ["feature", "main"],
        defaultBranch: null,
      }),
      switchBranch,
    });
    const user = userEvent.setup();

    await screen.findByRole("combobox", { name: "Branch" });
    await user.click(screen.getByRole("button", { name: "Switch branch" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This branch has 2 commits that main on the remote does not.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(onSwitched).not.toHaveBeenCalled();
  });

  it("says when the remote has no other branch", async () => {
    renderDialog({
      listBranches: async () => ({ branches: ["main"], defaultBranch: null }),
    });

    expect(
      await screen.findByText("The remote has no other branch to switch to."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch branch" })).toBeDisabled();
  });
});
