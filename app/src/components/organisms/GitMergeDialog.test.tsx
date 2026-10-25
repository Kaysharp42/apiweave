import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitBridge } from "@shared/types/GitBridge";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergePick } from "@shared/types/GitMergePick";
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
  const { unmount } = render(
    <GitMergeDialog
      status={trackedStatus({ state: "merging" })}
      onClose={onClose}
      onStatus={onStatus}
    />,
  );
  return { bridge, onClose, onStatus, unmount };
}

describe("GitMergeDialog", () => {
  it("says the two copies share no history when the merge has no ancestor", async () => {
    const noBase: GitMergeConflict = {
      kind: "workflow",
      recordId: "w1",
      name: "Checkout",
      path: "name",
      ours: "On B",
      theirs: "On A",
    };
    installGitBridge(
      trackedStatus({ state: "merging", unrelatedHistory: true }),
      { mergeConflicts: vi.fn(async () => [noBase]) },
    );
    render(
      <GitMergeDialog
        status={trackedStatus({ state: "merging", unrelatedHistory: true })}
        onClose={vi.fn()}
        onStatus={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/This device and the remote have no history in common/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Both this device and the remote changed these fields/),
    ).toBeNull();
    // A conflict with no ancestor to show is still a card with both copies.
    expect(await screen.findByText("On B")).toBeInTheDocument();
    expect(screen.getByText("On A")).toBeInTheDocument();
  });

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
    // The decisions stored with the merge seed the picker, so reopening it
    // after a partial resolve starts where the last session left off.
    expect(bridge.mergePicks).toHaveBeenCalledWith("ws-1");
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

    await user.click(
      await screen.findByRole("button", {
        name: "Keep your copy of Name in Checkout",
      }),
    );
    expect(finish).toBeDisabled();
    await user.click(
      screen.getByRole("button", {
        name: "Keep remote copy of Description in Checkout",
      }),
    );

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

    await user.click(
      await screen.findByRole("button", {
        name: "Keep remote copy for all conflicts in Checkout",
      }),
    );

    const finish = screen.getByRole("button", { name: "Finish merge" });
    expect(finish).toBeEnabled();
    await user.click(finish);

    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [{ recordId: "w1", path: "", side: "theirs" }],
      undefined,
    );
  });

  it("lets a field's own pick override the whole-record choice for that field only", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog([NAME, DESCRIPTION], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Keep your copy for all conflicts in Checkout",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Keep remote copy of Name in Checkout",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    // The record's choice stays as the fallback, so Description is still
    // settled by it, and name is the only field the later choice overrides.
    expect(bridge.resolveMerge).toHaveBeenLastCalledWith(
      "ws-1",
      [
        { recordId: "w1", path: "", side: "ours" },
        { recordId: "w1", path: "name", side: "theirs" },
      ],
      undefined,
    );
  });

  it("carries every decision forward when a partial resolve leaves a conflict", async () => {
    const user = userEvent.setup();
    const { bridge } = renderDialog([NAME, DESCRIPTION], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "merging" })),
      mergeConflicts: vi
        .fn()
        .mockResolvedValueOnce([NAME, DESCRIPTION])
        .mockResolvedValue([METHOD]),
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Keep your copy of Name in Checkout",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Keep remote copy of Description in Checkout",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    // The re-done merge turned up a different conflict, and none of the
    // decisions already made were thrown away.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 conflict left to decide.",
    );
    expect(screen.queryByText("On A")).not.toBeInTheDocument();
    expect(screen.queryByText("From A")).not.toBeInTheDocument();
    expect(screen.getByText("Get A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeDisabled();
    // The reloaded list has a record the first list did not, so its card's
    // authors are read again.
    expect(bridge.mergeRecordCommits).toHaveBeenCalledTimes(2);

    await user.click(
      screen.getByRole("button", {
        name: "Keep remote copy of Method in Checkout",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    // The whole set, not just the pick made since the reload: the server
    // replaces its stored picks with exactly what the request carries.
    expect(bridge.resolveMerge).toHaveBeenLastCalledWith(
      "ws-1",
      [
        { recordId: "w1", path: "description", side: "theirs" },
        { recordId: "w1", path: "method", side: "theirs" },
        { recordId: "w1", path: "name", side: "ours" },
      ],
      undefined,
    );
  });

  it("starts from the decisions stored with the merge when it is opened again", async () => {
    const user = userEvent.setup();
    const stored: GitMergePick[] = [];
    const first = renderDialog([NAME, DESCRIPTION], {
      resolveMerge: vi.fn(async (_workspaceId, chosen) => {
        stored.splice(0, stored.length, ...chosen);
        return trackedStatus({ state: "merging" });
      }),
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Keep your copy of Name in Checkout",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Keep remote copy of Description in Checkout",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));
    // The first round left nothing to list, so the dialog had nothing more to
    // show; the user closes it, and the merge is still waiting.
    expect(first.bridge.resolveMerge).toHaveBeenCalled();
    first.unmount();

    const { bridge, onClose } = renderDialog([METHOD], {
      mergeConflicts: vi.fn(async () => [METHOD]),
      mergePicks: vi.fn(async () => stored),
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    // The reopened picker read the decisions the merge has stored (what is
    // left to list is only the conflict those decisions did not settle), and
    // shows the leftover.
    const reopened = await screen.findByRole("button", {
      name: "Keep remote copy of Method in Checkout",
    });
    expect(reopened).toHaveAttribute("aria-pressed", "false");
    await user.click(reopened);
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    // The request carries the first round's picks too: the server replaces its
    // stored set with exactly what this one holds.
    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [
        { recordId: "w1", path: "description", side: "theirs" },
        { recordId: "w1", path: "method", side: "theirs" },
        { recordId: "w1", path: "name", side: "ours" },
      ],
      undefined,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("reads the conflicts before the picks, so the picks cannot be the older of the two", async () => {
    let release: (conflicts: readonly GitMergeConflict[]) => void = () => {};
    const mergePicks = vi.fn(async () => [] as GitMergePick[]);
    renderDialog([], {
      mergeConflicts: vi.fn(
        () =>
          new Promise<readonly GitMergeConflict[]>((resolve) => {
            release = resolve;
          }),
      ),
      mergePicks,
    });

    // `mergeConflicts` is still waiting on the service lock. Reading the picks
    // now would seed a set from before the resolve in flight, and the next
    // finish would drop that resolve's decisions.
    expect(mergePicks).not.toHaveBeenCalled();

    release([NAME]);
    expect(await screen.findByText("On B")).toBeInTheDocument();
    expect(mergePicks).toHaveBeenCalledWith("ws-1");
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

    await user.click(
      await screen.findByRole("button", {
        name: "Keep your copy for all conflicts in Checkout",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Author identity unknown. Set your name and email in Version history settings.",
    );
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says why an unclassified failure left the merge waiting", async () => {
    const user = userEvent.setup();
    renderDialog([NAME], {
      resolveMerge: vi.fn(async () =>
        trackedStatus({
          state: "merging",
          lastError: {
            code: null,
            message: "This workspace changed again while the merge was being resolved.",
          },
        }),
      ),
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Keep your copy of Name in Checkout",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This workspace changed again while the merge was being resolved.",
    );
  });

  it("stays usable when the commit details cannot be read", async () => {
    const user = userEvent.setup();
    renderDialog([NAME, DESCRIPTION], {
      mergeRecordCommits: vi.fn().mockRejectedValue(new Error("git log failed")),
    });

    expect(await screen.findByText("Commit details unavailable")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Keep your copy for all conflicts in Checkout",
      }),
    );

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
    // A `""` place is the whole file, named as such rather than left blank.
    expect(screen.getByText("Whole file")).toBeInTheDocument();
    // Only the two whole-file choices: no per-path buttons at all.
    expect(
      screen.getAllByRole("button", { name: /in README\.md$/ }),
    ).toHaveLength(2);

    await user.click(
      screen.getByRole("button", {
        name: "Keep your copy for all conflicts in README.md",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [{ recordId: "README.md", path: "", side: "ours" }],
      undefined,
    );
  });

  it("asks about at most 500 records for commit details", async () => {
    const many = Array.from({ length: 501 }, (_, index) => ({
      ...NAME,
      recordId: `w${index}`,
      name: `Workflow ${index}`,
    }));
    const mergeRecordCommits = vi.fn(
      async (_workspaceId: string, _recordIds: readonly string[]) => [],
    );

    renderDialog(many, { mergeRecordCommits });

    expect(
      await screen.findByRole("button", {
        name: "Keep your copy of Name in Workflow 0",
      }),
    ).toBeInTheDocument();
    // The bridge refuses more than 500 ids; the rest of the list simply shows
    // no authors.
    expect(mergeRecordCommits).toHaveBeenCalledWith(
      "ws-1",
      many.slice(0, 500).map((conflict) => conflict.recordId),
    );
  });

  it("names a whole-record conflict instead of leaving its row blank", async () => {
    renderDialog([
      {
        ...NAME,
        path: "",
        invalid: "These copies do not make a valid workflow",
      },
    ]);

    expect(await screen.findByText("Whole record")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "These copies do not make a valid workflow",
    );
  });

  it("says so when the conflicts cannot be read, instead of pretending none are waiting", async () => {
    renderDialog([], {
      mergeConflicts: vi.fn().mockRejectedValue(new Error("the clone is busy")),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("the clone is busy");
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeDisabled();
  });

  it("says so when the decisions stored with the merge cannot be read", async () => {
    renderDialog([NAME], {
      mergePicks: vi.fn().mockRejectedValue(new Error("the picks are unreadable")),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the picks are unreadable",
    );
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeDisabled();
  });
});
