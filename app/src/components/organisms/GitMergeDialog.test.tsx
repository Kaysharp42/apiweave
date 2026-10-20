import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitBridge } from "@shared/types/GitBridge";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import { GitMergeDialog } from "./GitMergeDialog";
import { installGitBridge, trackedStatus } from "../../__tests__/gitFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const NAME: GitMergeConflict = {
  kind: "workflow",
  recordId: "w1",
  name: "Checkout",
  path: "name",
  base: "Shared",
  ours: "On B",
  theirs: "On A",
};

const DESCRIPTION: GitMergeConflict = {
  ...NAME,
  path: "description",
  ours: "From B",
  theirs: "From A",
};

/** A conflict the re-done merge turns up that the first list did not have. */
const METHOD: GitMergeConflict = {
  ...NAME,
  path: "method",
  ours: "Get B",
  theirs: "Get A",
};

const COMMITS = [
  {
    recordId: "w1",
    ours: {
      sha: "bbbbbbb1111111",
      authorName: "Device B",
      authorDate: "2026-10-20T10:00:00Z",
      subject: "Rename on B",
    },
    theirs: {
      sha: "aaaaaaa2222222",
      authorName: "Device A",
      authorDate: "2026-10-19T10:00:00+02:00",
      subject: "Rename on A",
    },
  },
];

function renderDialog(
  conflicts: readonly GitMergeConflict[] = [NAME, DESCRIPTION],
  overrides: Partial<GitBridge> = {},
) {
  const onClose = vi.fn();
  const onStatus = vi.fn();
  const { bridge } = installGitBridge(trackedStatus({ state: "merging" }), {
    mergeConflicts: vi.fn(async () => conflicts),
    mergeRecordCommits: vi.fn(async () => COMMITS),
    ...overrides,
  });
  render(
    <GitMergeDialog
      status={trackedStatus({ state: "merging" })}
      onClose={onClose}
      onStatus={onStatus}
    />,
  );
  return { bridge, onClose, onStatus };
}

describe("GitMergeDialog", () => {
  it("shows each side's value in the user's words, with both sides' authors and commits", async () => {
    const { bridge } = renderDialog();

    expect(await screen.findByText("On B")).toBeInTheDocument();
    expect(screen.getByText("On A")).toBeInTheDocument();
    expect(screen.getByText("From B")).toBeInTheDocument();
    expect(screen.getByText("From A")).toBeInTheDocument();
    expect(screen.getAllByText("Your copy")).toHaveLength(2);
    expect(screen.getAllByText("Remote copy")).toHaveLength(2);
    // Never the merge's own words for the sides.
    expect(screen.queryByText(/\bours\b/i)).toBeNull();
    expect(screen.queryByText(/\btheirs\b/i)).toBeNull();

    expect(await screen.findByText(/Your copy · Device B · bbbbbbb · 2026-10-20/)).toBeInTheDocument();
    expect(screen.getByText("Rename on B")).toBeInTheDocument();
    expect(screen.getByText(/Remote copy · Device A · aaaaaaa · 2026-10-19/)).toBeInTheDocument();
    expect(screen.getByText("Rename on A")).toBeInTheDocument();

    expect(bridge.mergeConflicts).toHaveBeenCalledWith("ws-1");
    // Once per record, not once per conflict.
    expect(bridge.mergeRecordCommits).toHaveBeenCalledWith("ws-1", ["w1"]);
  });

  it("settles a record field by field, sending every choice when the last one is made", async () => {
    const user = userEvent.setup();
    const { bridge, onClose, onStatus } = renderDialog([NAME, DESCRIPTION], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    const finish = await screen.findByRole("button", { name: "Finish merge" });
    expect(finish).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: "Keep your copy of name" }));
    expect(finish).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Keep remote copy of description" }));

    expect(finish).toBeEnabled();
    await user.click(finish);

    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [
        { recordId: "w1", path: "description", side: "theirs" },
        { recordId: "w1", path: "name", side: "ours" },
      ],
      undefined,
    );
    expect(onStatus).toHaveBeenCalledWith(trackedStatus({ state: "idle" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("settles a whole record with one choice, covering all of its fields", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog([NAME, DESCRIPTION], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    await user.click(await screen.findByRole("button", { name: "Keep remote copy of Checkout" }));

    const finish = screen.getByRole("button", { name: "Finish merge" });
    expect(finish).toBeEnabled();
    await user.click(finish);

    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [{ recordId: "w1", path: "", side: "theirs" }],
      undefined,
    );
  });

  it("replaces a whole-record choice with a field's own pick", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog([NAME], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    await user.click(await screen.findByRole("button", { name: "Keep your copy of Checkout" }));
    await user.click(screen.getByRole("button", { name: "Keep remote copy of name" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(bridge.resolveMerge).toHaveBeenLastCalledWith(
      "ws-1",
      [{ recordId: "w1", path: "name", side: "theirs" }],
      undefined,
    );
  });

  it("asks for the remaining conflicts after a partial resolve, keeping only the picks still listed", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog([NAME, DESCRIPTION], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "merging" })),
      mergeConflicts: vi
        .fn()
        .mockResolvedValueOnce([NAME, DESCRIPTION])
        .mockResolvedValue([METHOD]),
    });

    await user.click(await screen.findByRole("button", { name: "Keep your copy of name" }));
    await user.click(screen.getByRole("button", { name: "Keep remote copy of description" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    // The re-done merge turned up a different conflict: both old picks are gone with their places.
    expect(await screen.findByText("1 conflict left to decide.")).toBeInTheDocument();
    expect(screen.queryByText("On A")).not.toBeInTheDocument();
    expect(screen.queryByText("From A")).not.toBeInTheDocument();
    expect(screen.getByText("Get A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Keep remote copy of method" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(bridge.resolveMerge).toHaveBeenLastCalledWith(
      "ws-1",
      [{ recordId: "w1", path: "method", side: "theirs" }],
      undefined,
    );
  });

  it("says why the merge could not finish, and keeps the decisions that are still waiting", async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog([NAME], {
      resolveMerge: vi.fn(async () =>
        trackedStatus({
          state: "merging",
          lastError: { code: "identity_missing", message: "Author identity unknown" },
        }),
      ),
    });

    await user.click(await screen.findByRole("button", { name: "Keep your copy of Checkout" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Author identity unknown");
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays usable when the commit details cannot be read", async () => {
    const user = userEvent.setup();
    renderDialog([NAME, DESCRIPTION], {
      mergeRecordCommits: vi.fn().mockRejectedValue(new Error("git log failed")),
    });

    expect(await screen.findByText("Commit details unavailable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep your copy of Checkout" }));

    expect(screen.getByRole("button", { name: "Finish merge" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("abandons only after the confirmation, keeping the local commits", async () => {
    const user = userEvent.setup();
    const abandoned = trackedStatus({ state: "diverged" });
    const { bridge, onClose, onStatus } = renderDialog([NAME, DESCRIPTION], {
      abandonMerge: vi.fn(async () => abandoned),
    });

    await user.click(await screen.findByRole("button", { name: "Abandon merge" }));
    const confirmation = await screen.findByRole("dialog", { name: "Abandon this merge?" });
    expect(
      within(confirmation).getByText(/Every local commit and change stays on this device/),
    ).toBeInTheDocument();
    expect(bridge.abandonMerge).not.toHaveBeenCalled();

    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(bridge.abandonMerge).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Abandon merge" }));
    const again = await screen.findByRole("dialog", { name: "Abandon this merge?" });
    await user.click(within(again).getByRole("button", { name: "Abandon merge" }));

    expect(bridge.abandonMerge).toHaveBeenCalledWith("ws-1");
    expect(onStatus).toHaveBeenCalledWith(abandoned);
    expect(onClose).toHaveBeenCalled();
  });

  it("finishes a merge with nothing left to pick, and says so", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog([], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    expect(await screen.findByText(/No conflicts are waiting/)).toBeInTheDocument();
    const finish = screen.getByRole("button", { name: "Finish merge" });
    expect(finish).toBeEnabled();
    await user.click(finish);

    expect(bridge.resolveMerge).toHaveBeenCalledWith("ws-1", [], undefined);
  });

  it("shows a file conflict as a whole-file choice, with no field buttons", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog(
      [
        {
          kind: "file",
          recordId: "README.md",
          name: "README.md",
          path: "",
          base: "# Readme",
          ours: "# Ours",
          theirs: "# Theirs",
        },
      ],
      { resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })) },
    );

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    // Only the two whole-file choices: no per-path buttons at all.
    expect(screen.getAllByRole("button", { name: /of README\.md$/ })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Keep your copy of README.md" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [{ recordId: "README.md", path: "", side: "ours" }],
      undefined,
    );
  });

  it("says so when the conflicts cannot be read, instead of pretending none are waiting", async () => {
    renderDialog([], {
      mergeConflicts: vi.fn().mockRejectedValue(new Error("the clone is busy")),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("the clone is busy");
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeDisabled();
  });
});
