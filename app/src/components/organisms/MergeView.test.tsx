import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { humanizePath } from "@shared/conflict-diff";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeNote } from "@shared/types/GitMergeNote";
import type { GitMergePick } from "@shared/types/GitMergePick";
import type { GitMergeState } from "@shared/types/GitMergeState";
import { MergeView } from "./MergeView";
import { installGitBridge, trackedStatus } from "../../__tests__/gitFixtures";

// Monaco is a lazily loaded browser editor; its two entry points become plain
// elements so a test can type into the value editor and see the diff open.
vi.mock("../node-modal/lazyMonaco", async () => {
  const React = await import("react");
  const FakeEditor = (props: {
    readonly value?: string;
    readonly onChange?: (value: string | undefined) => void;
    readonly options?: { readonly ariaLabel?: string };
  }) =>
    React.createElement("textarea", {
      "aria-label": props.options?.ariaLabel ?? "Editor",
      value: props.value ?? "",
      onChange: (event: { target: { value: string } }) =>
        props.onChange?.(event.target.value),
    });
  const FakeDiff = (props: { readonly options?: { readonly ariaLabel?: string } }) =>
    React.createElement("div", {
      role: "region",
      "aria-label": props.options?.ariaLabel ?? "Diff",
    });
  return { MonacoEditor: FakeEditor, MonacoDiffEditor: FakeDiff };
});

const NAME: GitMergeConflict = {
  kind: "workflow",
  recordId: "w1",
  name: "Checkout",
  path: "name",
  base: "Checkout",
  ours: "Checkout (this device)",
  theirs: "Checkout (remote)",
};

const DESCRIPTION: GitMergeConflict = {
  ...NAME,
  path: "description",
  ours: "Pay by card",
  theirs: "Pay by card (remote)",
};

const ENVIRONMENT: GitMergeConflict = {
  kind: "environment",
  recordId: "env1",
  name: "Staging",
  path: "isDefault",
  base: false,
  ours: false,
  theirs: true,
};

const BODY: GitMergeConflict = {
  kind: "workflow",
  recordId: "w2",
  name: "Login",
  path: "nodes.n1.config.body",
  base: "",
  ours: "x".repeat(200),
  theirs: "y".repeat(200),
};

const FILE: GitMergeConflict = {
  kind: "file",
  recordId: "README.md",
  name: "README.md",
  path: "",
  base: "# API tests",
  ours: "# Mine",
  theirs: "# Remote",
};

const ALL = [NAME, DESCRIPTION, ENVIRONMENT, BODY, FILE];

const NOTES: readonly GitMergeNote[] = [
  { type: "positions", recordId: "w1", name: "Checkout", nodeIds: ["n1", "n2"] },
  { type: "order", recordId: "p1", name: "Shop" },
];

/** The merge the fake service holds: a stable conflict list, the decisions, and notes that follow them. */
interface FakeMerge {
  conflicts: readonly GitMergeConflict[];
  picks: GitMergePick[];
  notes: (picks: readonly GitMergePick[]) => readonly GitMergeNote[];
}

const stateOf = (merge: FakeMerge, picks: readonly GitMergePick[]): GitMergeState => ({
  conflicts: merge.conflicts,
  picks: [...merge.picks],
  notes: merge.notes(picks),
});

interface RenderOptions {
  readonly picks?: readonly GitMergePick[];
  readonly notes?: (picks: readonly GitMergePick[]) => readonly GitMergeNote[];
  readonly unrelatedHistory?: boolean;
  readonly resolveMerge?: ReturnType<typeof vi.fn>;
  readonly syncNow?: ReturnType<typeof vi.fn>;
  readonly merge?: FakeMerge;
}

interface Rendered {
  readonly bridge: ReturnType<typeof installGitBridge>["bridge"];
  readonly merge: FakeMerge;
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly onStatus: ReturnType<typeof vi.fn>;
  readonly view: () => ReturnType<typeof render>;
  readonly unmount: () => void;
}

function installMerge(conflicts: readonly GitMergeConflict[], options: RenderOptions = {}): Rendered {
  const merge: FakeMerge = options.merge ?? {
    conflicts,
    picks: [...(options.picks ?? [])],
    notes: options.notes ?? (() => []),
  };
  const onClose = vi.fn();
  const onStatus = vi.fn();
  const { bridge } = installGitBridge(
    trackedStatus({ state: "merging", unrelatedHistory: options.unrelatedHistory ?? false }),
    {
      mergeState: vi.fn(async (_workspaceId: string, picks?: readonly GitMergePick[]) =>
        stateOf(merge, picks ?? merge.picks),
      ),
      saveMergePicks: vi.fn(async (_workspaceId: string, picks: readonly GitMergePick[]) => {
        merge.picks = [...picks];
        return stateOf(merge, picks);
      }),
      mergeRecordCommits: vi.fn(async (_workspaceId: string, recordIds: readonly string[]) =>
        recordIds.map((recordId) => ({ recordId, ours: null, theirs: null })),
      ),
      resolveMerge:
        options.resolveMerge ??
        vi.fn(async () => {
          merge.picks = [];
          merge.conflicts = [];
          return trackedStatus({ state: "idle" });
        }),
      abandonMerge: vi.fn(async () => trackedStatus({ state: "diverged" })),
      syncNow: options.syncNow ?? vi.fn(async () => trackedStatus()),
    },
  );
  const view = () =>
    render(
      <MergeView
        status={trackedStatus({
          state: "merging",
          ...(options.unrelatedHistory ? { unrelatedHistory: true } : {}),
        })}
        onClose={onClose}
        onStatus={onStatus}
      />,
    );
  const first = view();
  return { bridge, merge, onClose, onStatus, view, unmount: first.unmount };
}

const progress = () => screen.getByRole("status").textContent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MergeView", () => {
  it("lists the conflicted records and files by kind, with counts, and the copies' authors", async () => {
    installMerge(ALL);

    const list = await screen.findByRole("navigation", { name: "Conflicted items" });
    expect(within(list).getByRole("heading", { name: "Workflows" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Environments" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: /Checkout, Workflows, 0 of 2 conflicts resolved/ }),
    ).toBeInTheDocument();
    expect(progress()).toBe("0 of 5 conflicts resolved");
    expect(await screen.findByText("Checkout (this device)")).toBeInTheDocument();
    expect(screen.getByText("Checkout (remote)")).toBeInTheDocument();
    expect(screen.getByText(/Your copy · Not present/)).toBeInTheDocument();
  });

  it("takes a side into the result, marks the row resolved and counts it", async () => {
    const user = userEvent.setup();
    installMerge([NAME]);

    await user.click(await screen.findByRole("button", { name: "Take your copy of Name in Checkout" }));

    expect(progress()).toBe("1 of 1 conflicts resolved");
    expect(screen.getByLabelText("Result for Name in Checkout")).toHaveValue("Checkout (this device)");
    expect(screen.getByRole("button", { name: "Take your copy of Name in Checkout" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(screen.getByRole("listitem", { name: "Name in Checkout" })).getByText("Resolved"),
    ).toBeInTheDocument();
  });

  it("edits a value of the user's own and sends it with the resolve", async () => {
    const user = userEvent.setup();
    const { bridge } = installMerge([NAME], {
      resolveMerge: vi.fn(async () => trackedStatus({ state: "idle" })),
    });

    const result = await screen.findByLabelText("Result for Name in Checkout");
    await user.clear(result);
    await user.type(result, "Written by hand");

    expect(progress()).toBe("1 of 1 conflicts resolved");
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(bridge.saveMergePicks).toHaveBeenCalledWith("ws-1", [
      { recordId: "w1", path: "name", value: "Written by hand" },
    ]);
    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [{ recordId: "w1", path: "name", value: "Written by hand" }],
      undefined,
    );
  });

  it("drops the pick when the result is cleared, and refuses to finish unresolved", async () => {
    const user = userEvent.setup();
    const { bridge } = installMerge([NAME], {
      picks: [{ recordId: "w1", path: "name", value: "Typed before" }],
    });

    const result = await screen.findByLabelText("Result for Name in Checkout");
    expect(progress()).toBe("1 of 1 conflicts resolved");
    await user.clear(result);

    expect(progress()).toBe("0 of 1 conflicts resolved");
    expect(
      within(screen.getByRole("listitem", { name: "Name in Checkout" })).getAllByText("Unresolved"),
    ).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeDisabled();

    // Closing saves what is left: the cleared field is no longer a decision.
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(bridge.saveMergePicks).toHaveBeenCalledWith("ws-1", []),
    );
  });

  it("refuses JSON that does not parse, drops the pick and describes the error", async () => {
    const user = userEvent.setup();
    installMerge([ENVIRONMENT]);

    const result = await screen.findByLabelText("Result for Is default in Staging");
    await user.clear(result);
    await user.type(result, "not json");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Not JSON. Text needs quotes, and numbers, true, false and null do not.",
    );
    expect(result).toHaveAttribute("aria-invalid", "true");
    expect(result).toHaveAttribute("aria-describedby", alert.id);
    expect(progress()).toBe("0 of 1 conflicts resolved");

    await user.clear(result);
    await user.type(result, "false");
    expect(progress()).toBe("1 of 1 conflicts resolved");
  });

  it("edits a long value in the editor, and compares both copies in a diff", async () => {
    const user = userEvent.setup();
    installMerge([BODY]);

    const editor = await screen.findByLabelText(
      `Result for ${humanizePath("nodes.n1.config.body")} in Login`,
    );
    await user.clear(editor);
    await user.type(editor, "a new body");
    expect(progress()).toBe("1 of 1 conflicts resolved");

    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect(
      screen.getByRole("region", {
        name: `Compare your copy with the remote copy of ${humanizePath("nodes.n1.config.body")} in Login`,
      }),
    ).toBeInTheDocument();
  });

  it("keeps an earlier pick when every item is accepted, and confirms first", async () => {
    const user = userEvent.setup();
    const { bridge } = installMerge(ALL, {
      picks: [{ recordId: "env1", path: "isDefault", side: "theirs" }],
    });

    await screen.findByRole("navigation", { name: "Conflicted items" });
    expect(progress()).toBe("1 of 5 conflicts resolved");
    await user.click(await screen.findByRole("button", { name: "Accept all remote" }));
    const confirmation = await screen.findByRole("dialog", { name: "Accept all remote copies?" });
    await user.click(within(confirmation).getByRole("button", { name: "Accept all" }));

    expect(progress()).toBe("5 of 5 conflicts resolved");
    await user.click(screen.getByRole("button", { name: "Finish merge" }));
    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [
        { recordId: "README.md", path: "", side: "theirs" },
        { recordId: "env1", path: "", side: "theirs" },
        { recordId: "w1", path: "", side: "theirs" },
        { recordId: "w2", path: "", side: "theirs" },
      ],
      undefined,
    );
  });

  it("confirms that accepting an item replaces values the user typed", async () => {
    const user = userEvent.setup();
    installMerge([NAME, DESCRIPTION], {
      picks: [{ recordId: "w1", path: "name", value: "Typed" }],
    });

    await user.click(
      await screen.findByRole("button", { name: "Accept all remote copies in Checkout" }),
    );

    const confirmation = await screen.findByRole("dialog", { name: "Replace the values you typed?" });
    expect(confirmation).toHaveTextContent("1 conflict is settled by a value you typed in Checkout");
    await user.click(within(confirmation).getByRole("button", { name: "Replace them" }));

    expect(progress()).toBe("2 of 2 conflicts resolved");
  });

  it("restores both kinds of stored decision when it opens", async () => {
    installMerge([NAME, DESCRIPTION], {
      picks: [
        { recordId: "w1", path: "name", side: "theirs" },
        { recordId: "w1", path: "description", value: "Agreed wording" },
      ],
    });

    expect(await screen.findByLabelText("Result for Name in Checkout")).toHaveValue("Checkout (remote)");
    expect(screen.getByLabelText("Result for Description in Checkout")).toHaveValue("Agreed wording");
    expect(progress()).toBe("2 of 2 conflicts resolved");
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeEnabled();
  });

  it("keeps decisions when it is closed and opened again", async () => {
    const user = userEvent.setup();
    const rendered = installMerge([NAME, DESCRIPTION]);

    const result = await screen.findByLabelText("Result for Description in Checkout");
    await user.clear(result);
    await user.type(result, "Written before closing");
    await user.click(screen.getByRole("button", { name: "Take your copy of Name in Checkout" }));
    expect(progress()).toBe("2 of 2 conflicts resolved");

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(rendered.onClose).toHaveBeenCalled());
    expect(rendered.bridge.saveMergePicks).toHaveBeenCalledWith("ws-1", [
      { recordId: "w1", path: "description", value: "Written before closing" },
      { recordId: "w1", path: "name", side: "ours" },
    ]);

    rendered.unmount();
    rendered.view();

    expect(await screen.findByLabelText("Result for Description in Checkout")).toHaveValue(
      "Written before closing",
    );
    expect(screen.getByLabelText("Result for Name in Checkout")).toHaveValue("Checkout (this device)");
    expect(progress()).toBe("2 of 2 conflicts resolved");
  });

  it("asks before closing with a value that does not parse", async () => {
    const user = userEvent.setup();
    const rendered = installMerge([ENVIRONMENT]);

    const result = await screen.findByLabelText("Result for Is default in Staging");
    await user.clear(result);
    await user.type(result, "not json");
    await user.click(screen.getByRole("button", { name: "Close" }));

    const confirmation = await screen.findByRole("dialog", { name: "Close with a value that is not valid?" });
    await user.click(within(confirmation).getByRole("button", { name: "Close" }));

    await waitFor(() => expect(rendered.onClose).toHaveBeenCalled());
    expect(rendered.bridge.saveMergePicks).toHaveBeenCalledWith("ws-1", []);
  });

  it("shows what merged by itself, and follows the notes as picks change", async () => {
    const user = userEvent.setup();
    const notes = (picks: readonly GitMergePick[]) =>
      picks.length === 0 ? NOTES : [{ type: "order" as const, recordId: "p1", name: "Shop" }];
    installMerge([NAME, DESCRIPTION], { notes });

    const summary = await screen.findByRole("button", { name: "3 changes merged automatically" });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await user.click(summary);
    expect(await screen.findByText(/kept the remote copy's position for 2 nodes/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Take your copy of Name in Checkout" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "1 change merged automatically" })).toBeInTheDocument(),
    );
  });

  it("moves to the next conflict with the keyboard, opening its item", async () => {
    installMerge([NAME, ENVIRONMENT]);

    const result = await screen.findByLabelText("Result for Name in Checkout");
    fireEvent.keyDown(result, { key: "ArrowDown", altKey: true });

    expect(
      screen.getByRole("button", { name: /Staging, Environments, 0 of 1 conflicts resolved/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(await screen.findByLabelText("Result for Is default in Staging")).toBeInTheDocument();
  });

  it("offers only copies for a whole-file conflict", async () => {
    const user = userEvent.setup();
    const { bridge } = installMerge([FILE]);

    await user.click(await screen.findByRole("button", { name: /README.md, Files, 0 of 1 conflicts resolved/ }));

    expect(screen.getByRole("button", { name: "Take your copy of Whole file in README.md" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Result for Whole file in README.md")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Take the remote copy of Whole file in README.md" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));
    expect(bridge.resolveMerge).toHaveBeenCalledWith(
      "ws-1",
      [{ recordId: "README.md", path: "", side: "theirs" }],
      undefined,
    );
  });

  it("says the copies share no history when the status does", async () => {
    installMerge([NAME], { unrelatedHistory: true });
    expect(
      await screen.findByText(/This device and the remote have no history in common/),
    ).toBeInTheDocument();
  });

  it("shows a failed resolve as an alert and stays open", async () => {
    const user = userEvent.setup();
    const resolveMerge = vi.fn(async () => {
      throw new Error("The merge changed while it was being resolved. Open the merge again.");
    });
    const { onClose } = installMerge([NAME], {
      picks: [{ recordId: "w1", path: "name", side: "theirs" }],
      resolveMerge,
    });

    await user.click(await screen.findByRole("button", { name: "Finish merge" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The merge changed while it was being resolved. Open the merge again.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says a finish that settles every conflict but does not finish is a value no record may hold", async () => {
    const user = userEvent.setup();
    const resolveMerge = vi.fn(async () => trackedStatus({ state: "merging", lastError: null }));
    const { onClose } = installMerge([NAME], {
      picks: [{ recordId: "w1", path: "name", value: "" }],
      resolveMerge,
    });

    await user.click(await screen.findByRole("button", { name: "Finish merge" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A value you typed does not make a valid record, so the merge is still waiting.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks for the author inside the view and finishes once git knows one", async () => {
    const user = userEvent.setup();
    const resolveMerge = vi
      .fn()
      .mockResolvedValueOnce(trackedStatus({ state: "merging", lastError: { code: "identity_missing", message: "Author identity unknown" } }))
      .mockResolvedValueOnce(trackedStatus({ state: "idle" }));
    const syncNow = vi.fn(async () => trackedStatus({ state: "merging" }));
    const { bridge, onClose } = installMerge([NAME], {
      picks: [{ recordId: "w1", path: "name", side: "theirs" }],
      resolveMerge,
      syncNow,
    });

    await user.click(await screen.findByRole("button", { name: "Finish merge" }));
    expect(await screen.findByLabelText("Your name")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Your email address"), "ada@example.invalid");
    await user.click(screen.getByRole("button", { name: "Save and commit" }));

    expect(syncNow).toHaveBeenCalledWith("ws-1", {
      identity: { name: "Ada Lovelace", email: "ada@example.invalid" },
    });
    await waitFor(() => expect(resolveMerge).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bridge.saveMergePicks).toHaveBeenCalled();
  });

  it("abandons only after confirmation", async () => {
    const user = userEvent.setup();
    const { bridge, onClose } = installMerge([NAME]);

    await user.click(await screen.findByRole("button", { name: "Abandon merge" }));
    const confirmation = await screen.findByRole("dialog", { name: "Abandon this merge?" });
    expect(bridge.abandonMerge).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Abandon merge" }));

    expect(bridge.abandonMerge).toHaveBeenCalledWith("ws-1");
    expect(onClose).toHaveBeenCalled();
  });
});
