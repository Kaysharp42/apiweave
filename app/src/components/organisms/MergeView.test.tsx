import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { humanizePath } from "@shared/conflict-diff";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeNote } from "@shared/types/GitMergeNote";
import type { GitMergePick } from "@shared/types/GitMergePick";
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

interface Rendered {
  readonly bridge: ReturnType<typeof installGitBridge>["bridge"];
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly onStatus: ReturnType<typeof vi.fn>;
}

function renderView(
  conflicts: readonly GitMergeConflict[] = ALL,
  overrides: {
    readonly picks?: readonly GitMergePick[];
    readonly notes?: readonly GitMergeNote[];
    readonly unrelatedHistory?: boolean;
    readonly resolveMerge?: ReturnType<typeof vi.fn>;
    readonly abandonMerge?: ReturnType<typeof vi.fn>;
  } = {},
): Rendered {
  const onClose = vi.fn();
  const onStatus = vi.fn();
  const { bridge } = installGitBridge(
    trackedStatus({
      state: "merging",
      unrelatedHistory: overrides.unrelatedHistory ?? false,
    }),
    {
      mergeConflicts: vi.fn(async () => conflicts),
      mergePicks: vi.fn(async () => overrides.picks ?? []),
      mergeNotes: vi.fn(async () => overrides.notes ?? []),
      mergeRecordCommits: vi.fn(async (_workspaceId: string, recordIds: readonly string[]) =>
        recordIds.map((recordId) => ({ recordId, ours: null, theirs: null })),
      ),
      resolveMerge: overrides.resolveMerge ?? vi.fn(async () => trackedStatus({ state: "idle" })),
      abandonMerge:
        overrides.abandonMerge ?? vi.fn(async () => trackedStatus({ state: "diverged" })),
    },
  );
  render(
    <MergeView
      status={trackedStatus({ state: "merging", ...(overrides.unrelatedHistory ? { unrelatedHistory: true } : {}) })}
      onClose={onClose}
      onStatus={onStatus}
    />,
  );
  return { bridge, onClose, onStatus };
}

const progress = () => screen.getByRole("status").textContent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MergeView", () => {
  it("lists the conflicted records and files by kind, with counts and progress", async () => {
    renderView();

    const list = await screen.findByRole("navigation", { name: "Conflicted items" });
    expect(within(list).getByRole("heading", { name: "Workflows" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Environments" })).toBeInTheDocument();
    expect(within(list).getByRole("heading", { name: "Files" })).toBeInTheDocument();
    expect(
      within(list).getByRole("button", { name: /Checkout, Workflows, 0 of 2 conflicts settled/ }),
    ).toBeInTheDocument();
    expect(progress()).toBe("0 of 5 conflicts resolved");
    // The first item is open, with one row per conflict and both sides' values.
    expect(await screen.findByText("Checkout (this device)")).toBeInTheDocument();
    expect(screen.getByText("Checkout (remote)")).toBeInTheDocument();
    expect(screen.getByText("Pay by card (remote)")).toBeInTheDocument();
  });

  it("takes a side into the result with an arrow and counts it as resolved", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      await screen.findByRole("button", { name: "Take your copy of Name in Checkout" }),
    );

    expect(progress()).toBe("1 of 5 conflicts resolved");
    expect(screen.getByLabelText("Result for Name in Checkout")).toHaveValue(
      "Checkout (this device)",
    );
    expect(
      screen.getByRole("button", { name: "Take your copy of Name in Checkout" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("edits a value of the user's own and sends it with the resolve", async () => {
    const user = userEvent.setup();
    const resolveMerge = vi.fn(async () => trackedStatus({ state: "idle" }));
    renderView([NAME], { resolveMerge });

    await screen.findByLabelText("Result for Name in Checkout");
    await user.clear(screen.getByLabelText("Result for Name in Checkout"));
    await user.type(screen.getByLabelText("Result for Name in Checkout"), "Written by hand");

    expect(progress()).toBe("1 of 1 conflicts resolved");
    await user.click(screen.getByRole("button", { name: "Finish merge" }));

    expect(resolveMerge).toHaveBeenCalledWith("ws-1", [
      { recordId: "w1", path: "name", value: "Written by hand" },
    ], undefined);
  });

  it("refuses JSON that does not parse, and settles nothing on it", async () => {
    const user = userEvent.setup();
    renderView([ENVIRONMENT]);

    const result = await screen.findByLabelText(`Result for ${humanizePath("isDefault")} in Staging`);
    await user.clear(result);
    await user.type(result, "not json");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not JSON. Text needs quotes, and numbers, true, false and null do not.",
    );
    expect(progress()).toBe("0 of 1 conflicts resolved");

    await user.clear(result);
    await user.type(result, "false");
    expect(progress()).toBe("1 of 1 conflicts resolved");
  });

  it("edits a long value in the editor, and compares both copies in a diff", async () => {
    const user = userEvent.setup();
    renderView([BODY]);

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

  it("accepts a whole item, and every item at once after confirming", async () => {
    const user = userEvent.setup();
    const { bridge } = renderView();

    await user.click(
      await screen.findByRole("button", { name: "Accept all your copies in Checkout" }),
    );
    expect(progress()).toBe("2 of 5 conflicts resolved");

    await user.click(screen.getByRole("button", { name: "Accept all yours" }));
    const confirmation = await screen.findByRole("dialog", { name: "Accept all your copies?" });
    await user.click(within(confirmation).getByRole("button", { name: "Accept all" }));
    expect(progress()).toBe("5 of 5 conflicts resolved");

    await user.click(screen.getByRole("button", { name: "Finish merge" }));
    expect(bridge.resolveMerge).toHaveBeenCalledWith("ws-1", [
      { recordId: "README.md", path: "", side: "ours" },
      { recordId: "env1", path: "", side: "ours" },
      { recordId: "w1", path: "", side: "ours" },
      { recordId: "w2", path: "", side: "ours" },
    ], undefined);
  });

  it("restores both kinds of stored decision when it opens", async () => {
    renderView([NAME, DESCRIPTION], {
      picks: [
        { recordId: "w1", path: "name", side: "theirs" },
        { recordId: "w1", path: "description", value: "Agreed wording" },
      ],
    });

    expect(await screen.findByLabelText("Result for Name in Checkout")).toHaveValue(
      "Checkout (remote)",
    );
    expect(screen.getByLabelText("Result for Description in Checkout")).toHaveValue(
      "Agreed wording",
    );
    expect(progress()).toBe("2 of 2 conflicts resolved");
    expect(screen.getByRole("button", { name: "Finish merge" })).toBeEnabled();
  });

  it("shows what merged by itself, collapsed until asked", async () => {
    const user = userEvent.setup();
    renderView(ALL, { notes: NOTES });

    const summary = await screen.findByRole("button", {
      name: "3 changes merged automatically",
    });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    await user.click(summary);

    expect(await screen.findByText(/kept the remote copy's position for 2 nodes/)).toBeInTheDocument();
    expect(screen.getByText(/kept the remote copy's workflow order/)).toBeInTheDocument();
  });

  it("moves to the next conflict with the keyboard, opening its item", async () => {
    renderView([NAME, ENVIRONMENT]);

    const result = await screen.findByLabelText("Result for Name in Checkout");
    fireEvent.keyDown(result, { key: "ArrowDown", altKey: true });

    expect(
      screen.getByRole("button", { name: /Staging, Environments, 0 of 1 conflicts settled/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(await screen.findByLabelText(`Result for ${humanizePath("isDefault")} in Staging`)).toBeInTheDocument();
  });

  it("offers only copies for a whole-file conflict", async () => {
    const user = userEvent.setup();
    const { bridge } = renderView([FILE]);

    await user.click(
      await screen.findByRole("button", { name: /README.md, Files, 0 of 1 conflicts settled/ }),
    );

    expect(screen.getByRole("button", { name: "Take your copy of Whole file in README.md" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Result for Whole file in README.md")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Take the remote copy of Whole file in README.md" }));
    await user.click(screen.getByRole("button", { name: "Finish merge" }));
    expect(bridge.resolveMerge).toHaveBeenCalledWith("ws-1", [
      { recordId: "README.md", path: "", side: "theirs" },
    ], undefined);
  });

  it("says the copies share no history when the status does", async () => {
    renderView([NAME], { unrelatedHistory: true });
    expect(
      await screen.findByText(/This device and the remote have no history in common/),
    ).toBeInTheDocument();
  });

  it("shows a failed resolve as an alert and stays open", async () => {
    const user = userEvent.setup();
    const resolveMerge = vi.fn(async () => {
      throw new Error("The merge changed while it was being resolved. Open the merge again.");
    });
    const { onClose } = renderView([NAME], {
      resolveMerge,
      picks: [{ recordId: "w1", path: "name", side: "theirs" }],
    });

    await user.click(await screen.findByRole("button", { name: "Finish merge" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The merge changed while it was being resolved. Open the merge again.",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("abandons only after confirmation", async () => {
    const user = userEvent.setup();
    const { bridge, onClose } = renderView();

    await user.click(await screen.findByRole("button", { name: "Abandon merge" }));
    const confirmation = await screen.findByRole("dialog", { name: "Abandon this merge?" });
    expect(bridge.abandonMerge).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Abandon merge" }));

    expect(bridge.abandonMerge).toHaveBeenCalledWith("ws-1");
    expect(onClose).toHaveBeenCalled();
  });
});
